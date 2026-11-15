import type { Sim, Fx } from '../game/sim';
import { createSim, dispatch } from '../game/game';
import type { Command } from '../game/commands';
import type { CountryState, GameSettings, GameState, LogEntry, Unit } from '../game/types';
import type { World } from '../world/world';
import { openBus, supabaseConfig, type Bus, type BusMsg } from './bus';
import { PeerLink, gunzipJson, gzipJson, type Link } from './peer';
import { PjsClientBus, PjsHostBus, PjsLink, pjsClient, pjsHost } from './pjs';
import type { DataConnection } from 'peerjs';
import { createGame } from '../game/setup';

export interface ChatMsg { from: string; name: string; text: string; to: 'all' | 'allies' | string; t: number }

export interface Session {
  role: 'solo' | 'host' | 'client';
  dispatch(cmd: Command): string | null;
  update(dt: number): void;
  broadcastFx?(fx: Fx[]): void;
  chat(text: string, to: ChatMsg['to']): void;
  chatLog: ChatMsg[];
  status(): string;
  leave(): void;
}

// ================================================================================================ solo
export class SoloSession implements Session {
  role = 'solo' as const;
  chatLog: ChatMsg[] = [];
  constructor(private sim: Sim, private me: string) {}
  dispatch(cmd: Command) { return dispatch(this.sim, this.me, cmd); }
  update(dt: number) { this.sim.update(dt); }
  chat() { /* no-op */ }
  status() { return 'Одиночная игра'; }
  leave() { /* no-op */ }
}

// ================================================================================================ lobby
export interface LobbyPlayer { pid: string; name: string; country: string | null; host: boolean; online: boolean }
export interface LobbyInfo { code: string; name: string; host: string; players: LobbyPlayer[]; settings: GameSettings; started: boolean; max: number }

/** Lists open rooms (announced by hosts on the shared lobby bus). */
export class LobbyBrowser {
  rooms = new Map<string, LobbyInfo & { seen: number }>();
  private bus: Bus;
  onChange?: () => void;
  private timer: number;
  constructor() {
    this.bus = openBus('ww-lobby');
    this.bus.onMessage((m) => {
      if (m.type === 'room') { const r = m.data as LobbyInfo; this.rooms.set(r.code, { ...r, seen: Date.now() }); this.onChange?.(); }
      if (m.type === 'room-closed') { this.rooms.delete(m.data as string); this.onChange?.(); }
    });
    this.bus.send({ type: 'who', from: 'browser' });
    this.timer = window.setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [k, r] of this.rooms) if (now - r.seen > 12000) { this.rooms.delete(k); changed = true; }
      if (changed) this.onChange?.();
    }, 3000);
  }
  close() { window.clearInterval(this.timer); this.bus.close(); }
}

const roomCode = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

// ================================================================================================ host
export class HostSession implements Session {
  role = 'host' as const;
  code = roomCode();
  lobby: LobbyInfo;
  sim: Sim | null = null;
  chatLog: ChatMsg[] = [];
  private bus: Bus;
  private lobbyBus: Bus;
  private links = new Map<string, Link>();
  private announceTimer: number;
  private deltaT = 0;
  private snapT = 0;
  private sentUnits = new Map<number, string>();
  private sentCtrl: string[] = [];
  private sentLog = 0;
  private fxQueue: Fx[] = [];
  private lastSeen = new Map<string, number>();
  onLobby?: () => void;
  onStart?: (sim: Sim) => void;

  constructor(private world: World, private pid: string, name: string, roomName: string, settings: GameSettings, online = false) {
    this.lobby = { code: this.code, name: roomName, host: pid, players: [{ pid, name, country: null, host: true, online: true }], settings, started: false, max: 16 };
    if (online && !supabaseConfig()) {
      // Internet rooms without a configured server: PeerJS public signalling cloud.
      const bus = new PjsHostBus();
      this.bus = bus;
      void pjsHost(bus, this.code, (c) => { this.code = c; this.lobby.code = c; }, () => {
        if (this.bus === bus) { bus.close(); this.bus = openBus('ww-room-' + this.code); this.bus.onMessage((m) => this.onBus(m)); }
      });
    } else this.bus = openBus('ww-room-' + this.code);
    this.lobbyBus = openBus('ww-lobby');
    this.lobbyBus.onMessage((m) => { if (m.type === 'who') this.announce(); });
    this.bus.onMessage((m) => this.onBus(m));
    this.announceTimer = window.setInterval(() => this.announce(), 4000);
    this.announce();
  }

  private announce() { this.lobbyBus.send({ type: 'room', from: this.pid, data: this.lobby }); }
  private pushLobby() { this.bus.send({ type: 'lobby', from: this.pid, data: this.lobby }); this.announce(); this.onLobby?.(); }

  private onBus(m: BusMsg) {
    if (m.to && m.to !== this.pid) return;
    if (m.type === 'hello') {
      const { name } = m.data as { name: string };
      let p = this.lobby.players.find((x) => x.pid === m.from);
      if (!p) {
        if (this.lobby.players.length >= this.lobby.max) return;
        p = { pid: m.from, name, country: null, host: false, online: true };
        this.lobby.players.push(p);
      }
      p.online = true; p.name = name;
      this.lastSeen.set(m.from, Date.now());
      this.links.get(m.from)?.close();
      const link: Link = m._conn ? new PjsLink(m._conn as DataConnection, m.from) : new PeerLink(this.bus, this.pid, m.from, true);
      link.onMessage = (msg) => this.onPeer(m.from, msg);
      link.onOpen = () => { if (this.sim) void this.sendSnapshot(link, true); };
      this.links.set(m.from, link);
      this.pushLobby();
      return;
    }
    if (m.type === 'pick' && !this.lobby.started) {
      const country = m.data as string | null;
      if (country && this.lobby.players.some((x) => x.country === country && x.pid !== m.from)) return;
      const p = this.lobby.players.find((x) => x.pid === m.from);
      if (p) { p.country = country; this.pushLobby(); }
      return;
    }
    if (m.type === 'bye') { this.dropPlayer(m.from); return; }
    if (m.type === 'rtc' || m.type === 'relay') this.links.get(m.from)?.handleBus(m);
  }

  private dropPlayer(pid: string) {
    const p = this.lobby.players.find((x) => x.pid === pid);
    if (!p) return;
    this.links.get(pid)?.close(); this.links.delete(pid);
    if (!this.lobby.started) this.lobby.players = this.lobby.players.filter((x) => x.pid !== pid);
    else {
      p.online = false;
      if (this.sim && p.country) {
        const c = this.sim.s.countries[p.country];
        if (c) { c.player = null; this.sim.log(`📴 ${p.name} отключился — ${c.name} под управлением ИИ`, 'info'); }
      }
    }
    this.pushLobby();
  }

  pick(country: string | null) {
    const me = this.lobby.players.find((x) => x.pid === this.pid)!;
    if (country && this.lobby.players.some((x) => x.country === country && x.pid !== this.pid)) return;
    me.country = country;
    this.pushLobby();
  }

  setSettings(s: Partial<GameSettings>) { Object.assign(this.lobby.settings, s); this.pushLobby(); }

  start() {
    const state = createGame(this.world, this.lobby.settings, Math.floor(Math.random() * 1e9));
    for (const p of this.lobby.players) {
      if (!p.country || !state.countries[p.country]) continue;
      state.countries[p.country].player = p.pid;
      state.players[p.pid] = { name: p.name, country: p.country, color: state.countries[p.country].color };
    }
    this.sim = createSim(this.world, state);
    this.lobby.started = true;
    this.sentCtrl = state.prov.ctrl.slice();
    this.sentLog = 0;
    this.bus.send({ type: 'start', from: this.pid });
    this.pushLobby();
    for (const l of this.links.values()) if (l.open) void this.sendSnapshot(l, true);
    this.onStart?.(this.sim);
  }

  get me() { return this.lobby.players.find((x) => x.pid === this.pid)?.country ?? null; }

  dispatch(cmd: Command) {
    if (!this.sim || !this.me) return null;
    return dispatch(this.sim, this.me, cmd);
  }

  private onPeer(pid: string, msg: Record<string, unknown>) {
    this.lastSeen.set(pid, Date.now());
    const sim = this.sim;
    const p = this.lobby.players.find((x) => x.pid === pid);
    if (msg.k === 'ping') return;
    if (msg.k === 'chat') {
      const c = { ...(msg.c as ChatMsg), from: pid, name: p?.name ?? '?', t: Date.now() };
      this.routeChat(c);
      return;
    }
    if (!sim || !p?.country) return;
    if (msg.k === 'cmd') {
      const cmd = msg.cmd as Command;
      if (cmd.t === 'speed' && cmd.speed !== 0) return; // only the host changes speed; anyone may pause
      const country = sim.s.countries[p.country];
      if (country && !country.player) country.player = pid; // reconnect
      const err = dispatch(sim, p.country, cmd);
      if (err) this.links.get(pid)?.send({ k: 'err', text: err });
    }
  }

  private routeChat(c: ChatMsg) {
    const sim = this.sim;
    const senderCountry = this.lobby.players.find((x) => x.pid === c.from)?.country;
    const recipients = this.lobby.players.filter((p) => {
      if (c.to === 'all') return true;
      if (p.pid === c.from) return true;
      if (c.to === 'allies') return !!(sim && senderCountry && p.country && (p.country === senderCountry || sim.militaryAllies(senderCountry).includes(p.country)));
      return p.country === c.to;
    });
    for (const r of recipients) {
      if (r.pid === this.pid) { this.chatLog.push(c); if (this.chatLog.length > 100) this.chatLog.shift(); }
      else this.links.get(r.pid)?.send({ k: 'chat', c });
    }
  }

  chat(text: string, to: ChatMsg['to']) {
    const name = this.lobby.players.find((x) => x.pid === this.pid)?.name ?? 'Хост';
    this.routeChat({ from: this.pid, name, text, to, t: Date.now() });
  }

  broadcastFx(fx: Fx[]) { if (fx.length) this.fxQueue.push(...fx); }

  update(dt: number) {
    const sim = this.sim;
    if (!sim) return;
    sim.update(dt);
    this.deltaT -= dt; this.snapT -= dt;
    if (this.fxQueue.length) {
      const list = this.fxQueue.splice(0, 400);
      for (const l of this.links.values()) if (l.open && (!l.relay || list.some((f) => f.k === 'launch' || f.k === 'impact' || f.k === 'intercept'))) l.send({ k: 'fx', fx: l.relay ? list.filter((f) => f.k !== 'shot') : list });
    }
    const relayOnly = [...this.links.values()].every((l) => l.relay);
    if (this.deltaT <= 0) { this.deltaT = relayOnly ? 1 : 0.2; this.sendDelta(); }
    if (this.snapT <= 0) { this.snapT = relayOnly ? 10 : 4; for (const l of this.links.values()) if (l.open) void this.sendSnapshot(l, false); }
    // Drop silent peers
    const now = Date.now();
    for (const [pid, t] of this.lastSeen) if (now - t > 30000 && this.lobby.players.find((x) => x.pid === pid)?.online) this.dropPlayer(pid);
  }

  private async sendSnapshot(l: Link, full: boolean) {
    if (!this.sim) return;
    const z = await gzipJson(this.sim.s);
    l.send({ k: 'snap', z, full });
  }

  private sendDelta() {
    const sim = this.sim!;
    const s = sim.s;
    const u: (number | string)[][] = [];
    const add: Unit[] = [];
    const seen = new Set<number>();
    for (const x of s.units) {
      seen.add(x.id);
      const sig = `${x.lat.toFixed(3)},${x.lon.toFixed(3)},${x.str | 0},${x.org | 0},${x.engaged === 0 ? 1 : 0},${x.path.length}`;
      const prev = this.sentUnits.get(x.id);
      if (prev === undefined) add.push(x);
      else if (prev !== sig) u.push([x.id, +x.lat.toFixed(3), +x.lon.toFixed(3), +x.str.toFixed(1), +x.org.toFixed(1), x.engaged, x.path.length ? 1 : 0]);
      this.sentUnits.set(x.id, sig);
    }
    const rm: number[] = [];
    for (const id of this.sentUnits.keys()) if (!seen.has(id)) { rm.push(id); this.sentUnits.delete(id); }
    const pc: (number | string)[][] = [];
    for (let i = 0; i < s.prov.ctrl.length; i++) if (s.prov.ctrl[i] !== this.sentCtrl[i] || s.prov.capture[i] > 0) { pc.push([i, s.prov.ctrl[i], s.prov.owner[i], +s.prov.capture[i].toFixed(2)]); this.sentCtrl[i] = s.prov.ctrl[i]; }
    const newLog = s.log.filter((e) => e.t >= this.sentLog).slice(-40);
    this.sentLog = s.tick;
    const base = { k: 'd', tick: s.tick, speed: s.speed, tension: s.tension, oil: s.oilPrice, u, add, rm, pc, m: s.missiles, wars: s.wars, log: newLog, players: s.players };
    for (const [pid, l] of this.links) {
      if (!l.open) continue;
      const p = this.lobby.players.find((x) => x.pid === pid);
      const me: CountryState | undefined = p?.country ? s.countries[p.country] : undefined;
      const mine = me ? s.units.filter((x) => x.owner === me.id && x.path.length).map((x) => [x.id, x.path] as const) : [];
      l.send({ ...base, me, paths: mine, pend: s.pending.filter((x) => x.country === p?.country) });
    }
  }

  status() {
    const n = [...this.links.values()];
    return `Хост · комната ${this.code} · игроков ${this.lobby.players.filter((p) => p.online).length}${n.some((l) => l.relay) ? ' · ретрансляция' : n.length ? ' · P2P' : ''}`;
  }

  leave() {
    window.clearInterval(this.announceTimer);
    this.lobbyBus.send({ type: 'room-closed', from: this.pid, data: this.code });
    for (const l of this.links.values()) l.close();
    this.bus.close(); this.lobbyBus.close();
  }
}

// ================================================================================================ client
export class ClientSession implements Session {
  role = 'client' as const;
  lobby: LobbyInfo | null = null;
  sim: Sim | null = null;
  chatLog: ChatMsg[] = [];
  private bus: Bus;
  private link: Link | null = null;
  private pingT = 0;
  private applying = Promise.resolve();
  onLobby?: () => void;
  onStart?: (sim: Sim) => void;
  onSnapshot?: () => void;
  onError?: (text: string) => void;
  onFx?: (fx: Fx[]) => void;
  onKicked?: () => void;

  constructor(private world: World, private pid: string, private name: string, readonly code: string, online = false) {
    if (online && !supabaseConfig()) {
      const bus = new PjsClientBus();
      this.bus = bus;
      bus.onLink = (l) => { this.link = l; l.onMessage = (msg) => this.onPeer(msg); };
      void pjsClient(bus, code, name, () => this.onError?.('Комната недоступна или не существует'));
    } else this.bus = openBus('ww-room-' + code);
    this.bus.onMessage((m) => this.onBus(m));
    this.bus.send({ type: 'hello', from: pid, data: { name } });
  }

  private onBus(m: BusMsg) {
    if (m.to && m.to !== this.pid) return;
    if (m.type === 'lobby') { this.lobby = m.data as LobbyInfo; this.onLobby?.(); return; }
    if (m.type === 'rtc' || m.type === 'relay') {
      if (!this.link) {
        this.link = new PeerLink(this.bus, this.pid, m.from, false);
        this.link.onMessage = (msg) => this.onPeer(msg);
      }
      void this.link.handleBus(m);
    }
  }

  pick(country: string | null) { this.bus.send({ type: 'pick', from: this.pid, data: country }); }

  get me() { return this.lobby?.players.find((p) => p.pid === this.pid)?.country ?? null; }

  private onPeer(msg: Record<string, unknown>) {
    switch (msg.k) {
      case 'snap': {
        this.applying = this.applying.then(async () => {
          const st = await gunzipJson<GameState>(msg.z as string);
          if (!this.sim) {
            this.sim = createSim(this.world, st);
            this.onStart?.(this.sim);
          } else {
            const keepFx = this.sim.fx;
            this.sim.s = st;
            this.sim.fx = keepFx;
            this.sim.reindex();
            this.sim.invalidateAllies();
          }
          this.onSnapshot?.();
        });
        break;
      }
      case 'd': {
        const sim = this.sim;
        if (!sim) return;
        const s = sim.s;
        s.tick = msg.tick as number; s.speed = msg.speed as number; s.tension = msg.tension as number; s.oilPrice = msg.oil as number;
        for (const [id, lat, lon, str, org, engaged, moving] of msg.u as number[][]) {
          const x = sim.unit(id);
          if (!x) continue;
          x.lat = lat; x.lon = lon; x.str = str; x.org = org; x.engaged = engaged;
          if (!moving) x.path = [];
        }
        for (const x of msg.add as Unit[]) if (!sim.unit(x.id)) { s.units.push(x); }
        if ((msg.rm as number[]).length) { const rm = new Set(msg.rm as number[]); s.units = s.units.filter((x) => !rm.has(x.id)); }
        sim.reindex();
        for (const [id, path] of (msg.paths as [number, Unit['path']][]) ?? []) { const x = sim.unit(id); if (x) x.path = path; }
        for (const [i, ctrl, owner, cap] of msg.pc as [number, string, string, number][]) { s.prov.ctrl[i] = ctrl; s.prov.owner[i] = owner; s.prov.capture[i] = cap; }
        const live = new Map(s.missiles.map((m) => [m.id, m]));
        s.missiles = (msg.m as GameState['missiles']).map((m) => { const old = live.get(m.id); return old && old.elapsed > m.elapsed ? { ...m, elapsed: old.elapsed } : m; });
        s.wars = msg.wars as GameState['wars'];
        s.players = msg.players as GameState['players'];
        for (const e of msg.log as LogEntry[]) if (!s.log.some((x) => x.t === e.t && x.text === e.text)) s.log.push(e);
        if (msg.me) { const me = msg.me as CountryState; s.countries[me.id] = me; }
        s.pending = (msg.pend as GameState['pending']) ?? [];
        sim.invalidateAllies();
        break;
      }
      case 'fx': {
        const sim = this.sim;
        if (!sim) return;
        for (const f of msg.fx as Fx[]) sim.fx.push(f);
        break;
      }
      case 'chat': this.chatLog.push(msg.c as ChatMsg); if (this.chatLog.length > 100) this.chatLog.shift(); break;
      case 'err': this.onError?.(msg.text as string); break;
    }
  }

  dispatch(cmd: Command) {
    if (!this.link?.open) return 'Нет соединения с хостом';
    this.link.send({ k: 'cmd', cmd });
    return null;
  }

  chat(text: string, to: ChatMsg['to']) { this.link?.send({ k: 'chat', c: { text, to } }); }

  update(dt: number) {
    const sim = this.sim;
    if (sim && sim.s.speed > 0) for (const m of sim.s.missiles) m.elapsed += dt;
    this.pingT -= dt;
    if (this.pingT <= 0) { this.pingT = 5; this.link?.send({ k: 'ping' }); if (!this.link && !this.sim) this.bus.send({ type: 'hello', from: this.pid, data: { name: this.name } }); }
  }

  status() { return `Клиент · комната ${this.code}${this.link?.relay ? ' · ретрансляция' : this.link?.open ? ' · P2P' : ' · подключение…'}`; }

  leave() { this.bus.send({ type: 'bye', from: this.pid }); this.link?.close(); this.bus.close(); }
}

