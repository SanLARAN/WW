import type { Bus, BusMsg } from './bus';

const ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const CHUNK = 60_000;

export async function gzipJson(obj: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function gunzipJson<T>(b64: string): Promise<T> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text()) as T;
}

/**
 * Reliable message link to one remote peer. Prefers a WebRTC data channel (peer-to-peer, no server
 * bandwidth), falls back to relaying through the signalling bus if P2P cannot be established.
 */
export class PeerLink {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private parts = new Map<string, string[]>();
  relay = false;
  open = false;
  onMessage?: (msg: Record<string, unknown>) => void;
  onOpen?: () => void;
  onClose?: () => void;
  private fallbackTimer: number;

  constructor(private bus: Bus, private me: string, readonly remote: string, initiator: boolean) {
    try {
      this.pc = new RTCPeerConnection({ iceServers: ICE });
      this.pc.onicecandidate = (e) => { if (e.candidate) this.signal('ice', e.candidate.toJSON()); };
      this.pc.onconnectionstatechange = () => {
        const st = this.pc?.connectionState;
        if ((st === 'failed' || st === 'disconnected') && !this.relay) this.useRelay();
      };
      if (initiator) {
        this.setupChannel(this.pc.createDataChannel('ww', { ordered: true }));
        void this.pc.createOffer().then((o) => this.pc!.setLocalDescription(o)).then(() => this.signal('sdp', this.pc!.localDescription!.toJSON()));
      } else this.pc.ondatachannel = (e) => this.setupChannel(e.channel);
    } catch { this.useRelay(); }
    this.fallbackTimer = window.setTimeout(() => { if (!this.open) this.useRelay(); }, 9000);
  }

  private signal(kind: string, data: unknown) { this.bus.send({ type: 'rtc', from: this.me, to: this.remote, data: { kind, data } }); }

  /** Feed signalling/relay messages addressed to us from the remote peer. */
  async handleBus(msg: BusMsg) {
    if (msg.type === 'relay') { this.receive(msg.data as string); return; }
    if (msg.type !== 'rtc' || !this.pc) return;
    const { kind, data } = msg.data as { kind: string; data: RTCSessionDescriptionInit & RTCIceCandidateInit };
    try {
      if (kind === 'sdp') {
        await this.pc.setRemoteDescription(data);
        if (data.type === 'offer') {
          const ans = await this.pc.createAnswer();
          await this.pc.setLocalDescription(ans);
          this.signal('sdp', this.pc.localDescription!.toJSON());
        }
      } else if (kind === 'ice') await this.pc.addIceCandidate(data);
    } catch (e) { console.warn('rtc signalling', e); }
  }

  private setupChannel(dc: RTCDataChannel) {
    this.dc = dc;
    dc.onopen = () => { this.open = true; this.relay = false; window.clearTimeout(this.fallbackTimer); this.onOpen?.(); };
    dc.onclose = () => { if (!this.relay) { this.open = false; this.onClose?.(); } };
    dc.onmessage = (e) => this.receive(e.data as string);
  }

  private useRelay() {
    if (this.relay) return;
    this.relay = true;
    const wasOpen = this.open;
    this.open = true;
    console.info('[net] P2P unavailable, relaying via server for', this.remote);
    if (!wasOpen) this.onOpen?.();
  }

  private receive(raw: string) {
    // Chunked frames: "#id|i|n|payload"
    if (raw.startsWith('#')) {
      const a = raw.indexOf('|'), b = raw.indexOf('|', a + 1), c = raw.indexOf('|', b + 1);
      const id = raw.slice(1, a), i = +raw.slice(a + 1, b), n = +raw.slice(b + 1, c);
      let list = this.parts.get(id);
      if (!list) this.parts.set(id, (list = new Array(n)));
      list[i] = raw.slice(c + 1);
      if (list.filter((x) => x !== undefined).length < n) return;
      this.parts.delete(id);
      raw = list.join('');
    }
    try { this.onMessage?.(JSON.parse(raw)); } catch (e) { console.warn('bad frame', e); }
  }

  send(msg: Record<string, unknown>) {
    if (!this.open) return;
    const raw = JSON.stringify(msg);
    const frames: string[] = [];
    if (raw.length <= CHUNK) frames.push(raw);
    else {
      const id = Math.random().toString(36).slice(2, 8);
      const n = Math.ceil(raw.length / CHUNK);
      for (let i = 0; i < n; i++) frames.push(`#${id}|${i}|${n}|${raw.slice(i * CHUNK, (i + 1) * CHUNK)}`);
    }
    for (const f of frames) {
      if (this.relay || !this.dc || this.dc.readyState !== 'open') this.bus.send({ type: 'relay', from: this.me, to: this.remote, data: f });
      else this.dc.send(f);
    }
  }

  get buffered() { return this.dc?.bufferedAmount ?? 0; }

  close() {
    window.clearTimeout(this.fallbackTimer);
    this.dc?.close(); this.pc?.close();
    this.open = false;
  }
}
