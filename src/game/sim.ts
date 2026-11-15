import type { World } from '../world/world';
import { TERRAIN_INFO, Terrain } from '../world/worldTypes';
import { distKm, gcLerp, stepToward } from '../core/geo';
import { mulberry32 } from '../core/rng';
import { MISSILE, UNIT, unitName } from '../data/military';
import { ALLIANCE_INFO, tierRank } from '../data/countries';
import type { CountryState, GameState, LL, LogEntry, Missile, MissileType, Unit, UnitType, War } from './types';
import { dateOf } from './types';

export type Fx =
  | { k: 'launch'; m: Missile }
  | { k: 'intercept'; m: Missile; at: LL; by: LL }
  | { k: 'impact'; m: Missile; at: LL }
  | { k: 'shot'; from: LL; to: LL; kind: 'art' | 'air' | 'drone' | 'ad' | 'gun' | 'navy' }
  | { k: 'capture'; p: number; by: string }
  | { k: 'destroyed'; at: LL; type: UnitType; owner: string }
  | { k: 'war'; war: War }
  | { k: 'peace'; a: string; b: string };

export const HOURS_PER_SEC = [0, 1, 3, 8, 20, 48];

export class Sim {
  rng: () => number;
  fx: Fx[] = [];
  private acc = 0;
  private hookDaily: ((sim: Sim) => void)[] = [];
  private hookHourly: ((sim: Sim) => void)[] = [];
  private unitIndex = new Map<number, Unit>();
  /** Spatial hash rebuilt each hour. */
  private grid = new Map<number, Unit[]>();
  onLog?: (e: LogEntry) => void;

  constructor(public world: World, public s: GameState) {
    this.rng = mulberry32(s.seed ^ s.tick);
    this.reindex();
  }

  onDaily(f: (sim: Sim) => void) { this.hookDaily.push(f); }
  onHourly(f: (sim: Sim) => void) { this.hookHourly.push(f); }

  get date() { return dateOf(this.s.tick); }
  c(id: string): CountryState | undefined { return this.s.countries[id]; }
  unit(id: number) { return this.unitIndex.get(id); }
  reindex() { this.unitIndex.clear(); for (const u of this.s.units) this.unitIndex.set(u.id, u); }

  // ---------------------------------------------------------------- relations & wars
  static key(a: string, b: string) { return a < b ? `${a}|${b}` : `${b}|${a}`; }
  rel(a: string, b: string) { return a === b ? 100 : this.s.relations[Sim.key(a, b)] ?? 0; }
  addRel(a: string, b: string, d: number) {
    if (a === b) return;
    const k = Sim.key(a, b);
    this.s.relations[k] = Math.max(-100, Math.min(100, (this.s.relations[k] ?? 0) + d));
  }
  setRel(a: string, b: string, v: number) { if (a !== b) this.s.relations[Sim.key(a, b)] = Math.max(-100, Math.min(100, v)); }

  sideOf(w: War, c: string): 'a' | 'd' | null { return w.attackers.includes(c) ? 'a' : w.defenders.includes(c) ? 'd' : null; }
  atWar(a: string, b: string): boolean {
    if (a === b) return false;
    for (const w of this.s.wars) {
      const sa = this.sideOf(w, a), sb = this.sideOf(w, b);
      if (sa && sb && sa !== sb) return true;
    }
    return false;
  }
  enemiesOf(c: string): string[] {
    const out = new Set<string>();
    for (const w of this.s.wars) {
      const sd = this.sideOf(w, c);
      if (sd) for (const e of sd === 'a' ? w.defenders : w.attackers) out.add(e);
    }
    return [...out];
  }
  inWar(c: string) { return this.s.wars.some((w) => this.sideOf(w, c)); }
  private allyCache = new Map<string, string[]>();
  invalidateAllies() { this.allyCache.clear(); }
  militaryAllies(c: string): string[] {
    const hit = this.allyCache.get(c);
    if (hit) return hit;
    const me = this.s.countries[c];
    if (!me) return [];
    const mil = me.alliances.filter((a) => ALLIANCE_INFO[a]?.military ?? a.startsWith('X'));
    const res = Object.values(this.s.countries).filter((o) => o.id !== c && o.alive && o.alliances.some((a) => mil.includes(a))).map((o) => o.id);
    this.allyCache.set(c, res);
    return res;
  }
  friendly(a: string, b: string) { return a === b || (!this.atWar(a, b) && (this.militaryAllies(a).includes(b) || this.s.wars.some((w) => { const x = this.sideOf(w, a); return x && x === this.sideOf(w, b); }))); }

  log(text: string, kind: LogEntry['kind'] = 'info', country?: string) {
    const e: LogEntry = { t: this.s.tick, text, kind, country };
    this.s.log.push(e);
    if (this.s.log.length > 300) this.s.log.splice(0, this.s.log.length - 300);
    this.onLog?.(e);
  }

  mod(c: CountryState, key: string) { return c.modifiers[key] ?? 0; }
  addMod(c: CountryState, key: string, v: number) { c.modifiers[key] = (c.modifiers[key] ?? 0) + v; }

  /** Timed flag on a country ("<prefix><key>_<untilTick>"). */
  flagUntil(c: CountryState, prefix: string, key: string): number {
    const p = prefix + key + '_';
    const f = c.flags.find((x) => x.startsWith(p));
    return f ? +f.slice(p.length) || 0 : 0;
  }
  setFlagUntil(c: CountryState, prefix: string, key: string, until: number) {
    const p = prefix + key + '_';
    if (c.flags.some((x) => x.startsWith(p))) c.flags = c.flags.filter((x) => !x.startsWith(p));
    if (until > this.s.tick) c.flags.push(p + Math.round(until));
  }
  /** Country `holder` remembers harm done by `toward` for `days`. Blocks cheap diplomacy. */
  addGrudge(holder: string, toward: string, days: number) {
    const c = this.c(holder);
    if (!c || holder === toward) return;
    this.setFlagUntil(c, 'grudge_', toward, Math.max(this.flagUntil(c, 'grudge_', toward), this.s.tick + days * 24));
  }

  declareWar(att: string, def: string, cb: string): War | null {
    const A = this.c(att), D = this.c(def);
    if (!A || !D || att === def || this.atWar(att, def)) return null;
    const war: War = { id: this.s.nextId++, name: `${A.name} против ${D.name}`, attackers: [att], defenders: [def], start: this.s.tick, cb };
    this.s.wars.push(war);
    this.setRel(att, def, -100);
    this.addGrudge(def, att, 1825); this.addGrudge(att, def, 365);
    const unjust = cb === 'none';
    A.opinion -= unjust ? 35 : 10;
    this.s.tension = Math.min(100, this.s.tension + (tierRank(D.tier) <= 2 || tierRank(A.tier) <= 2 ? 15 : 6));
    for (const o of Object.values(this.s.countries)) if (o.id !== att && o.id !== def) this.addRel(o.id, att, unjust ? -25 : -8);
    // Call defensive allies.
    for (const ally of this.militaryAllies(def)) {
      if (ally === att || war.defenders.includes(ally) || this.militaryAllies(att).includes(ally)) continue;
      const AL = this.c(ally)!;
      if (AL.player) { this.log(`${D.name} просит помощи: союзнический долг зовёт ${AL.name} в войну`, 'war', ally); continue; }
      war.defenders.push(ally);
      this.setRel(ally, att, -90);
      this.addGrudge(ally, att, 1095);
    }
    for (const g of Object.values(this.s.countries)) {
      if (g.guarantees.includes(def) && !war.defenders.includes(g.id) && g.id !== att && !g.player) { war.defenders.push(g.id); this.setRel(g.id, att, -80); this.addGrudge(g.id, att, 1095); }
    }
    this.log(`⚔ ${A.name} объявляет войну: ${D.name}${war.defenders.length > 1 ? ` (+${war.defenders.length - 1} союзн.)` : ''}`, 'war');
    this.fx.push({ k: 'war', war });
    return war;
  }

  joinWar(c: string, war: War, side: 'a' | 'd') {
    if (this.sideOf(war, c)) return;
    (side === 'a' ? war.attackers : war.defenders).push(c);
    for (const e of side === 'a' ? war.defenders : war.attackers) { this.setRel(c, e, -90); this.addGrudge(c, e, 1095); this.addGrudge(e, c, 730); }
    this.log(`${this.c(c)!.name} вступает в войну «${war.name}»`, 'war');
  }

  /** Remove `loser` (and optionally end war). annex: occupied provinces go to their controllers. */
  makePeace(a: string, b: string, annex: boolean) {
    const P = this.s.prov;
    for (const w of [...this.s.wars]) {
      const sa = this.sideOf(w, a), sb = this.sideOf(w, b);
      if (!sa || !sb || sa === sb) continue;
      // Remove b from the war (b is the side being dealt with); if b was the war leader, end the war.
      const bLeader = (sb === 'a' ? w.attackers[0] : w.defenders[0]) === b;
      const aLeader = (sa === 'a' ? w.attackers[0] : w.defenders[0]) === a;
      if (bLeader && aLeader) this.s.wars.splice(this.s.wars.indexOf(w), 1);
      else {
        const list = sb === 'a' ? w.attackers : w.defenders;
        list.splice(list.indexOf(b), 1);
        if (!list.length) this.s.wars.splice(this.s.wars.indexOf(w), 1);
      }
    }
    for (let i = 0; i < P.owner.length; i++) {
      const owner = P.owner[i], ctrl = P.ctrl[i];
      if (owner === b && ctrl === a) { if (annex) P.owner[i] = a; else P.ctrl[i] = b; }
      else if (owner === a && ctrl === b) P.ctrl[i] = a;
      else continue;
      P.capture[i] = 0; P.captureBy[i] = null;
    }
    this.setRel(a, b, -30);
    this.log(`🕊 Мир между ${this.c(a)!.name} и ${this.c(b)!.name}${annex ? ' (аннексия оккупированных территорий)' : ''}`, 'diplo');
    this.fx.push({ k: 'peace', a, b });
    this.checkAlive();
  }

  checkAlive() {
    const P = this.s.prov;
    const has = new Set(P.owner);
    for (const c of Object.values(this.s.countries)) {
      if (c.alive && !has.has(c.id)) {
        c.alive = false;
        this.s.units = this.s.units.filter((u) => u.owner !== c.id);
        this.reindex();
        for (const w of [...this.s.wars]) {
          for (const list of [w.attackers, w.defenders]) { const i = list.indexOf(c.id); if (i >= 0) list.splice(i, 1); }
          if (!w.attackers.length || !w.defenders.length) this.s.wars.splice(this.s.wars.indexOf(w), 1);
        }
        this.log(`☠ ${c.name} прекращает существование`, 'war');
      }
    }
  }

  // ---------------------------------------------------------------- units
  spawnUnit(owner: string, type: UnitType, lat: number, lon: number): Unit {
    const c = this.c(owner)!;
    const n = this.s.units.filter((u) => u.owner === owner && u.type === type).length + 1;
    const u: Unit = { id: this.s.nextId++, type, owner, name: unitName(type, n), lat, lon, str: 100, org: 80, xp: 0, path: [], ammo: UNIT[type].ammo * (1 + this.mod(c, 'ad_ammo')), engaged: 99, hold: false };
    this.s.units.push(u);
    this.unitIndex.set(u.id, u);
    return u;
  }

  removeUnit(u: Unit) {
    const i = this.s.units.indexOf(u);
    if (i >= 0) this.s.units.splice(i, 1);
    this.unitIndex.delete(u.id);
  }

  /** Find a water position near a coastal province for naval spawns. */
  seaNear(lat: number, lon: number): LL | null {
    for (let r = 0.3; r < 6; r += 0.3) {
      for (let a = 0; a < 16; a++) {
        const la = lat + Math.sin((a / 16) * Math.PI * 2) * r, lo = lon + (Math.cos((a / 16) * Math.PI * 2) * r) / Math.max(0.3, Math.cos((lat * Math.PI) / 180));
        if (!this.world.isLand(la, lo)) return { lat: la, lon: lo };
      }
    }
    return null;
  }

  orderMove(u: Unit, lat: number, lon: number): boolean {
    const dom = UNIT[u.type].domain;
    if (dom === 'air') { u.path = [{ lat, lon }]; return true; }
    if (dom === 'sea') {
      const p = this.world.findPath(u.lat, u.lon, lat, lon, 2);
      if (!p) return false;
      u.path = p; return true;
    }
    let p = this.world.findPath(u.lat, u.lon, lat, lon, 1, 40000);
    if (!p) p = this.world.findPath(u.lat, u.lon, lat, lon, 3, 40000); // amphibious: land + sea
    if (!p) return false;
    u.path = p;
    return true;
  }

  // ---------------------------------------------------------------- main loop
  update(realDt: number) {
    if (this.s.speed > 0) {
      this.acc += realDt * HOURS_PER_SEC[this.s.speed];
      let n = 0;
      while (this.acc >= 1 && n++ < 72) { this.acc -= 1; this.hour(); }
      if (this.acc > 72) this.acc = 0;
      this.updateMissiles(realDt);
    }
  }

  private hour() {
    this.s.tick++;
    this.rebuildGrid();
    this.moveUnits();
    this.combat();
    this.capture();
    for (const f of this.hookHourly) f(this);
    if (this.s.tick % 24 === 0) { this.day(); for (const f of this.hookDaily) f(this); }
  }

  private day() {
    const P = this.s.prov;
    // Capitulation checks
    for (const c of Object.values(this.s.countries)) {
      if (!c.alive || !this.inWar(c.id)) continue;
      let own = 0, held = 0, pop = 0, popHeld = 0;
      for (let i = 0; i < P.owner.length; i++) {
        if (P.owner[i] !== c.id) continue;
        own++; const ps = this.world.provinces[i].popShare; pop += ps;
        if (P.ctrl[i] === c.id) { held++; popHeld += ps; }
      }
      const capLost = P.ctrl[c.capital] !== c.id;
      if (own && (popHeld / Math.max(1e-6, pop) < (capLost ? 0.55 : 0.3))) this.capitulate(c);
    }
    this.s.tension = Math.max(0, this.s.tension - 0.05);
    this.invalidateAllies();
  }

  capitulate(c: CountryState) {
    const P = this.s.prov;
    const occupiers = new Set<string>();
    for (let i = 0; i < P.owner.length; i++) if (P.owner[i] === c.id && P.ctrl[i] !== c.id) occupiers.add(P.ctrl[i]);
    this.log(`🏳 ${c.name} капитулирует!`, 'war');
    for (const o of occupiers) if (this.atWar(o, c.id)) this.makePeace(o, c.id, true);
    for (const e of this.enemiesOf(c.id)) this.makePeace(e, c.id, false);
    c.stability = Math.max(5, c.stability - 30);
    c.warExhaustion = 0;
  }

  private cellKey(lat: number, lon: number) { return (Math.floor(lat + 90) << 9) | Math.floor(lon + 180); }
  private rebuildGrid() {
    this.grid.clear();
    for (const u of this.s.units) {
      const k = this.cellKey(u.lat, u.lon);
      let l = this.grid.get(k); if (!l) this.grid.set(k, (l = [])); l.push(u);
    }
  }
  /** Units within km of a point (approximate, grid-based). */
  near(lat: number, lon: number, km: number, filter?: (u: Unit) => boolean): Unit[] {
    const out: Unit[] = [];
    const dLat = Math.ceil(km / 111) , dLon = Math.ceil(km / (111 * Math.max(0.15, Math.cos((lat * Math.PI) / 180))));
    const cy = Math.floor(lat + 90), cx = Math.floor(lon + 180);
    for (let y = cy - dLat; y <= cy + dLat; y++) {
      if (y < 0 || y >= 180) continue;
      for (let x = cx - dLon; x <= cx + dLon; x++) {
        const l = this.grid.get((y << 9) | (((x % 360) + 360) % 360));
        if (!l) continue;
        for (const u of l) if ((!filter || filter(u)) && distKm(lat, lon, u.lat, u.lon) <= km) out.push(u);
      }
    }
    return out;
  }

  weather(lat: number): { atk: number; move: number; name: string } {
    const m = this.date.getUTCMonth();
    const north = lat > 0;
    const winter = north ? m === 11 || m <= 1 : m >= 5 && m <= 7;
    const mud = north ? m === 2 || m === 3 || m === 10 : m === 4 || m === 8;
    if (Math.abs(lat) > 40 && winter) return { atk: 0.75, move: 0.7, name: 'Зима' };
    if (Math.abs(lat) > 45 && mud) return { atk: 0.9, move: 0.7, name: 'Распутица' };
    return { atk: 1, move: 1, name: 'Ясно' };
  }

  supply(u: Unit): number {
    const p = this.world.provinceAt(u.lat, u.lon);
    if (p < 0) return UNIT[u.type].domain === 'land' ? 0.5 : 1;
    const ctrl = this.s.prov.ctrl[p];
    const terr = TERRAIN_INFO[this.world.provinces[p].terrain].supply;
    const c = this.c(u.owner)!;
    const oil = c.stock.oil > 0 ? 1 : 0.75;
    if (this.friendly(ctrl, u.owner)) return terr * oil;
    const adj = this.world.provinces[p].neighbors.some((n) => this.friendly(this.s.prov.ctrl[n], u.owner));
    return (adj ? 0.85 : 0.55) * terr * oil;
  }

  private moveUnits() {
    for (const u of this.s.units) {
      if (!u.path.length) continue;
      const st = UNIT[u.type];
      if (st.domain === 'land' && u.engaged === 0 && u.type !== 'drones') continue; // pinned by combat
      let km = st.speed;
      if (st.domain === 'land') {
        const p = this.world.provinceAt(u.lat, u.lon);
        const onLand = p >= 0;
        km *= onLand ? TERRAIN_INFO[this.world.provinces[p].terrain].move * this.weather(u.lat).move : 12;
        if (u.type === 'drones') km = st.speed;
        km *= 0.5 + u.org / 200;
      }
      while (km > 0 && u.path.length) {
        const wp = u.path[0];
        const d = distKm(u.lat, u.lon, wp.lat, wp.lon);
        const r = stepToward(u.lat, u.lon, wp.lat, wp.lon, km);
        u.lat = r.lat; u.lon = r.lon;
        km -= Math.min(km, d);
        if (r.arrived) u.path.shift();
      }
    }
  }

  private hostile(a: Unit, b: Unit) { return a.owner !== b.owner && this.atWar(a.owner, b.owner); }

  private combat() {
    const casualties = new Map<string, number>();
    let shots = 0;
    const dead: Unit[] = [];
    for (const u of this.s.units) u.engaged = Math.min(99, u.engaged + 1);
    for (const a of this.s.units) {
      if (a.str <= 0) continue;
      const st = UNIT[a.type];
      const A = this.c(a.owner)!;
      if (a.type === 'airdef') { this.airDefence(a); continue; }
      if (!this.enemiesOf(a.owner).length) continue;
      const targets = this.near(a.lat, a.lon, st.range, (b) => b.str > 0 && this.hostile(a, b) && canHit(a.type, b.type));
      if (!targets.length) continue;
      let t = targets[0], best = Infinity;
      for (const b of targets) { const d = distKm(a.lat, a.lon, b.lat, b.lon); if (d < best) { best = d; t = b; } }
      const B = this.c(t.owner)!;
      const tst = UNIT[t.type];
      const p = this.world.provinceAt(t.lat, t.lon);
      const terr = p >= 0 ? this.world.provinces[p].terrain : Terrain.Plains;
      const urban = p >= 0 && this.world.provinces[p].light > 0.3 ? 1.35 : 1;
      const fort = p >= 0 && this.s.prov.ctrl[p] === t.owner ? 1 + (this.s.prov.buildings[p].bunker ?? 0) * 0.2 + this.mod(B, 'fort') : 1;
      let atkMod = 1 + this.mod(A, 'atk_land') + (a.type === 'drones' ? this.mod(A, 'drone_atk') : 0) + (a.type === 'air' ? this.mod(A, 'air_atk') : 0);
      if (a.type === 'drones') {
        const ew = this.near(t.lat, t.lon, 40, (x) => x.owner === t.owner).length ? this.mod(B, 'ew') : 0;
        atkMod *= 1 - Math.max(0, ew - this.mod(A, 'ew_resist'));
      }
      const techA = 1 + (A.tech - 5) * 0.07, techB = 1 + (B.tech - 5) * 0.07;
      const power = st.atk * (a.str / 100) * (0.35 + (0.65 * a.org) / 100) * atkMod * techA * (1 + a.xp * 0.5) * this.supply(a) * (st.domain === 'land' ? this.weather(a.lat).atk : 1);
      const defMod = (tst.domain === 'land' ? TERRAIN_INFO[terr].defense * urban * fort : 1) * (t.type === 'armor' ? 1 + this.mod(B, 'def_armor') : 1) * (t.type === 'air' ? 1 + this.mod(B, 'air_def') : 1);
      const defense = tst.def * defMod * techB * (1 + t.xp * 0.3) * (t.engaged > 6 && tst.domain === 'land' ? 1.15 : 1);
      const embarked = tst.domain === 'land' && p < 0 ? 0.35 : 1;
      const dmg = (0.055 * power * 10) / (defense * embarked + 4);
      t.str -= dmg * (1 + this.mod(B, 'losses'));
      t.org -= dmg * 2.6;
      a.engaged = 0; t.engaged = 0;
      a.xp = Math.min(1, a.xp + 0.0015); t.xp = Math.min(1, t.xp + 0.001);
      casualties.set(t.owner, (casualties.get(t.owner) ?? 0) + dmg * tst.manpower * 0.01);
      if (shots < 50 && this.rng() < (a.type === 'artillery' || a.type === 'air' ? 0.5 : 0.22)) {
        shots++;
        const kind = a.type === 'artillery' ? 'art' : a.type === 'air' ? 'air' : a.type === 'drones' ? 'drone' : a.type === 'navy' ? 'navy' : 'gun';
        this.fx.push({ k: 'shot', from: { lat: a.lat, lon: a.lon }, to: { lat: t.lat, lon: t.lon }, kind });
      }
      if (t.str <= 1) dead.push(t);
      else if (t.org < 12 && tst.domain === 'land' && !t.path.length) this.retreat(t);
    }
    for (const t of dead) {
      if (!this.unitIndex.has(t.id)) continue;
      this.removeUnit(t);
      this.fx.push({ k: 'destroyed', at: { lat: t.lat, lon: t.lon }, type: t.type, owner: t.owner });
      this.log(`💥 Уничтожена ${t.name} (${this.c(t.owner)!.name})`, 'war', t.owner);
    }
    for (const [cid, k] of casualties) {
      const c = this.c(cid)!;
      c.warExhaustion = Math.min(100, c.warExhaustion + k * 0.02);
      c.manpower = Math.max(0, c.manpower - k);
    }
    // Recovery
    for (const u of this.s.units) {
      if (u.engaged < 3) continue;
      const c = this.c(u.owner)!;
      const sup = this.supply(u);
      u.org = Math.min(100, u.org + 1.6 * sup * (1 + this.mod(c, 'org_regen')));
      if (sup >= 0.85 && u.str < 100 && c.manpower > 1 && c.budget > -c.gdp * 0.2) {
        const add = 0.12;
        u.str = Math.min(100, u.str + add);
        c.manpower -= add * UNIT[u.type].manpower * 0.01;
      }
      if (u.type === 'airdef' && u.ammo < UNIT.airdef.ammo * (1 + this.mod(c, 'ad_ammo')) && this.s.tick % 6 === 0) u.ammo += 1;
    }
  }

  private retreat(u: Unit) {
    const p = this.world.provinceAt(u.lat, u.lon);
    if (p < 0) return;
    const q = [p], seen = new Set([p]);
    while (q.length) {
      const x = q.shift()!;
      if (this.s.prov.ctrl[x] === u.owner && this.near(this.world.provinces[x].lat, this.world.provinces[x].lon, 30, (e) => this.hostile(u, e)).length === 0) {
        this.orderMove(u, this.world.provinces[x].lat, this.world.provinces[x].lon);
        return;
      }
      if (seen.size > 60) return;
      for (const n of this.world.provinces[x].neighbors) if (!seen.has(n)) { seen.add(n); q.push(n); }
    }
  }

  private airDefence(ad: Unit) {
    if (ad.ammo < 1) return;
    const A = this.c(ad.owner)!;
    const range = UNIT.airdef.range * (1 + this.mod(A, 'ad_range'));
    const t = this.near(ad.lat, ad.lon, range, (b) => (b.type === 'air' || b.type === 'drones') && this.hostile(ad, b))[0];
    if (!t) return;
    ad.ammo -= 1; ad.engaged = 0;
    const B = this.c(t.owner)!;
    const p = 0.45 * (1 + this.mod(A, 'ad_eff')) * (ad.str / 100) * (t.type === 'air' ? 1 - this.mod(B, 'air_def') * 0.5 : 1);
    if (this.rng() < 0.6) this.fx.push({ k: 'shot', from: { lat: ad.lat, lon: ad.lon }, to: { lat: t.lat, lon: t.lon }, kind: 'ad' });
    if (this.rng() < p) { t.str -= t.type === 'air' ? 9 : 14; t.org -= 10; }
    if (t.str <= 1) {
      this.removeUnit(t);
      this.fx.push({ k: 'destroyed', at: { lat: t.lat, lon: t.lon }, type: t.type, owner: t.owner });
      this.log(`🎯 ПВО ${A.name} сбила: ${t.name}`, 'war', t.owner);
    }
  }

  private capture() {
    const P = this.s.prov;
    for (const u of this.s.units) {
      if (u.type !== 'infantry' && u.type !== 'armor' && u.type !== 'special') continue;
      if (u.org < 20) continue;
      const p = this.world.provinceAt(u.lat, u.lon);
      if (p < 0) continue;
      const ctrl = P.ctrl[p];
      if (ctrl !== u.owner && ctrl !== '010' && !this.atWar(ctrl, u.owner) && !this.friendly(ctrl, u.owner)) {
        this.log(`⚡ Войска ${this.c(u.owner)!.name} вторглись на территорию ${this.c(ctrl)!.name}!`, 'war');
        this.declareWar(u.owner, ctrl, 'none');
        this.addGrudge(ctrl, u.owner, 1095);
      }
      if (ctrl === u.owner || !this.atWar(ctrl, u.owner)) {
        // Liberation of allied land
        if (P.owner[p] !== ctrl && this.friendly(P.owner[p], u.owner) && this.atWar(ctrl, u.owner) === false && this.atWar(P.owner[p], ctrl)) P.ctrl[p] = P.owner[p];
        continue;
      }
      if (this.near(u.lat, u.lon, 30, (e) => UNIT[e.type].domain === 'land' && e.type !== 'airdef' && this.atWar(e.owner, u.owner)).length) continue;
      if (P.captureBy[p] !== u.owner) { P.captureBy[p] = u.owner; P.capture[p] = 0; }
      const terr = TERRAIN_INFO[this.world.provinces[p].terrain].move;
      P.capture[p] += (u.type === 'armor' ? 0.14 : u.type === 'special' ? 0.16 : 0.1) * terr * (this.world.provinces[p].light > 0.3 ? 0.6 : 1);
      if (P.capture[p] >= 1) {
        const owner = P.owner[p];
        const newCtrl = owner !== u.owner && this.friendly(owner, u.owner) ? owner : u.owner;
        P.ctrl[p] = newCtrl; P.capture[p] = 0; P.captureBy[p] = null;
        this.fx.push({ k: 'capture', p, by: newCtrl });
        const pr = this.world.provinces[p];
        if (pr.city && pr.city.pop > 0.25) this.log(newCtrl === owner ? `🏳 ${this.c(newCtrl)!.name} освобождает ${pr.name}` : `🚩 ${this.c(u.owner)!.name} занимает ${pr.name}`, 'war', owner);
        if (p === this.c(owner)?.capital) this.log(`🏛 Пала столица — ${pr.name}!`, 'alert', owner);
      }
    }
  }

  // ---------------------------------------------------------------- missiles
  missileRange(c: CountryState, type: MissileType) { return MISSILE[type].range * (1 + this.mod(c, 'missile_range')); }

  canUseMissile(c: CountryState, type: MissileType): string | null {
    const st = MISSILE[type];
    if (type === 'icbm' && c.nukes <= 0) return 'Нет ядерных боеголовок';
    if (st.requires && !c.researched.includes(st.requires)) return 'Требуется технология';
    if (c.missiles[type] <= 0) return 'Нет ракет на складе';
    return null;
  }

  /** Pick launch site: own-controlled province nearest to the target. */
  launchSite(c: CountryState, to: LL, type: MissileType): LL | null {
    const P = this.s.prov;
    let best: LL | null = null, bd = Infinity;
    const range = this.missileRange(c, type);
    for (const i of this.world.byCountry.get(c.id) ?? []) {
      if (P.ctrl[i] !== c.id) continue;
      const pr = this.world.provinces[i];
      const d = distKm(pr.lat, pr.lon, to.lat, to.lon);
      if (d < bd) { bd = d; best = { lat: pr.lat, lon: pr.lon }; }
    }
    if (type === 'cruise') {
      for (const u of this.s.units) if (u.owner === c.id && u.type === 'navy' && u.ammo > 0) {
        const d = distKm(u.lat, u.lon, to.lat, to.lon);
        if (d < bd) { bd = d; best = { lat: u.lat, lon: u.lon }; }
      }
    }
    return best && bd <= range ? best : null;
  }

  launch(owner: string, type: MissileType, to: LL, targetUnit: number | null = null): Missile | string {
    const c = this.c(owner);
    if (!c) return 'Нет страны';
    const err = this.canUseMissile(c, type);
    if (err) return err;
    const from = this.launchSite(c, to, type);
    if (!from) return 'Цель вне радиуса действия';
    c.missiles[type]--;
    if (type === 'icbm') c.nukes--;
    const st = MISSILE[type];
    const dist = distKm(from.lat, from.lon, to.lat, to.lon);
    const m: Missile = {
      id: this.s.nextId++, type, owner, from, to, nuclear: type === 'icbm', dur: 2.5 + dist / (st.speed * 600), elapsed: 0,
      interceptAt: null, interceptBy: null, targetUnit,
    };
    // Whose soil/unit is being hit? A strike on a non-hostile country is an act of war.
    const tp = this.world.provinceAt(to.lat, to.lon);
    const defender = tp >= 0 ? this.s.prov.ctrl[tp] : null;
    let victim = defender;
    if (m.targetUnit != null) { const tu = this.unit(m.targetUnit); if (tu) victim = tu.owner; }
    if (victim === '010') victim = null;
    if (victim && victim !== owner) {
      if (!this.atWar(owner, victim)) {
        this.log(`⚡ ${c.name} наносит удар без объявления войны: ${this.c(victim)?.name}`, 'war');
        this.declareWar(owner, victim, 'none');
      }
      this.addGrudge(victim, owner, 1095);
    }
    // Interception roll by hostile air defences covering the target.
    const ads = this.s.units.filter((u) => u.type === 'airdef' && u.ammo >= 1 && u.owner !== owner && (this.atWar(u.owner, owner) || (defender && this.friendly(u.owner, defender) && this.atWar(defender, owner))));
    const recent = this.s.missiles.filter((x) => x.owner === owner).length;
    const overload = Math.max(0.3, 1 - recent * 0.04 * (1 + this.mod(c, 'ad_overload')));
    for (const ad of ads) {
      const D = this.c(ad.owner)!;
      const range = UNIT.airdef.range * (1 + this.mod(D, 'ad_range'));
      if (distKm(ad.lat, ad.lon, to.lat, to.lon) > range) continue;
      if (type === 'icbm' && !this.mod(D, 'abm')) continue;
      ad.ammo -= 1;
      const p = 0.62 * (1 + this.mod(D, 'ad_eff')) * (1 - st.evade - this.mod(c, 'missile_evade')) * (ad.str / 100) * overload;
      if (this.rng() < p) { m.interceptAt = 0.72 + this.rng() * 0.22; m.interceptBy = ad.id; break; }
    }
    this.s.missiles.push(m);
    this.fx.push({ k: 'launch', m });
    if (m.nuclear) {
      this.log(`☢ ЯДЕРНЫЙ ПУСК! ${c.name} → ${victim ? (this.c(victim)?.name ?? 'цель') : 'цель'}`, 'alert');
      this.s.tension = 100;
    }
    return m;
  }

  private updateMissiles(dt: number) {
    for (const m of [...this.s.missiles]) {
      m.elapsed += dt;
      const f = m.elapsed / m.dur;
      if (m.interceptAt !== null && f >= m.interceptAt) {
        const ad = m.interceptBy !== null ? this.unit(m.interceptBy) : null;
        const at = gcLerp(m.from.lat, m.from.lon, m.to.lat, m.to.lon, m.interceptAt);
        this.fx.push({ k: 'intercept', m, at, by: ad ? { lat: ad.lat, lon: ad.lon } : at });
        this.s.missiles.splice(this.s.missiles.indexOf(m), 1);
        continue;
      }
      if (f >= 1) {
        this.s.missiles.splice(this.s.missiles.indexOf(m), 1);
        this.impact(m);
      }
    }
  }

  private impact(m: Missile) {
    const st = MISSILE[m.type];
    const A = this.c(m.owner)!;
    this.fx.push({ k: 'impact', m, at: m.to });
    const dmgMul = 1 + this.mod(A, 'missile_dmg') + this.mod(A, 'intel') * 0.5;
    for (const u of this.near(m.to.lat, m.to.lon, st.radius)) {
      if (!m.nuclear && u.owner === m.owner) continue;
      const B = this.c(u.owner)!;
      const d = distKm(m.to.lat, m.to.lon, u.lat, u.lon);
      const k = (1 - d / st.radius) * (u.id === m.targetUnit ? 1.5 : 1);
      u.str -= st.dmg * dmgMul * k * (m.nuclear ? 1 - this.mod(B, 'nuke_resist') : 1);
      u.org -= st.dmg * k;
      if (u.str <= 1) {
        this.removeUnit(u);
        this.fx.push({ k: 'destroyed', at: { lat: u.lat, lon: u.lon }, type: u.type, owner: u.owner });
        this.log(`💥 Удар ${st.real.split(' / ')[0]}: уничтожена ${u.name}`, 'war', u.owner);
      }
    }
    const p = this.world.provinceAt(m.to.lat, m.to.lon);
    if (p < 0) return;
    const P = this.s.prov;
    const owner = P.owner[p];
    const D = this.c(owner);
    P.damage[p] = Math.min(1, P.damage[p] + (m.nuclear ? 1 : 0.04 * (st.dmg / 25)));
    if (D) {
      const b = P.buildings[p];
      for (const k of Object.keys(b) as (keyof typeof b)[]) if ((b[k] ?? 0) > 0 && this.rng() < (m.nuclear ? 1 : 0.08)) b[k] = (b[k] ?? 1) - 1;
      D.gdp *= 1 - this.world.provinces[p].popShare * (m.nuclear ? 0.6 : 0.004);
      if (m.nuclear) {
        const pr = this.world.provinces[p];
        const deaths = D.pop * pr.popShare * 0.35;
        D.pop -= deaths;
        D.stability = Math.max(0, D.stability - 25);
        A.opinion = -100;
        for (const o of Object.values(this.s.countries)) if (o.id !== m.owner) { this.addRel(o.id, m.owner, -60); this.addGrudge(o.id, m.owner, 730); }
        this.addGrudge(D.id, m.owner, 3650);
        this.log(`☢ Ядерный удар по ${pr.name}: погибло ~${(deaths * 1000).toFixed(0)} тыс. человек`, 'alert', owner);
        for (const n of pr.neighbors) P.damage[n] = Math.min(1, P.damage[n] + 0.4);
      } else D.stability = Math.max(0, D.stability - 0.05);
    }
  }
}

function canHit(a: UnitType, b: UnitType) {
  const da = UNIT[a].domain, db = UNIT[b].domain;
  if (a === 'airdef') return false;
  if (db === 'air') return a === 'air';
  if (da === 'sea') return true;
  if (db === 'sea') return a === 'air' || a === 'artillery' || a === 'drones';
  return true;
}

export function lerpLL(a: LL, b: LL, t: number): LL {
  let dLon = b.lon - a.lon;
  if (dLon > 180) dLon -= 360; else if (dLon < -180) dLon += 360;
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + dLon * t };
}
