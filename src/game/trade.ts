import type { Sim } from './sim';
import type { CountryState, GameState } from './types';
import type { ResourceKey } from '../data/resources';
import { distKm } from '../core/geo';

/**
 * Trade layer. Three ideas, all of them making the economy something you *do*:
 *
 *  1. Markets — every resource has a price that moves with real world supply and
 *     demand, so selling into a glut is a bad idea and stockpiling pays off.
 *  2. Trade agreements — you name a partner and a resource; both sides get a better
 *     price and relations improve. Sanctions and war rip the route apart.
 *  3. Companies — invest cash into a sector (energy/industry/food/tech) and it pays
 *     dividends for years while shifting your market position.
 *
 * Everything is plain JSON on GameState so saves and multiplayer keep working.
 */

export const RES_KEYS: ResourceKey[] = ['oil', 'gas', 'uranium', 'steel', 'rare', 'food'];

export interface Market {
  price: number; // index, 1.0 = base
  supply: number;
  demand: number;
  prev: number;
}

export interface TradeRoute {
  id: number;
  a: string; // initiator
  b: string; // partner
  res: ResourceKey;
  since: number;
}

export interface Company {
  id: number;
  owner: string;
  name: string;
  sector: Sector;
  capital: number; // invested $bn (decays with age)
  founded: number;
}

export type Sector = 'energy' | 'industry' | 'food' | 'tech';

export const SECTORS: Record<Sector, { name: string; icon: string; res: ResourceKey; desc: string; mods: Record<string, number> }> = {
  energy: { name: 'Энергетика', icon: '🛢', res: 'oil', desc: 'Добыча и экспорт топлива. Влияет на цену нефти и газа.', mods: { gdp: 0.05 } },
  industry: { name: 'Промышленность', icon: '🏭', res: 'steel', desc: 'Сталь и редкоземельные металлы, питает производство.', mods: { prod: 0.08 } },
  food: { name: 'Агросектор', icon: '🌾', res: 'food', desc: 'Продовольствие: стабильность и экспорт.', mods: { stability: 2 } },
  tech: { name: 'Технологии', icon: '💡', res: 'rare', desc: 'Патенты и наука: очки исследования каждый день.', mods: { rp: 0.1 } },
};

export interface TradeState {
  markets: Record<string, Market>;
  routes: TradeRoute[];
  companies: Company[];
  nextId: number;
  history: Record<string, number[]>; // resource -> last 30 daily prices
}

export function initTrade(_s: GameState): TradeState {
  const markets: Record<string, Market> = {};
  for (const r of RES_KEYS) markets[r] = { price: r === 'oil' ? 1 : 1, supply: 0, demand: 0, prev: 1 };
  return { markets, routes: [], companies: [], nextId: 1, history: Object.fromEntries(RES_KEYS.map((r) => [r, [] as number[]])) };
}

/** Trade state always exists by the time anything reads it. */
export function trade(sim: Sim): TradeState {
  const st = sim.s as GameState & { trade?: TradeState };
  if (!st.trade) st.trade = initTrade(st);
  const t = st.trade as TradeState;
  t.markets ??= initTrade(st).markets;
  t.routes ??= [];
  t.companies ??= [];
  t.history ??= Object.fromEntries(RES_KEYS.map((r) => [r, [] as number[]]));
  t.nextId ??= (t.routes.length + t.companies.length + 1);
  return t;
}

/** Deliveries currently blocked for `a` (sanctions, war, broken treaties). */
export function routeBlocked(sim: Sim, a: string, b: string): string | null {
  const A = sim.s.countries[a], B = sim.s.countries[b];
  if (!A?.alive || !B?.alive) return 'Страна более не существует';
  if (sim.atWar(a, b)) return 'Война — торговля прекращена';
  if (A.sanctions.includes(b) || B.sanctions.includes(a)) return 'Санкции блокируют маршрут';
  if (sim.rel(a, b) < -60) return 'Отношения слишком враждебны';
  return null;
}

/** Price multiplier a country actually trades at, given its routes and penalties. */
export function priceFor(sim: Sim, c: CountryState, res: ResourceKey): { buy: number; sell: number } {
  const t = trade(sim);
  const m = t.markets[res];
  const base = m.price;
  let bonus = 1;
  for (const r of t.routes) {
    if (r.res !== res) continue;
    const partner = r.a === c.id ? r.b : r.b === c.id ? r.a : null;
    if (!partner) continue;
    if (routeBlocked(sim, c.id, partner)) continue;
    bonus -= 0.06; // good deals both ways: cheaper to buy, better to sell
  }
  const blocked = sim.blockadeLevel(c.id);
  const sanc = c.sanctions.length * 0.02;
  return {
    buy: base * Math.max(0.6, 1 + sanc + blocked * 0.5 - (1 - bonus) * 0.6),
    sell: base * Math.max(0.5, (1 - sanc * 0.5 - blocked * 0.5) * bonus),
  };
}

/** World-market pass: aggregate supply/demand, move prices, drift toward normal. */
export function updateMarkets(sim: Sim) {
  const s = sim.s, t = trade(sim);
  let gdpSum = 1, warT = 1;
  const prod: Record<string, number> = {}, use: Record<string, number> = {};
  for (const r of RES_KEYS) { prod[r] = 0; use[r] = 0; }
  for (const c of Object.values(s.countries)) {
    if (!c.alive) continue;
    gdpSum += c.gdp;
    for (const r of RES_KEYS) { prod[r] += Math.max(0, c.prod[r] ?? 0); use[r] += Math.max(0, c.use[r] ?? 0); }
  }
  warT += s.wars.length * 0.35;
  for (const r of RES_KEYS) {
    const m = t.markets[r];
    m.prev = m.price;
    m.supply = prod[r];
    m.demand = use[r];
    // Shortage measured against the size of the market, so a tiny uranium trade
    // cannot send prices to the moon. Small markets move less, big ones more.
    const scale = Math.max(20, prod[r] + use[r]);
    const shortage = (use[r] - prod[r]) / scale; // -1 .. 1, dimensionless
    // Exponent, not raw money: markets with a huge surplus (steel, gas) should sag
    // toward the floor and scarce ones rise, but never to absurd extremes.
    const pressure = Math.sign(shortage) * Math.min(1, Math.abs(shortage) * 6) * 0.04 * warT
      + (r === 'oil' ? (s.oilPrice / 60 - 1) * 0.08 : 0);
    // Reversion is what keeps prices in a believable band instead of pinning to a cap.
    m.price = Math.max(0.5, Math.min(2.1, m.price + pressure + (1 - m.price) * 0.09 + (sim.rng() - 0.5) * 0.01));
    t.history[r].push(+m.price.toFixed(3));
    if (t.history[r].length > 30) t.history[r].shift();
  }
}

/** Dividend + upkeep of a country's companies, once per day. */
export function companyIncome(sim: Sim, c: CountryState): number {
  const t = trade(sim);
  let div = 0;
  for (const co of t.companies) {
    if (co.owner !== c.id) continue;
    const age = Math.max(0, (sim.s.tick - co.founded) / 24);
    const growth = 1 + Math.min(0.5, age / 1200); // compounds for ~3 years, then plateaus
    div += co.capital * 0.0016 * growth;
  }
  return div;
}

/** Route income: each live partner on a resource pays a small daily premium. */
export function routeIncome(sim: Sim, c: CountryState): number {
  const t = trade(sim);
  let total = 0;
  for (const r of t.routes) {
    if (r.a !== c.id && r.b !== c.id) continue;
    const other = r.a === c.id ? r.b : r.a;
    if (routeBlocked(sim, c.id, other)) continue;
    const m = t.markets[r.res];
    // Deals are worth real money: the partner's appetite, our surplus and the
    // market price all matter. A bad deal is still better than no deal.
    const surplus = Math.max(0, (c.prod[r.res] ?? 0) - (c.use[r.res] ?? 0));
    const appetite = Math.min(1, (sim.s.countries[other]?.use[r.res] ?? 0) / 40);
    total += (0.02 + Math.min(0.06, surplus * 0.004)) * (0.5 + appetite) * m.price * 4;
  }
  return total;
}

/** Best partners by value, for the UI. */
export function topPartners(sim: Sim, c: CountryState, n = 4): { id: string; value: number }[] {
  const out: { id: string; value: number }[] = [];
  for (const r of trade(sim).routes) {
    const other = r.a === c.id ? r.b : r.b === c.id ? r.a : null;
    if (!other || routeBlocked(sim, c.id, other)) continue;
    const idx = out.findIndex((x) => x.id === other);
    const v = priceFor(sim, c, r.res).sell * 0.03;
    if (idx >= 0) out[idx].value += v; else out.push({ id: other, value: v });
  }
  return out.sort((a, b) => b.value - a.value).slice(0, n);
}

/** Distance gate for a new agreement: neighbours and partners trade, others do not. */
export function distanceGate(sim: Sim, a: string, b: string): boolean {
  const A = sim.s.countries[a], B = sim.s.countries[b];
  if (!A || !B) return false;
  const pa = sim.world.provinces[A.capital], pb = sim.world.provinces[B.capital];
  return distKm(pa.lat, pa.lon, pb.lat, pb.lon) < 9000;
}
