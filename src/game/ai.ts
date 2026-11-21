import type { Sim } from './sim';
import type { CountryState, MissileType, Unit, UnitType } from './types';
import { UNIT } from '../data/military';
import { tierRank } from '../data/countries';
import { TECHS } from '../data/tech';
import { focusAvailable, focusTree } from '../data/focus';
import { applyCommand } from './commands';
import { distKm } from '../core/geo';
import { hashString } from '../core/rng';

const BRANCH_PREF: Record<string, string[]> = {
  aggressive: ['mis', 'air', 'def', 'int', 'civ', 'cyb'],
  normal: ['civ', 'def', 'air', 'int', 'cyb', 'mis'],
};

const DIFF: Record<string, number> = { easy: 0.6, normal: 1, hard: 1.4, historical: 1 };

/** Strategic AI — daily, staggered. */
export function dailyAI(sim: Sim) {
  const s = sim.s;
  const diff = DIFF[s.settings.difficulty] ?? 1;
  for (const c of Object.values(s.countries)) {
    if (!c.alive || c.player) continue;
    const slot = (hashString(c.id) + Math.floor(s.tick / 24)) % 5;
    economy(sim, c, diff);
    if (slot !== 0) continue;
    doctrine(sim, c);
    research(sim, c);
    focus(sim, c);
    diplomacy(sim, c, diff);
  }
}

/** Operational AI for countries at war — every 6 hours. */
export function hourlyAI(sim: Sim) {
  if (sim.s.tick % 6 !== 0) return;
  // One pass over the army list instead of one per belligerent: with dozens of
  // simultaneous wars the per-country filter was the single hottest loop.
  const unitsByOwner = new Map<string, Unit[]>();
  for (const u of sim.s.units) {
    const list = unitsByOwner.get(u.owner);
    if (list) list.push(u); else unitsByOwner.set(u.owner, [u]);
  }
  // Provinces controlled by each country, so frontier detection never has to
  // rescan all ~3000 provinces for every country.
  const provsByCtrl = sim.provsByCtrl();
  for (const c of Object.values(sim.s.countries)) {
    if (!c.alive || c.player) continue;
    const enemies = sim.enemiesOf(c.id);
    if (!enemies.length) continue;
    military(sim, c, enemies, unitsByOwner, provsByCtrl);
    if (sim.s.tick % 24 === 0) missiles(sim, c, enemies, unitsByOwner);
  }
}

function economy(sim: Sim, c: CountryState, diff: number) {
  if (c.budget < -c.gdp * 0.01 && c.tax < 0.42) c.tax += 0.005;
  else if (c.budget > c.gdp * 0.04 && c.tax > 0.22) c.tax -= 0.005;
  const atWar = sim.inWar(c.id);
  if (atWar && c.econ !== 'war' && c.warExhaustion > 15 && tierRank(c.tier) <= 3) c.econ = 'war';
  if (!atWar && c.econ === 'war') c.econ = 'mixed';
  if (atWar && c.mobilisation < 0.4) c.mobilisation += 0.05;
  // Army size target: grows with tension and war.
  const mine = sim.unitsOf(c.id);
  const rank = tierRank(c.tier);
  const base = Math.max(2, Math.round(Math.log10(c.gdp + 1) * 4 * (rank <= 1 ? 2 : rank === 2 ? 1.5 : 1)));
  const target = base * (1 + sim.s.tension / 150 + (atWar ? 0.6 : 0)) * diff;
  if (mine.length + c.queue.length >= target || c.queue.length > 6) return;
  const pick: UnitType = atWar
    ? (['infantry', 'infantry', 'armor', 'artillery', 'drones', 'infantry', 'airdef'] as UnitType[])[Math.floor(sim.rng() * 7)]
    : (['infantry', 'armor', 'artillery', 'airdef', 'drones', 'air'] as UnitType[])[Math.floor(sim.rng() * 6)];
  if (c.budget > UNIT[pick].cost * 3) applyCommand(sim, c.id, { t: 'buildUnit', unit: pick, count: 1 });
  if (c.budget > 5 && c.missiles.cruise < 50 && c.tech >= 5) applyCommand(sim, c.id, { t: 'buildMissile', missile: 'cruise', count: 10 });
  if (c.id === '364' && c.budget > 1) applyCommand(sim, c.id, { t: 'buildMissile', missile: 'shahed', count: 50 });
}

/** AI picks a doctrine matching its temper — one AI card shows it to the player. */
function doctrine(sim: Sim, c: CountryState) {
  if (c.doctrine) return;
  const pick = c.aggression > 0.55 ? 'blitz'
    : c.tech >= 7 ? 'tech'
    : sim.inWar(c.id) ? 'fortress'
    : c.gdp > 800 ? 'economy'
    : 'attrition';
  applyCommand(sim, c.id, { t: 'doctrine', id: pick });
}

function research(sim: Sim, c: CountryState) {
  if (c.research) return;
  const pref = BRANCH_PREF[c.aggression > 0.4 ? 'aggressive' : 'normal'];
  const avail = TECHS.filter((t) => !c.researched.includes(t.id) && t.req.every((r) => c.researched.includes(r)) && t.id !== 'bioweapon' && !(t.id.startsWith('nuke') && tierRank(c.tier) > 2));
  avail.sort((a, b) => a.tier - b.tier || pref.indexOf(a.branch) - pref.indexOf(b.branch));
  const t = avail[Math.floor(sim.rng() * Math.min(3, avail.length))];
  if (t) c.research = { id: t.id, progress: 0 };
}

function focus(sim: Sim, c: CountryState) {
  if (c.focus) return;
  const list = focusTree(c.id).filter((f) => focusAvailable(c, f));
  if (!list.length) return;
  const f = list[Math.floor(sim.rng() * Math.min(2, list.length))];
  c.focus = { id: f.id, progress: 0 };
}

function diplomacy(sim: Sim, c: CountryState, diff: number) {
  const s = sim.s;
  // Help allies at war.
  for (const w of s.wars) {
    if (sim.sideOf(w, c.id)) continue;
    // Join the side of an ally that is already fighting (both directions).
    for (const side of ['a', 'd'] as const) {
      const members = side === 'a' ? w.attackers : w.defenders;
      const leader = members.find((id) => sim.militaryAllies(c.id).includes(id) && sim.rel(c.id, id) > 40);
      if (leader && sim.rng() < 0.15) { sim.joinWar(c.id, w, side); break; }
    }
  }
  // Call allies for help when the war is going badly.
  if (sim.inWar(c.id) && c.warExhaustion > 30 && sim.rng() < 0.15) {
    for (const a of sim.militaryAllies(c.id)) applyCommand(sim, c.id, { t: 'diplo', action: 'callToArms', target: a });
  }
  // Drift relations a bit toward neighbours' baseline, sanction hated rivals.
  for (const o of Object.values(s.countries)) {
    if (o.id === c.id || !o.alive) continue;
    const r = sim.rel(c.id, o.id);
    if (r < -70 && c.gdp > 300 && c.econ === 'market' && !c.sanctions.includes(o.id) && sim.rng() < 0.05) applyCommand(sim, c.id, { t: 'diplo', action: 'sanction', target: o.id });
  }
  // Peace when exhausted or when the front has been frozen for months. Without
  // this a stalemate between two AI states grinds on forever.
  for (const e of sim.enemiesOf(c.id)) {
    const E = sim.c(e);
    if (!E) continue;
    const war = s.wars.find((w) => sim.sideOf(w, c.id) && sim.sideOf(w, E.id));
    const years = war ? (s.tick - war.start) / (24 * 365) : 0;
    const stale = war ? (s.tick - war.start) > 24 * 240 && Math.abs(sim.occupationShare(E.id, c.id) - sim.occupationShare(c.id, E.id)) < 0.08 : false;
    if (E.player) continue;
    if (c.warExhaustion > 60 && E.warExhaustion > 30 && sim.rng() < 0.2) sim.makePeace(e, c.id, false);
    else if (stale && (c.warExhaustion > 25 || years > 1.2) && sim.rng() < 0.12) {
      sim.makePeace(e, c.id, false);
      sim.log(`🕊 ${c.name} и ${E.name}: фронт застыл, стороны идут на перемирие`, 'diplo');
    }
  }
  // Rare aggressive wars (not in historical mode — scripted there).
  if (s.settings.historical || sim.inWar(c.id) || c.aggression < 0.3 || s.tick < 24 * 120) return;
  if (sim.rng() > 0.004 * c.aggression * (0.5 + s.tension / 100) * diff) return;
  const P = s.prov;
  const neighbours = new Set<string>();
  for (const p of sim.world.byCountry.get(c.id) ?? []) for (const n of sim.world.provinces[p].neighbors) if (P.owner[n] !== c.id && P.owner[n] !== '010') neighbours.add(P.owner[n]);
  const power = (x: string) => s.units.filter((u) => u.owner === x).reduce((a, u) => a + u.str * UNIT[u.type].atk, 0);
  const myPower = power(c.id);
  const target = [...neighbours].filter((n) => sim.rel(c.id, n) < -45 && myPower > 2 * (power(n) + sim.militaryAllies(n).reduce((a, x) => a + power(x) * 0.3, 0))).sort((a, b) => sim.rel(c.id, a) - sim.rel(c.id, b))[0];
  if (target) sim.declareWar(c.id, target, sim.rel(c.id, target) < -80 ? 'provocation' : 'claims');
}

type UnitsByOwner = Map<string, Unit[]>;
type ProvsByCtrl = Map<string, number[]>;

function military(sim: Sim, c: CountryState, enemies: string[], unitsByOwner: UnitsByOwner, provsByCtrl: ProvsByCtrl) {
  const s = sim.s, w = sim.world, P = s.prov;
  const mine = unitsByOwner.get(c.id) ?? [];
  const enemySet = new Set(enemies);
  // Frontier: enemy-controlled provinces adjacent to our controlled provinces.
  const frontier: number[] = [], ownFront: number[] = [];
  const own = provsByCtrl.get(c.id) ?? [];
  for (const i of own) {
    let touches = false;
    for (const n of w.provinces[i].neighbors) if (enemySet.has(P.ctrl[n])) { frontier.push(n); touches = true; }
    if (touches) ownFront.push(i);
  }
  // Allied ground can also be the springboard for an offensive.
  if (frontier.length < 2) {
    for (const a of sim.militaryAllies(c.id)) for (const i of provsByCtrl.get(a) ?? []) {
      for (const n of w.provinces[i].neighbors) if (enemySet.has(P.ctrl[n]) && !frontier.includes(n)) frontier.push(n);
    }
  }
  const enemyUnits = enemies.flatMap((e) => unitsByOwner.get(e) ?? []);
  const idle = (u: Unit) => !u.path.length && u.engaged > 2 && !u.hold;
  let orders = 0;
  const go = (u: Unit, lat: number, lon: number) => { orders++; sim.orderMove(u, lat, lon); };
  for (const u of mine) {
    if (orders >= 10) break;
    if (!idle(u)) continue;
    const st = UNIT[u.type];
    if (u.type === 'airdef') continue;
    if (st.domain === 'sea') {
      const e = nearest(u, enemyUnits.filter((x) => UNIT[x.type].domain === 'sea'), 1500);
      if (e) go(u, e.lat, e.lon);
      continue;
    }
    if (u.type === 'air' || u.type === 'drones') {
      const e = nearest(u, enemyUnits.filter((x) => UNIT[x.type].domain === 'land'), u.type === 'air' ? 1200 : 400);
      if (e) go(u, e.lat + (sim.rng() - 0.5) * 0.2, e.lon + (sim.rng() - 0.5) * 0.2);
      continue;
    }
    if (c.doctrine !== 'blitz' && c.doctrine !== 'fortress' && (u.org < 55 || u.str < 45)) continue;
    if (!frontier.length) {
      // No land border: try amphibious toward nearest enemy province.
      const target = nearestProvince(sim, u, (i) => enemySet.has(P.ctrl[i]), 4000);
      if (target >= 0 && sim.rng() < 0.3) go(u, w.provinces[target].lat, w.provinces[target].lon);
      continue;
    }
    if (u.type === 'artillery') {
      const own = pickNear(sim, u, ownFront);
      if (own >= 0) go(u, w.provinces[own].lat, w.provinces[own].lon);
      continue;
    }
    // Keep ~25% of infantry on defence of own frontier.
    if (u.type === 'infantry' && (u.id % 4 === 0) && ownFront.length) {
      const own = pickNear(sim, u, ownFront);
      if (own >= 0 && distKm(u.lat, u.lon, w.provinces[own].lat, w.provinces[own].lon) > 30) go(u, w.provinces[own].lat, w.provinces[own].lon);
      continue;
    }
    // Doctrine-driven behaviour: a "fortress" AI digs in instead of attacking,
    // a "blitz" AI pushes even at low readiness. This is what makes the player's
    // doctrine choice readable on the map.
    if (c.doctrine === 'fortress' && ownFront.length) {
      const own = pickNear(sim, u, ownFront);
      if (own >= 0) { if (distKm(u.lat, u.lon, w.provinces[own].lat, w.provinces[own].lon) < 45) u.hold = true; else go(u, w.provinces[own].lat, w.provinces[own].lon); }
      continue;
    }
    if (c.doctrine === 'blitz' && (u.org < 35 || u.str < 30)) continue;
    if (c.doctrine !== 'blitz' && (u.org < 55 || u.str < 45)) continue;
    const t = pickNear(sim, u, frontier);
    if (t >= 0) go(u, w.provinces[t].lat + (sim.rng() - 0.5) * 0.2, w.provinces[t].lon + (sim.rng() - 0.5) * 0.2);
  }
}

function missiles(sim: Sim, c: CountryState, enemies: string[], unitsByOwner: UnitsByOwner) {
  const s = sim.s;
  const targets = enemies.flatMap((e) => unitsByOwner.get(e) ?? []).filter((u) => UNIT[u.type].domain !== 'air');
  const order: MissileType[] = ['shahed', 'cruise', 'ballistic', 'hypersonic'];
  for (const type of order) {
    if (c.missiles[type] <= 0 || sim.rng() > 0.45) continue;
    const salvo = type === 'shahed' ? 6 + Math.floor(sim.rng() * 12) : 1 + Math.floor(sim.rng() * 4);
    const t = targets.length && sim.rng() < 0.7 ? targets[Math.floor(sim.rng() * targets.length)] : null;
    const to = t ? { lat: t.lat, lon: t.lon } : cityTarget(sim, enemies);
    if (!to) continue;
    applyCommand(sim, c.id, { t: 'launch', missile: type, to, count: Math.min(salvo, c.missiles[type]), targetUnit: t?.id ?? null });
  }
  // Nuclear doctrine: only when the homeland is collapsing.
  if (c.nukes > 0 && c.missiles.icbm > 0) {
    const P = s.prov;
    let own = 0, held = 0;
    for (let i = 0; i < P.owner.length; i++) if (P.owner[i] === c.id) { own += sim.world.provinces[i].popShare; if (P.ctrl[i] === c.id) held += sim.world.provinces[i].popShare; }
    const desperate = held / Math.max(1e-6, own) < 0.6 && P.ctrl[c.capital] !== c.id;
    if (desperate && sim.rng() < 0.08) {
      const enemy = enemies.map((e) => sim.c(e)!).sort((a, b) => b.gdp - a.gdp)[0];
      if (enemy) applyCommand(sim, c.id, { t: 'launch', missile: 'icbm', to: { lat: sim.world.provinces[enemy.capital].lat, lon: sim.world.provinces[enemy.capital].lon }, count: 1 });
    }
  }
}

function cityTarget(sim: Sim, enemies: string[]) {
  const e = sim.c(enemies[Math.floor(sim.rng() * enemies.length)]);
  if (!e) return null;
  const provs = (sim.world.byCountry.get(e.id) ?? []).filter((p) => sim.s.prov.ctrl[p] === e.id).sort((a, b) => sim.world.provinces[b].popShare - sim.world.provinces[a].popShare).slice(0, 8);
  const p = provs[Math.floor(sim.rng() * provs.length)];
  return p === undefined ? null : { lat: sim.world.provinces[p].lat, lon: sim.world.provinces[p].lon };
}

function nearest(u: Unit, list: Unit[], maxKm: number) {
  let best: Unit | null = null, bd = maxKm;
  for (const x of list) { const d = distKm(u.lat, u.lon, x.lat, x.lon); if (d < bd) { bd = d; best = x; } }
  return best;
}

function pickNear(sim: Sim, u: Unit, provs: number[]) {
  let best = -1, bd = Infinity;
  for (const p of provs) {
    const pr = sim.world.provinces[p];
    const d = distKm(u.lat, u.lon, pr.lat, pr.lon) * (0.7 + sim.rng() * 0.6);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function nearestProvince(sim: Sim, u: Unit, pred: (i: number) => boolean, maxKm: number) {
  let best = -1, bd = maxKm;
  for (let i = 0; i < sim.world.provinces.length; i++) {
    if (!pred(i)) continue;
    const pr = sim.world.provinces[i];
    const d = distKm(u.lat, u.lon, pr.lat, pr.lon);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
