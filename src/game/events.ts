import type { Sim } from './sim';
import type { CountryState } from './types';
import { EVENTS, EVENT_BY_ID, type GameEvent } from '../data/events';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function pickAi(sim: Sim, c: CountryState, e: GameEvent): number {
  const w = e.options.map((o) => Math.max(0, typeof o.ai === 'function' ? o.ai(sim, c) : o.ai ?? 1));
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let r = sim.rng() * total;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
  return 0;
}

export function applyOption(sim: Sim, c: CountryState, e: GameEvent, i: number) {
  const o = e.options[Math.max(0, Math.min(e.options.length - 1, i))];
  o.effect(sim, c);
  c.stability = Math.max(0, Math.min(100, c.stability));
  if (!e.world && (c.player || e.date || c.gdp > 150)) sim.log(`${e.icon} ${c.name}: «${e.title}» — ${o.label}`, 'event', c.id);
}

function fire(sim: Sim, c: CountryState, e: GameEvent) {
  if (c.player) {
    const s = sim.s;
    if (s.pending.some((p) => p.event === e.id && p.country === c.id)) return;
    if (s.pending.filter((p) => p.country === c.id).length >= 5) return;
    s.pending.push({ key: s.nextId++, event: e.id, country: c.id, deadline: s.tick + 24 * 30 });
  } else applyOption(sim, c, e, pickAi(sim, c, e));
}

export function dailyEvents(sim: Sim) {
  const s = sim.s;
  const today = isoDay(sim.date);
  const campaign = s.settings.mode === 'campaign';
  for (const e of EVENTS) {
    if (e.manual) continue;
    if (e.world) {
      if (sim.rng() < 1 / (e.mtth ?? 1000)) {
        e.options[0].effect(sim, Object.values(s.countries)[0]);
        sim.log(`${e.icon} ${e.title}: ${e.text}`, 'event');
        for (const c of Object.values(s.countries)) if (c.player && !s.pending.some((p) => p.event === e.id && p.country === c.id)) s.pending.push({ key: s.nextId++, event: e.id, country: c.id, deadline: s.tick + 24 * 10 });
      }
      continue;
    }
    if (e.date && !campaign) continue;
    if (e.date && e.date !== today) continue;
    const targets = e.who === 'all' || !e.who ? Object.values(s.countries) : e.who.map((id) => s.countries[id]).filter(Boolean);
    for (const c of targets) {
      if (!c.alive) continue;
      if (e.once && c.flags.includes('ev_' + e.id)) continue;
      if (e.cond && !e.cond(sim, c)) continue;
      if (!e.date) {
        if (!e.mtth || sim.rng() >= 1 / e.mtth) continue;
        if ((c.modifiers.evt_cd ?? 0) > s.tick && e.mtth > 2) continue;
        c.modifiers.evt_cd = s.tick + 24 * 20;
      }
      if (e.once) c.flags.push('ev_' + e.id);
      fire(sim, c, e);
    }
  }
  // Auto-resolve expired player events.
  for (const p of [...s.pending]) {
    if (p.deadline > s.tick) continue;
    resolvePending(sim, p.key, 0);
  }
}

export function resolvePending(sim: Sim, key: number, option: number) {
  const s = sim.s;
  const i = s.pending.findIndex((p) => p.key === key);
  if (i < 0) return;
  const p = s.pending[i];
  s.pending.splice(i, 1);
  const e = EVENT_BY_ID.get(p.event);
  const c = s.countries[p.country];
  if (!e || !c || e.world) return;
  applyOption(sim, c, e, option);
}
