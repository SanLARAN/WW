import type { Bus, BusMsg } from './bus';
import { FrameReader, encodeFrames, type Link } from './peer';
import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';

/**
 * PeerJS transport: free public signalling cloud (0.peerjs.com), no keys required.
 * The host registers a well-known peer id "ww-game-<CODE>"; clients connect to it
 * directly. Each DataConnection multiplexes bus frames ({ch:'b'}) and link frames
 * ({ch:'l'}). Once the channel is open the traffic is pure browser-to-browser P2P.
 */

export const PJS_PREFIX = 'ww-game-';
const roomCode = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

let cached: Promise<typeof import('peerjs').default> | null = null;
const peerjs = () => (cached ??= import('peerjs').then((m) => m.default));
const peerOpts = () => ({ debug: 0, config: { iceServers: ICE } });

const enc = (ch: 'b' | 'l', m: unknown) => JSON.stringify({ ch, m });
const dec = (d: unknown): { ch: string; m: unknown } | null => {
  try { const f = JSON.parse(String(d)); return f && (f.ch === 'b' || f.ch === 'l') ? f : null; } catch { return null; }
};

// One link per PeerJS connection, looked up when a 'l' frame arrives.
const linkOf = new WeakMap<DataConnection, PjsLink>();

export class PjsLink implements Link {
  open = false;
  readonly relay = false;
  onMessage?: (msg: Record<string, unknown>) => void;
  onOpen?: () => void;
  onClose?: () => void;
  private fr = new FrameReader();
  constructor(private conn: DataConnection, readonly remote: string) {
    linkOf.set(conn, this);
    if (conn.open) this.ready();
    else conn.on('open', () => this.ready());
    conn.on('close', () => { this.open = false; this.onClose?.(); });
    conn.on('error', (e) => console.warn('[pjs] link error', e));
  }
  private ready() { if (!this.open) { this.open = true; this.onOpen?.(); } }
  feed(m: unknown) {
    const full = this.fr.push(String(m));
    if (full == null) return;
    try { this.onMessage?.(JSON.parse(full)); } catch (e) { console.warn('pjs frame', e); }
  }
  send(msg: Record<string, unknown>) {
    if (!this.open) return;
    const raw = JSON.stringify(msg);
    for (const f of encodeFrames(raw)) this.conn.send(enc('l', f));
  }
  handleBus() { /* P2P is already established — no signalling needed */ }
  get buffered() { return (this.conn as unknown as { bufferSize?: number }).bufferSize ?? 0; }
  close() { try { this.conn.close(); } catch { /* noop */ } this.open = false; }
}

/** Host side: every incoming PeerJS connection joins the star. Bus messages broadcast to all. */
export class PjsHostBus implements Bus {
  private cbs: ((m: BusMsg) => void)[] = [];
  private conns = new Map<string, DataConnection>();
  private peers: Peer[] = [];
  private closed = false;
  attach(peer: Peer) {
    this.peers.push(peer);
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        this.conns.set(conn.peer, conn);
        conn.on('data', (d) => this.onData(conn, d));
        conn.on('close', () => this.conns.delete(conn.peer));
      });
    });
  }
  private onData(conn: DataConnection, d: unknown) {
    const f = dec(d);
    if (!f) return;
    if (f.ch === 'b') { const m = f.m as BusMsg; m._conn = conn; for (const cb of this.cbs) cb(m); }
    else linkOf.get(conn)?.feed(f.m);
  }
  send(msg: BusMsg) { const raw = enc('b', msg); for (const c of this.conns.values()) if (c.open) c.send(raw); }
  onMessage(cb: (m: BusMsg) => void) { this.cbs.push(cb); }
  close() { if (this.closed) return; this.closed = true; for (const p of this.peers) p.destroy(); this.conns.clear(); }
}

/** Client side: a single connection to the host. Sends queue until the channel opens. */
export class PjsClientBus implements Bus {
  private cbs: ((m: BusMsg) => void)[] = [];
  private queue: BusMsg[] = [];
  conn: DataConnection | null = null;
  peer: Peer | null = null;
  onLink?: (l: PjsLink) => void;
  private closed = false;
  attach(peer: Peer, conn: DataConnection) {
    this.peer = peer;
    this.conn = conn;
    conn.on('data', (d) => this.onData(d));
    conn.on('open', () => {
      this.onLink?.(new PjsLink(conn, PJS_PREFIX));
      for (const m of this.queue.splice(0)) conn.send(enc('b', m));
    });
  }
  private onData(d: unknown) {
    const f = dec(d);
    if (!f) return;
    if (f.ch === 'b') for (const cb of this.cbs) cb(f.m as BusMsg);
    else if (this.conn) linkOf.get(this.conn)?.feed(f.m);
  }
  send(msg: BusMsg) {
    if (this.conn?.open) this.conn.send(enc('b', msg));
    else this.queue.push(msg);
  }
  onMessage(cb: (m: BusMsg) => void) { this.cbs.push(cb); }
  close() { if (this.closed) return; this.closed = true; this.peer?.destroy(); }
}

/**
 * Register a host peer under "ww-game-<code>". If the id is taken (stale session),
 * picks a fresh code and calls onCode. onFail fires if the cloud is unreachable.
 */
export async function pjsHost(bus: PjsHostBus, code: string, onCode: (code: string) => void, onFail: (e: unknown) => void) {
  const Peer = await peerjs();
  let attempts = 0;
  const tryPeer = (c: string) => {
    const peer = new Peer(PJS_PREFIX + c, peerOpts());
    let settled = false;
    peer.on('open', () => { settled = true; bus.attach(peer); });
    peer.on('error', (e: { type?: string }) => {
      if (e?.type === 'unavailable-id' && !settled) {
        peer.destroy();
        if (++attempts < 8) { const nc = roomCode(); onCode(nc); tryPeer(nc); }
        else onFail(e);
      } else if (!settled && e?.type !== 'peer-unavailable') onFail(e);
      else console.warn('[pjs] peer error', e?.type);
    });
  };
  tryPeer(code);
}

/** Create a client peer and connect to the host's well-known id. */
export async function pjsClient(bus: PjsClientBus, code: string, name: string, onFail: (e: unknown) => void) {
  const Peer = await peerjs();
  const peer = new Peer(peerOpts());
  let settled = false;
  peer.on('open', () => {
    const conn = peer.connect(PJS_PREFIX + code, { serialization: 'none', reliable: true, metadata: { name } });
    bus.attach(peer, conn);
    conn.on('open', () => { settled = true; });
    conn.on('error', (e) => { if (!settled) onFail(e); });
  });
  peer.on('error', (e: { type?: string }) => {
    if (e?.type === 'peer-unavailable' || !settled) onFail(e);
    else console.warn('[pjs] peer error', e?.type);
  });
}
