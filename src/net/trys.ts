import type { Bus, BusMsg } from './bus';
import { ConnLink, connLinks, decFrame, encFrame, type ConnLike } from './peer';

/**
 * Trystero transport: serverless signalling through many public relays at once
 * (nostr strategy — ~30 independent WebSocket relays, any one is enough to
 * bootstrap). Once peers are introduced, all traffic is browser-to-browser
 * WebRTC. Works across browsers and networks without any keys or servers;
 * TURN is configured for NATs that cannot do direct P2P.
 */

type TrysRoom = ReturnType<typeof import('trystero').joinRoom>;

const APP_ID = 'worldwide-ww-v1';
const roomOf = (code: string) => `ww-room-${code}`;

const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

// Bus message types that can only come from the host — used by clients to
// discover which mesh peer is the room host.
const HOST_MSGS = new Set(['lobby', 'start', 'snap', 'boot', 'kicked', 'chat']);

const ROOM_CONFIG = {
  appId: APP_ID,
  maxUsers: 20,
  maxReceiveBytes: 1 << 26,
  rtcConfig: { iceServers: ICE },
  turnConfig: [{ urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }],
  relayConfig: { redundancy: 5 },
};

/** A ConnLike facade over a Trystero mesh peer — messages are routed by peer id. */
class TrConn implements ConnLike {
  readonly open = true;
  readonly peer: string;
  /** 'l' frames that arrived before the session-level link exists — flushed by ConnLink. */
  readonly pendingL: unknown[] = [];
  private cbs = new Map<string, ((...args: unknown[]) => void)[]>();
  constructor(peer: string, private bus: TrysteroBus) { this.peer = peer; }
  on(evt: 'open' | 'close' | 'error', cb: (...args: unknown[]) => void) {
    const l = this.cbs.get(evt) ?? [];
    l.push(cb);
    this.cbs.set(evt, l);
  }
  emit(evt: string, ...args: unknown[]) { for (const cb of this.cbs.get(evt) ?? []) cb(...args); }
  send(d: unknown) { this.bus.sendTo(this.peer, d); }
  close() { this.emit('close'); }
}

export class TrysteroBus implements Bus {
  private cbs: ((m: BusMsg) => void)[] = [];
  private conns = new Map<string, TrConn>();
  private readyPeers = new Set<string>();
  private probing = new Set<string>();
  private probeTimers = new Map<string, number>();
  private outbox = new Map<string, string[]>();
  private pending: BusMsg[] = [];
  private room: TrysRoom | null = null;
  private act: { send: (d: string, o?: { target?: string }) => Promise<void> } | null = null;
  private isClient = false;
  private hostPeer: string | null = null;
  private closed = false;
  onLink?: (l: ConnLink) => void;
  /** Host side: fires when a new mesh peer joins — used to push lobby state early. */
  peerJoined?: (peerId: string) => void;
  readonly hostFound: Promise<void>;
  private hostResolve!: () => void;

  constructor() { this.hostFound = new Promise((r) => { this.hostResolve = r; }); }

  attach(room: TrysRoom, isClient: boolean) {
    this.room = room;
    this.isClient = isClient;
    const act = room.makeAction<string>('f');
    this.act = act as unknown as TrysteroBus['act'];
    act.onMessage((d, ctx) => this.onData(ctx.peerId, d));
    room.onPeerJoin((p) => { this.connOf(p.peerId); if (!isClient) this.peerJoined?.(p.peerId); }, { replay: true });
    room.onPeerLeave((p) => {
      const c = this.conns.get(p.peerId);
      this.conns.delete(p.peerId);
      this.readyPeers.delete(p.peerId);
      this.outbox.delete(p.peerId);
      const t = this.probeTimers.get(p.peerId);
      if (t !== undefined) { window.clearTimeout(t); this.probeTimers.delete(p.peerId); }
      this.probing.delete(p.peerId);
      if (this.hostPeer === p.peerId) this.hostPeer = null;
      c?.emit('close');
    });
    room.onError((e) => console.warn('[trystero]', e.code, e.message));
    for (const m of this.pending.splice(0)) this.send(m);
  }

  private connOf(peerId: string): TrConn {
    let c = this.conns.get(peerId);
    if (!c) { c = new TrConn(peerId, this); this.conns.set(peerId, c); this.probe(peerId); }
    return c;
  }

  /** Trystero drops sends while the peer's datachannel is still opening, and its
   *  internal ping resolves before user data flows. Probe through the same 'f'
   *  action as real traffic: tping -> tpong proves the channel end to end. */
  private probe(peerId: string) {
    if (this.probing.has(peerId) || this.readyPeers.has(peerId)) return;
    this.probing.add(peerId);
    const attempt = () => {
      this.probeTimers.delete(peerId);
      if (this.closed || this.readyPeers.has(peerId) || !this.conns.has(peerId)) { this.probing.delete(peerId); return; }
      void this.act?.send(encFrame('b', { type: 'tping', from: 'probe' }), { target: peerId }).catch(() => undefined);
      this.probeTimers.set(peerId, window.setTimeout(attempt, 1200) as unknown as number);
    };
    attempt();
  }

  private markReady(peerId: string) {
    if (this.readyPeers.has(peerId)) return;
    this.readyPeers.add(peerId);
    this.probing.delete(peerId);
    const t = this.probeTimers.get(peerId);
    if (t !== undefined) { window.clearTimeout(t); this.probeTimers.delete(peerId); }
    console.info('[trys] peer ready', peerId.slice(0, 6));
    for (const r of this.outbox.get(peerId)?.splice(0) ?? []) void this.act!.send(r, { target: peerId }).catch(() => undefined);
  }

  sendTo(peerId: string, d: unknown) {
    if (!this.act) return;
    const raw = String(d);
    if (this.readyPeers.has(peerId)) {
      void this.act.send(raw, { target: peerId }).catch((e) => console.warn('[trys] sendTo fail', peerId.slice(0, 8), e));
      return;
    }
    const q = this.outbox.get(peerId) ?? this.outbox.set(peerId, []).get(peerId)!;
    if (q.length < 500) q.push(raw);
    this.probe(peerId);
  }

  private onData(peerId: string, d: unknown) {
    const f = decFrame(d);
    if (!f) return;
    const conn = this.connOf(peerId);
    if (f.ch === 'b') {
      const m = f.m as BusMsg;
      if (m.type === 'tping') { void this.act?.send(encFrame('b', { type: 'tpong', from: 'probe' }), { target: peerId }).catch(() => undefined); return; }
      if (m.type === 'tpong') { this.markReady(peerId); return; }
      if (this.isClient) {
        if (!this.hostPeer) {
          if (!HOST_MSGS.has(m.type)) return;
          this.hostPeer = peerId;
          this.hostResolve();
          this.onLink?.(new ConnLink(conn, peerId));
        } else if (peerId !== this.hostPeer) return;
      }
      m._conn = conn;
      for (const cb of this.cbs) cb(m);
    } else {
      const link = connLinks.get(conn);
      if (link) link.feed(f.m);
      else if (conn.pendingL.length < 100) conn.pendingL.push(f.m);
    }
  }

  send(msg: BusMsg) {
    if (!this.act) { this.pending.push(msg); return; }
    const raw = encFrame('b', msg);
    if (this.isClient && this.hostPeer) this.sendTo(this.hostPeer, raw);
    else void this.act.send(raw).catch(() => undefined);
  }

  onMessage(cb: (m: BusMsg) => void) { this.cbs.push(cb); }
  close() {
    if (this.closed) return;
    this.closed = true;
    void this.room?.leave().catch(() => undefined);
    this.conns.clear();
  }
}

/** Open a host room. Signals are announced through the relay set; no fixed peer id needed. */
export async function trysHost(bus: TrysteroBus, code: string): Promise<void> {
  const { joinRoom } = await import('trystero');
  const room = joinRoom(ROOM_CONFIG, roomOf(code));
  bus.attach(room, false);
}

/** Join a host room by code. Resolves once the host is discovered; throws on timeout. */
export async function trysClient(bus: TrysteroBus, code: string): Promise<void> {
  const { joinRoom } = await import('trystero');
  const room = joinRoom(ROOM_CONFIG, roomOf(code));
  bus.attach(room, true);
  const ok = await Promise.race([
    bus.hostFound.then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), 30_000)),
  ]);
  if (!ok) { void room.leave().catch(() => undefined); throw new Error('host-not-found'); }
}
