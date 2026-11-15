import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

export interface BusMsg { type: string; from: string; to?: string; data?: unknown; _conn?: unknown }

/** Pub/sub message bus used for lobby discovery, signalling and relay fallback. */
export interface Bus {
  send(msg: BusMsg): void;
  onMessage(cb: (msg: BusMsg) => void): void;
  close(): void;
}

export interface SupabaseConfig { url: string; key: string }

export function supabaseConfig(): SupabaseConfig | null {
  const url = (localStorage.getItem('ww.sb.url') || import.meta.env.VITE_SUPABASE_URL || '').trim();
  const key = (localStorage.getItem('ww.sb.key') || import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
  return url && key ? { url, key } : null;
}

let client: SupabaseClient | null = null;
function sb(cfg: SupabaseConfig) {
  if (!client) client = createClient(cfg.url, cfg.key, { realtime: { params: { eventsPerSecond: 20 } } });
  return client;
}

class SupabaseBus implements Bus {
  private ch: RealtimeChannel;
  private cbs: ((m: BusMsg) => void)[] = [];
  private queue: BusMsg[] = [];
  private ready = false;
  constructor(cfg: SupabaseConfig, name: string) {
    this.ch = sb(cfg).channel(name, { config: { broadcast: { self: false, ack: false } } });
    this.ch.on('broadcast', { event: 'm' }, ({ payload }) => { for (const cb of this.cbs) cb(payload as BusMsg); });
    this.ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') { this.ready = true; for (const m of this.queue.splice(0)) this.send(m); }
    });
  }
  send(msg: BusMsg) {
    if (!this.ready) { this.queue.push(msg); return; }
    void this.ch.send({ type: 'broadcast', event: 'm', payload: msg });
  }
  onMessage(cb: (m: BusMsg) => void) { this.cbs.push(cb); }
  close() { void this.ch.unsubscribe(); }
}

class LocalBus implements Bus {
  private ch: BroadcastChannel;
  private cbs: ((m: BusMsg) => void)[] = [];
  constructor(name: string) {
    this.ch = new BroadcastChannel('ww:' + name);
    this.ch.onmessage = (e) => { for (const cb of this.cbs) cb(e.data as BusMsg); };
  }
  send(msg: BusMsg) { this.ch.postMessage(msg); }
  onMessage(cb: (m: BusMsg) => void) { this.cbs.push(cb); }
  close() { this.ch.close(); }
}

export type NetMode = 'online' | 'local';
export const netMode = (): NetMode => (supabaseConfig() ? 'online' : 'local');

export function openBus(name: string): Bus {
  const cfg = supabaseConfig();
  return cfg ? new SupabaseBus(cfg, name) : new LocalBus(name);
}
