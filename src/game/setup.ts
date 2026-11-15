import type { World } from '../world/world';
import { countryDefs, type CountryDef } from '../data/countries';
import { TECHS } from '../data/tech';
import { distKm } from '../core/geo';
import { mulberry32 } from '../core/rng';
import type { BuildingType, CountryState, GameSettings, GameState, UnitType } from './types';
import { Sim } from './sim';
import { NAMES } from '../data/names';

const UNIT_ORDER: UnitType[] = ['infantry', 'armor', 'artillery', 'airdef', 'drones', 'air', 'navy', 'special'];

const REL: [string, string, number][] = [
  ['840', '364', -80], ['840', '408', -90], ['840', '643', -40], ['840', '156', -25], ['643', '804', -55], ['376', '364', -95],
  ['376', '760', -70], ['051', '031', -85], ['356', '586', -70], ['156', '158', -70], ['156', '356', -30], ['682', '364', -70],
  ['792', '300', -30], ['643', '268', -55], ['408', '410', -80], ['862', '170', -40], ['231', '232', -30], ['840', '862', -60],
  ['840', '192', -55], ['376', '275', -80], ['792', '760', -50], ['643', '112', 80], ['643', '156', 50], ['840', '826', 90],
  ['840', '376', 80], ['840', '392', 80], ['840', '410', 85], ['840', '158', 60], ['586', '156', 70], ['364', '760', 80],
  ['643', '760', 70], ['643', '688', 50], ['792', '031', 90], ['051', '643', 40], ['643', '398', 60], ['643', '356', 40],
  ['364', '643', 40], ['840', '682', 50], ['818', '682', 50], ['840', '804', 30], ['616', '804', 45], ['826', '804', 35],
  ['643', '616', -40], ['643', '440', -40], ['643', '428', -35], ['643', '233', -35], ['156', '392', -30], ['156', '408', 60],
  ['643', '408', 30], ['364', '368', 40], ['840', '368', 10], ['826', '250', 60], ['250', '276', 75], ['784', '682', 70],
];

export function createGame(world: World, settings: GameSettings, seed = 2020): GameState {
  const defs = countryDefs();
  const s: GameState = {
    version: 1, seed, tick: 9, speed: 0, settings, countries: {}, units: [], nextId: 1, relations: {}, wars: [], missiles: [],
    log: [], pending: [], fired: [], tension: 18, oilPrice: 60, players: {},
    prov: {
      owner: world.provinces.map((p) => p.country), ctrl: world.provinces.map((p) => p.country),
      capture: world.provinces.map(() => 0), captureBy: world.provinces.map(() => null), damage: world.provinces.map(() => 0),
      buildings: world.provinces.map(() => ({})),
    },
  };
  const rng = mulberry32(seed);

  for (const [id, provs] of world.byCountry) {
    if (id === '010') continue;
    const d = defs.get(id) ?? fallbackDef(id);
    s.countries[id] = makeCountry(world, d, provs);
  }

  // Relations from alliances & ideology.
  const ids = Object.keys(s.countries);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = s.countries[ids[i]], b = s.countries[ids[j]];
    let r = 0;
    const shared = a.alliances.filter((x) => b.alliances.includes(x));
    if (shared.some((x) => ['NATO', 'CSTO', 'AUKUS', 'USPACT'].includes(x))) r += 55;
    if (shared.includes('EU')) r += 30;
    r += shared.length * 6;
    const ideo = a.ideology.reduce((sum, v, k) => sum + Math.abs(v - b.ideology[k]), 0) / 4;
    r += 18 - ideo * 0.3;
    if (r) s.relations[Sim.key(a.id, b.id)] = Math.max(-100, Math.min(100, Math.round(r)));
  }
  for (const [a, b, v] of REL) if (s.countries[a] && s.countries[b]) s.relations[Sim.key(a, b)] = v;

  // Buildings.
  for (const c of Object.values(s.countries)) seedBuildings(world, s, c, defs.get(c.id));

  // Armies.
  const sim = new Sim(world, s);
  for (const c of Object.values(s.countries)) {
    const d = defs.get(c.id);
    if (!d) continue;
    placeArmy(world, sim, c, d, rng);
  }
  s.log.push({ t: 0, text: '1 января 2020 года. Мир на пороге десятилетия потрясений.', kind: 'event' });
  return s;
}

function fallbackDef(id: string): CountryDef {
  return {
    id, name: NAMES[id] ?? id, tier: 'D', color: '#808080', gdp: 1, pop: 0.1, mil: 0.02, tech: 2, nukes: 0, res: [0, 0, 0, 0, 0, 1],
    army: [1, 0, 0, 0, 0, 0, 0, 0], alliances: [], corruption: 60, stability: 50, ideology: [0, 0, 0, 0], econ: 'mixed', aggression: 0.05, detailed: false,
  };
}

function makeCountry(world: World, d: CountryDef, provs: number[]): CountryState {
  let capital = provs[0];
  if (d.capital) {
    const p = world.provinceAt(d.capital.lat, d.capital.lon);
    capital = p >= 0 && world.provinces[p].country === d.id ? p : provs.reduce((b, i) => (distKm(world.provinces[i].lat, world.provinces[i].lon, d.capital!.lat, d.capital!.lon) < distKm(world.provinces[b].lat, world.provinces[b].lon, d.capital!.lat, d.capital!.lon) ? i : b), provs[0]);
  } else capital = provs.reduce((b, i) => (world.provinces[i].popShare > world.provinces[b].popShare ? i : b), provs[0]);
  if (d.capital) world.provinces[capital].name = d.capital.name;

  const alliances = [...d.alliances];
  if (['840', '392', '410'].includes(d.id)) alliances.push('USPACT');
  const nuclear = d.nukes > 0;
  const startTier = Math.max(0, Math.floor((d.tech - 2) / 2));
  const researched = TECHS.filter((t) => t.tier <= startTier && !t.id.startsWith('nuke') && t.id !== 'bioweapon' && t.id !== 'mis_hyper').map((t) => t.id);
  if (nuclear) researched.push('nuke_tac', 'nuke_strat');
  if (['643', '156'].includes(d.id)) researched.push('mis_hyper');
  if (['840', '643', '156', '376'].includes(d.id)) researched.push('ad_s400');
  const unique = [...new Set(researched)];
  const mods: Record<string, number> = {};
  for (const id of unique) for (const [k, v] of Object.entries(TECHS.find((t) => t.id === id)?.mods ?? {})) mods[k] = (mods[k] ?? 0) + v;

  const mil = d.mil;
  const tax = d.econ === 'market' ? 0.27 : d.econ === 'planned' ? 0.38 : 0.31;
  return {
    id: d.id, name: d.name, color: d.color, tier: d.tier, alive: true, player: null, leader: d.leader ?? 'Правительство', capital,
    gdp: d.gdp, gdpGrowth: 2, budget: d.gdp * 0.03 + mil * 0.2, debt: d.gdp * 0.55, tax, milShare: d.gdp ? mil / d.gdp : 0.02,
    researchShare: Math.min(0.04, 0.005 + d.tech * 0.003), inflation: 2, printing: false, econ: d.econ, income: 0, expenses: 0,
    pop: d.pop, manpower: d.pop * 6, mobilisation: 0.1,
    stock: { oil: 40 + d.res[0] * 10, gas: 40 + d.res[1] * 10, uranium: d.res[2] * 10, steel: 40 + d.res[3] * 10, rare: d.res[4] * 10, food: 60 + d.res[5] * 10 },
    prod: { oil: 0, gas: 0, uranium: 0, steel: 0, rare: 0, food: 0 }, use: { oil: 0, gas: 0, uranium: 0, steel: 0, rare: 0, food: 0 },
    missiles: {
      ballistic: d.tech >= 4 ? Math.round(mil * 1.6) : 0,
      cruise: d.tech >= 5 ? Math.round(mil * 2.4) : 0,
      hypersonic: unique.includes('mis_hyper') ? Math.round(mil * 0.3) : 0,
      shahed: d.id === '364' ? 400 : d.tech >= 4 ? Math.round(mil * 0.5) : 0,
      icbm: nuclear ? Math.max(2, Math.min(400, Math.round(d.nukes / 18))) : 0,
    },
    nukes: d.nukes, queue: [], tech: d.tech, researched: unique, research: null, rp: 0, focusDone: [], focus: null,
    stability: d.stability, approval: Math.min(85, d.stability + 5), corruption: d.corruption, nationalism: 30 + Math.max(0, d.ideology[2]) * 0.4,
    pressFreedom: 50 - d.ideology[3] * 0.45, living: Math.min(95, Math.max(10, Math.log10(((d.gdp * 1000) / Math.max(0.05, d.pop)) + 1) * 22)),
    warExhaustion: 0, ideology: [...d.ideology], factions: {}, alliances, sanctions: [], guarantees: [], opinion: 0,
    aggression: d.aggression, modifiers: mods, flags: [], quarantine: 'none',
  };
}

function seedBuildings(world: World, s: GameState, c: CountryState, d: CountryDef | undefined) {
  const provs = (world.byCountry.get(c.id) ?? []).slice().sort((a, b) => world.provinces[b].popShare - world.provinces[a].popShare);
  const add = (p: number, b: BuildingType, n = 1) => { const x = s.prov.buildings[p]; x[b] = Math.min(5, (x[b] ?? 0) + n); };
  const factories = Math.min(40, Math.round(c.gdp / 250));
  const mil = Math.min(20, Math.round((d?.mil ?? 0) / 6));
  for (let i = 0; i < factories; i++) add(provs[i % Math.min(provs.length, 12)], 'factory');
  for (let i = 0; i < mil; i++) add(provs[i % Math.min(provs.length, 8)], 'milfactory');
  for (let i = 0; i < Math.min(6, Math.floor(c.tech / 2)); i++) add(provs[i % Math.min(provs.length, 4)], 'lab');
  for (const p of provs) {
    const r = world.provinces[p].resources;
    if (r.oil || r.gas) add(p, 'refinery');
    if (r.steel || r.rare || r.uranium) add(p, 'mine');
    if (r.food) add(p, 'farm');
    if (world.provinces[p].coastal && (d?.army[6] ?? 0) > 0 && !provs.slice(0, 6).every((q) => q !== p)) add(p, 'shipyard');
  }
  if ((d?.army[5] ?? 0) > 0) add(c.capital, 'airbase');
  if (c.tech >= 6 && c.gdp > 300) add(provs[1] ?? c.capital, 'npp');
}

function placeArmy(world: World, sim: Sim, c: CountryState, d: CountryDef, rng: () => number) {
  const P = sim.s.prov;
  const provs = world.byCountry.get(c.id) ?? [];
  if (!provs.length) return;
  // Border provinces (adjacent to another country), weighted by rival relations.
  const border = provs.filter((p) => world.provinces[p].neighbors.some((n) => P.owner[n] !== c.id && P.owner[n] !== '010'));
  const borderScore = (p: number) => Math.min(...world.provinces[p].neighbors.filter((n) => P.owner[n] !== c.id).map((n) => sim.rel(c.id, P.owner[n])), 100);
  border.sort((a, b) => borderScore(a) - borderScore(b));
  const front = border.length ? border.slice(0, Math.max(3, Math.ceil(border.length * 0.4))) : [c.capital];
  const cities = provs.slice().sort((a, b) => world.provinces[b].popShare - world.provinces[a].popShare).slice(0, 6);
  const jitter = (lat: number, lon: number, km = 25) => ({ lat: lat + (rng() - 0.5) * (km / 55), lon: lon + ((rng() - 0.5) * (km / 55)) / Math.max(0.3, Math.cos((lat * Math.PI) / 180)) });
  const scale = c.tier === 'S' ? 1 : 1;
  d.army.forEach((count, k) => {
    const type = UNIT_ORDER[k];
    for (let i = 0; i < Math.round(count * scale); i++) {
      let pos: { lat: number; lon: number } | null;
      if (type === 'navy') {
        const coast = provs.filter((p) => world.provinces[p].coastal);
        const base = coast.length ? world.provinces[coast[Math.floor(rng() * Math.min(coast.length, 8))]] : world.provinces[c.capital];
        pos = sim.seaNear(base.lat, base.lon);
        if (!pos) continue;
      } else if (type === 'airdef' || type === 'air') {
        const base = world.provinces[i === 0 ? c.capital : cities[i % cities.length]];
        pos = jitter(base.lat, base.lon, 40);
      } else {
        const base = world.provinces[i % 3 === 2 ? cities[i % cities.length] : front[i % front.length]];
        pos = jitter(base.lat, base.lon);
      }
      if (type !== 'navy' && type !== 'air' && !world.isLand(pos.lat, pos.lon)) { const b = world.provinces[c.capital]; pos = { lat: b.lat, lon: b.lon }; }
      const u = sim.spawnUnit(c.id, type, pos.lat, pos.lon);
      u.org = 70 + rng() * 30;
      u.xp = Math.min(0.6, (c.tech / 20) * rng());
    }
  });
}
