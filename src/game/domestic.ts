import type { Sim } from './sim';
import type { CountryState, MissileType, UnitType, BuildingType } from './types';
import { BUILDING, MISSILE, UNIT } from '../data/military';
import { TECH_BY_ID } from '../data/tech';
import { tierRank } from '../data/countries';
import { focusById } from '../data/focus';
import type { ResourceKey } from '../data/resources';

const RES: ResourceKey[] = ['oil', 'gas', 'uranium', 'steel', 'rare', 'food'];
const GROWTH: Record<CountryState['econ'], number> = { market: 2.6, mixed: 2.1, planned: 1.1, war: -0.8 };
export const PRICE: Record<ResourceKey, number> = { oil: 0.003, gas: 0.002, uranium: 0.005, steel: 0.0012, rare: 0.005, food: 0.0008 };

/** Discretionary state income per day ($bn). */
export function dailyIncome(_sim: Sim, c: CountryState) {
  const eff = (1 - c.corruption / 250) * (0.6 + c.stability / 250);
  return (c.gdp * c.tax * eff * 0.22) / 365;
}

export function upkeep(sim: Sim, c: CountryState) {
  let u = 0;
  for (const x of sim.s.units) if (x.owner === c.id) u += UNIT[x.type].cost * 0.0006;
  return u * (c.econ === 'war' ? 0.8 : 1);
}

export function productionLines(sim: Sim, c: CountryState) {
  let n = 1;
  for (const i of sim.world.byCountry.get(c.id) ?? []) if (sim.s.prov.ctrl[i] === c.id) n += sim.s.prov.buildings[i].milfactory ?? 0;
  for (let i = 0; i < sim.s.prov.owner.length; i++) if (sim.s.prov.owner[i] !== c.id && sim.s.prov.ctrl[i] === c.id) n += (sim.s.prov.buildings[i].milfactory ?? 0) * 0.5;
  return Math.floor(n * (c.econ === 'war' ? 1.5 : 1));
}

export function sanctionPenalty(sim: Sim, c: CountryState) {
  let world = 0, against = 0;
  for (const o of Object.values(sim.s.countries)) { world += o.gdp; if (o.sanctions.includes(c.id)) against += o.gdp; }
  return world ? against / world : 0;
}

export function dailyDomestic(sim: Sim) {
  const s = sim.s;
  const P = s.prov;
  const ownedBy = new Map<string, number[]>();
  for (let i = 0; i < P.ctrl.length; i++) { const l = ownedBy.get(P.ctrl[i]); if (l) l.push(i); else ownedBy.set(P.ctrl[i], [i]); }

  for (const c of Object.values(s.countries)) {
    if (!c.alive) continue;
    const provs = ownedBy.get(c.id) ?? [];
    const atWar = sim.inWar(c.id);
    // ---- Resources
    const prod: Record<ResourceKey, number> = { oil: 0, gas: 0, uranium: 0, steel: 0, rare: 0, food: 0 };
    let factories = 0, labs = 0, npp = 0;
    for (const i of provs) {
      const pr = sim.world.provinces[i], b = P.buildings[i];
      const dmg = 1 - P.damage[i] * 0.7;
      for (const r of RES) {
        const base = pr.resources[r] ?? 0;
        if (!base) continue;
        const bb = r === 'oil' || r === 'gas' ? b.refinery ?? 0 : r === 'food' ? b.farm ?? 0 : b.mine ?? 0;
        prod[r] += base * (1 + bb) * 0.6 * dmg;
      }
      factories += (b.factory ?? 0) * dmg; labs += b.lab ?? 0; npp += b.npp ?? 0;
    }
    prod.food += c.pop / 60 + 1;
    prod.steel += factories * 0.25 + 0.3;
    const use: Record<ResourceKey, number> = { oil: 0, gas: 0, uranium: 0, steel: 0, rare: 0, food: c.pop / 55 };
    for (const u of s.units) if (u.owner === c.id) use.oil += UNIT[u.type].oil * 0.25 * (u.engaged < 24 ? 1.6 : 1);
    use.oil += (c.gdp / 1500) * (1 + sim.mod(c, 'oil_use'));
    use.gas += (c.gdp / 2500) * Math.max(0.3, 1 - npp * 0.15);
    use.uranium += npp * 0.1;
    const sanc = sanctionPenalty(sim, c);
    let trade = 0;
    for (const r of RES) {
      c.stock[r] += prod[r] - use[r];
      const price = PRICE[r] * (r === 'oil' ? s.oilPrice / 60 : 1);
      if (c.stock[r] > 300) { trade += (c.stock[r] - 300) * price * (1 - sanc * 0.8); c.stock[r] = 300; }
      if (c.stock[r] < 0) {
        const need = -c.stock[r];
        const canBuy = sanc < 0.5 || c.flags.includes('black_market');
        if (canBuy) { trade -= need * price * (1 + sanc * 2); c.stock[r] = 0; } else c.stock[r] = Math.max(-50, c.stock[r]);
      }
    }
    c.prod = prod; c.use = use;

    // ---- Economy
    let growth = GROWTH[c.econ] + sim.mod(c, 'gdp') + (c.tech - 5) * 0.15 - c.corruption * 0.02 + (c.stability - 50) * 0.03
      - c.warExhaustion * 0.04 - sanc * 12 - Math.max(0, c.tax - 0.35) * 12 - Math.max(0, c.inflation - 4) * 0.15 + factories * 0.02 + npp * 0.05;
    if (atWar) growth -= 1.5;
    if (c.quarantine === 'hard') growth -= 4; else if (c.quarantine === 'soft') growth -= 1.5;
    growth += sim.mod(c, 'tmp_covid_gdp') + sim.mod(c, 'tmp_gdp');
    c.gdpGrowth = growth;
    const occupied = provs.length ? provs.filter((i) => P.owner[i] === c.id).reduce((a, i) => a + sim.world.provinces[i].popShare, 0) : 0;
    c.gdp *= 1 + growth / 100 / 365;
    const income = dailyIncome(sim, c) * Math.max(0.2, occupied) + trade + (c.printing ? c.gdp * 0.0004 : 0);
    const research = (c.gdp * c.researchShare) / 365 * 0.15;
    const interest = (c.debt * 0.02) / 365;
    const exp = upkeep(sim, c) + research + interest;
    c.income = income; c.expenses = exp;
    c.budget += income - exp;
    if (c.budget < 0) { c.debt += -c.budget * 0.5; c.budget *= 0.5; }
    c.inflation += ((c.printing ? 18 : 2 + Math.max(0, -c.budget / Math.max(1, c.gdp)) * 40 + sanc * 10) - c.inflation) * 0.01;

    // ---- Research
    c.rp = 1 + Math.pow(Math.max(0.1, c.gdp), 0.35) * (c.researchShare * 25 + 0.3) * (1 + labs * 0.05) * (1 + sim.mod(c, 'rp')) * (0.5 + c.tech * 0.06) * 0.2;
    if (c.research) {
      const t = TECH_BY_ID.get(c.research.id);
      if (!t) c.research = null;
      else {
        c.research.progress += c.rp;
        if (c.research.progress >= t.cost) {
          c.researched.push(t.id);
          for (const [k, v] of Object.entries(t.mods ?? {})) {
            if (k === 'stability') c.stability += v; else if (k === 'press') c.pressFreedom += v; else if (k === 'opinion') c.opinion += v;
            else sim.addMod(c, k, v);
          }
          if (c.researched.length % 4 === 0) c.tech = Math.min(10, c.tech + 0.5);
          if (c.player) sim.log(`🔬 ${c.name}: исследовано «${t.name}»`, 'info', c.id);
          c.research = null;
        }
      }
    }

    // ---- National focus
    if (c.focus) {
      const f = focusById(c.focus.id);
      if (!f) c.focus = null;
      else if (++c.focus.progress >= f.days) {
        c.focusDone.push(f.id);
        f.effect?.(sim, c);
        if (c.player || tierRank(c.tier) <= 2) sim.log(`🎯 ${c.name}: завершён фокус «${f.name}»`, 'info', c.id);
        c.focus = null;
      }
    }

    // ---- Production
    const lines = productionLines(sim, c);
    const speed = (1 + sim.mod(c, 'prod')) * (c.econ === 'war' ? 1.25 : 1) * (c.stock.steel > 0 ? 1 : 0.4);
    let active = 0;
    for (const q of [...c.queue]) {
      if (active >= lines) break;
      active++;
      q.progress += speed;
      if (q.progress < q.days) continue;
      q.count--;
      q.progress = 0;
      completeItem(sim, c, q.kind, q.item, q.province);
      if (q.count <= 0) c.queue.splice(c.queue.indexOf(q), 1);
    }

    // ---- Politics
    const perCap = (c.gdp * 1000) / Math.max(0.05, c.pop);
    c.living += (Math.min(95, Math.log10(perCap + 1) * 22) - c.living) * 0.002 + (growth < 0 ? -0.01 : 0);
    const target = 40 + (c.living - 50) * 0.35 + (c.approval - 50) * 0.2 - c.warExhaustion * 0.45 - c.corruption * 0.12
      - Math.max(0, c.tax - 0.35) * 90 - Math.max(0, c.inflation - 6) * 0.6 + sim.mod(c, 'stability') + (atWar ? c.nationalism * 0.1 : 0)
      - (c.quarantine === 'hard' ? 6 : 0) - sanc * 20 + 18;
    c.stability += (Math.max(0, Math.min(100, target)) - c.stability) * 0.02;
    c.approval += ((c.stability * 0.7 + 20 + (growth > 2 ? 5 : growth < 0 ? -8 : 0)) - c.approval) * 0.015;
    if (!atWar) c.warExhaustion = Math.max(0, c.warExhaustion - 0.08);
    c.stability = clamp(c.stability); c.approval = clamp(c.approval);
    c.corruption = clamp(c.corruption + (c.ideology[3] > 50 ? 0.003 : -0.002));
    c.opinion = Math.max(-100, Math.min(100, c.opinion * 0.998));
    c.manpower += c.pop * 0.0025 * (0.5 + c.mobilisation);
    c.manpower = Math.min(c.manpower, c.pop * 1000 * (0.01 + c.mobilisation * 0.06));
    c.factions = factions(c);
    for (const k of Object.keys(c.modifiers)) if (k.startsWith('tmp_')) { c.modifiers[k] *= 0.99; if (Math.abs(c.modifiers[k]) < 0.01) delete c.modifiers[k]; }
  }
  // Oil price drifts to a baseline.
  s.oilPrice += (60 - s.oilPrice) * 0.004 + (sim.rng() - 0.5) * 0.6;
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

function factions(c: CountryState): Record<string, number> {
  const [e, soc, f, p] = c.ideology;
  return {
    'Силовики': clamp(50 + p * 0.3 + c.milShare * 400 - c.warExhaustion * 0.3),
    'Олигархи': clamp(50 + e * 0.3 - (c.tax - 0.3) * 150 - c.corruption * -0.2),
    'Либералы': clamp(50 - p * 0.4 - soc * 0.2 + c.pressFreedom * 0.2 - 10),
    'Националисты': clamp(40 + f * 0.4 + c.nationalism * 0.3),
    'Религиозные': clamp(45 + soc * 0.4),
    'Регионалы': clamp(55 - p * 0.15 - c.corruption * 0.1),
  };
}

export function completeItem(sim: Sim, c: CountryState, kind: 'unit' | 'missile' | 'building', item: string, province?: number) {
  const w = sim.world, P = sim.s.prov;
  if (kind === 'missile') { c.missiles[item as MissileType]++; if (item === 'icbm') c.nukes++; return; }
  if (kind === 'building') {
    if (province === undefined || P.ctrl[province] !== c.id) return;
    const b = P.buildings[province];
    const t = item as BuildingType;
    b[t] = Math.min(BUILDING[t].max, (b[t] ?? 0) + 1);
    sim.log(`🏗 ${c.name}: построен объект «${BUILDING[t].name}» — ${w.provinces[province].name}`, 'econ', c.id);
    return;
  }
  const type = item as UnitType;
  const own = (w.byCountry.get(c.id) ?? []).filter((i) => P.ctrl[i] === c.id);
  if (!own.length) return;
  let base = own.includes(c.capital) ? c.capital : own[0];
  if (type === 'navy') {
    const yard = own.find((i) => (P.buildings[i].shipyard ?? 0) > 0) ?? own.find((i) => w.provinces[i].coastal);
    if (yard === undefined) return;
    const pos = sim.seaNear(w.provinces[yard].lat, w.provinces[yard].lon);
    if (!pos) return;
    sim.spawnUnit(c.id, type, pos.lat, pos.lon);
    return;
  }
  const fac = own.filter((i) => (P.buildings[i].milfactory ?? 0) > 0);
  if (fac.length) base = fac[Math.floor(sim.rng() * fac.length)];
  const pr = w.provinces[base];
  const u = sim.spawnUnit(c.id, type, pr.lat + (sim.rng() - 0.5) * 0.3, pr.lon + (sim.rng() - 0.5) * 0.3);
  u.org = 60;
}

export function unitCostOk(c: CountryState, type: UnitType): string | null {
  const st = UNIT[type];
  if (c.budget < st.cost) return `Нужно $${st.cost} млрд`;
  if (c.manpower < st.manpower) return 'Нет призывников — объявите мобилизацию';
  if (c.stock.steel < st.steel) return 'Не хватает стали';
  if (c.stock.rare < st.rare) return 'Не хватает редкоземельных металлов';
  return null;
}

export function missileCostOk(c: CountryState, type: MissileType, count: number): string | null {
  const st = MISSILE[type];
  if (st.requires && !c.researched.includes(st.requires)) return 'Требуется технология';
  if (type === 'icbm' && c.nukes <= 0 && !c.researched.includes('nuke_strat')) return 'Нет ядерной программы';
  if (c.budget < st.cost * count) return `Нужно $${(st.cost * count).toFixed(2)} млрд`;
  return null;
}
