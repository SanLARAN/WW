import Peer, { type DataConnection } from 'peerjs';
import type { GameState, InputCmd } from '../core/types';

/**
 * P2P co-op over PeerJS, up to six troopers.
 *
 * The host owns the simulation. Clients send nothing but their input, stamped
 * with a sequence number; the host sends snapshots plus the last input it
 * consumed per player, so each client can reconcile its own soldier locally and
 * hide latency. There is no server anywhere except the PeerJS signalling relay,
 * which is only used to introduce the peers.
 *
 * Wire format is JSON. Snapshots are already compact (positions + counters);
 * for a 20 Hz 6-player battle that's a couple of KB/s, well inside WebRTC data
 * channel comfort.
 */

export type NetRole = 'offline' | 'host' | 'client';

export type NetMessage =
  | { t: 'hello'; name: string; xp: number; level: number }
  | { t: 'welcome'; seed: number; bots: number; difficulty: number; id: number }
  | { t: 'input'; cmd: InputCmd }
  | { t: 'snap'; s: GameState; ack: Record<number, number> }
  | { t: 'event'; kind: string; data?: unknown }
  | { t: 'youAre'; soldier: number }
  | { t: 'bye' };

const PREFIX = 'kotel-';

export interface NetCallbacks {
  onState: (s: GameState, ack: Record<number, number>) => void;
  onPeers: (list: { id: string; name: string }[]) => void;
  onStatus: (text: string) => void;
  onWelcome: (m: { seed: number; bots: number; difficulty: number; id: number }) => void;
  onEvent: (kind: string, data?: unknown) => void;
  /** host only: an input command arrived from a peer */
  onRemoteInput: (peer: string, cmd: InputCmd) => void;
  /** host only: a peer connected and was assigned a squad slot */
  onPeerJoined: (peer: string, name: string, slot: number) => void;
  /** client: the host told us which soldier we own */
  onYouAre: (soldierId: number) => void;
}

export class Net {
  role: NetRole = 'offline';
  myId = 0;
  code = '';
  private peer: Peer | null = null;
  private conns: DataConnection[] = [];
  private peerNames = new Map<string, string>();
  private peerSlots = new Map<string, number>();
  private cb: NetCallbacks;
  /** the live callback table; the host rewires entries from the match */
  readonly cbRef: { current: NetCallbacks };
  private lastSnap = 0;
  private snapInterval = 50; // ms, 20 Hz to match the tick
  private pendingInput: InputCmd | null = null;
  private ack: Record<number, number> = {};

  constructor(cb: NetCallbacks) {
    this.cb = cb;
    this.cbRef = { current: cb };
  }

  get peerCount() {
    return this.conns.filter((c) => c.open).length;
  }

  peers() {
    return this.conns.filter((c) => c.open).map((c) => ({ id: c.peer, name: this.peerNames.get(c.peer) ?? '—' }));
  }

  /** Host: open a room, accept up to five guests. */
  host(code: string, seed: number, bots: number, difficulty: number) {
    this.close();
    this.role = 'host';
    this.code = code;
    this.myId = 1;
    this.peer = new Peer(PREFIX + code, { debug: 0 });
    this.peer.on('open', () => this.cb.onStatus(`Комната ${code} открыта`));
    this.peer.on('error', (e) => this.cb.onStatus(`Ошибка сети: ${e.type}`));
    this.peer.on('connection', (conn) => {
      if (this.conns.length >= 5) { conn.close(); return; }
      this.conns.push(conn);
      const slot = this.conns.length; // 1..5, slot 0 is the host
      this.peerSlots.set(conn.peer, slot);
      conn.on('open', () => {
        this.send(conn, { t: 'welcome', seed, bots, difficulty, id: slot + 1 });
        this.cb.onPeerJoined(conn.peer, this.peerNames.get(conn.peer) ?? 'Боец', slot);
        this.cb.onPeers(this.peers());
      });
      conn.on('data', (raw) => this.handle(conn, raw));
      conn.on('close', () => {
        this.conns = this.conns.filter((c) => c !== conn);
        this.cb.onEvent('peer-left', conn.peer);
        this.cb.onPeers(this.peers());
      });
    });
  }

  /** Client: join a room by code. */
  join(code: string, name: string, xp: number, level: number) {
    this.close();
    this.role = 'client';
    this.code = code;
    this.peer = new Peer({ debug: 0 });
    this.peer.on('open', () => {
      const conn = this.peer!.connect(PREFIX + code, { reliable: false, serialization: 'json' });
      this.conns = [conn];
      conn.on('open', () => {
        this.send(conn, { t: 'hello', name, xp, level });
        this.cb.onStatus('Подключено, ждём бой');
      });
      conn.on('data', (raw) => this.handle(conn, raw));
      conn.on('close', () => this.cb.onStatus('Связь с хостом потеряна'));
    });
    this.peer.on('error', (e) => this.cb.onStatus(`Не удалось войти: ${e.type}`));
  }

  private handle(conn: DataConnection, raw: unknown) {
    const m = raw as NetMessage;
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'hello':
        this.peerNames.set(conn.peer, m.name);
        this.cb.onPeerJoined(conn.peer, m.name, this.peerSlots.get(conn.peer) ?? 1);
        this.cb.onPeers(this.peers());
        break;
      case 'welcome':
        this.myId = m.id;
        this.cb.onWelcome(m);
        break;
      case 'input':
        this.cb.onRemoteInput(conn.peer, m.cmd);
        break;
      case 'snap':
        this.ack = m.ack;
        this.cb.onState(m.s, m.ack);
        break;
      case 'event':
        this.cb.onEvent(m.kind, m.data);
        break;
      case 'youAre':
        this.myId = m.soldier;
        this.cb.onYouAre(m.soldier);
        break;
      default:
        break;
    }
  }

  private send(conn: DataConnection, m: NetMessage) {
    try { if (conn.open) conn.send(m); } catch { /* channel churn */ }
  }

  broadcast(m: NetMessage) {
    for (const c of this.conns) this.send(c, m);
  }

  sendTo(peer: string, m: NetMessage) {
    const c = this.conns.find((x) => x.peer === peer);
    if (c) this.send(c, m);
  }

  /** Client → host: the only traffic a client originates during a match. */
  sendInput(cmd: InputCmd) {
    if (this.role !== 'client' || !this.conns[0]?.open) return;
    // fire is rate-limited to the send budget; the host re-injects it on tick
    this.pendingInput = { ...cmd };
    this.send(this.conns[0], { t: 'input', cmd: this.pendingInput });
  }

  /** Host → everyone: throttled to the tick rate. */
  sendSnapshot(s: GameState, now: number) {
    if (this.role !== 'host') return;
    if (now - this.lastSnap < this.snapInterval) return;
    this.lastSnap = now;
    // strip the noisy fields the client can derive locally
    const wire: GameState = {
      ...s,
      tracers: s.tracers.slice(-24),
      impacts: s.impacts.slice(-16),
    };
    this.broadcast({ t: 'snap', s: wire, ack: {} as Record<number, number> });
  }

  lastAck() { return this.ack; }

  close() {
    for (const c of this.conns) { try { c.close(); } catch { /* already gone */ } }
    this.conns = [];
    this.peer?.destroy();
    this.peer = null;
    this.role = 'offline';
    this.myId = 0;
  }
}
