import type { World } from '../world/world';
import { Sim } from './sim';
import { dailyDomestic } from './domestic';
import { dailyEvents } from './events';
import { dailyAI, hourlyAI } from './ai';
import { applyCommand, autoUnlock, type Command } from './commands';
import type { GameState } from './types';

/** Relations decay toward a baseline set by treaties and grudges — bought friendship fades. */
function dailyRelations(sim: Sim) {
  const s = sim.s, tick = s.tick;
  for (const k of Object.keys(s.relations)) {
    const i = k.indexOf('|');
    const a = k.slice(0, i), b = k.slice(i + 1);
    const A = s.countries[a], B = s.countries[b];
    if (!A?.alive || !B?.alive) { delete s.relations[k]; continue; }
    let base = 0;
    if (sim.atWar(a, b)) base = -95;
    else {
      const grudged = sim.flagUntil(A, 'grudge_', b) > tick || sim.flagUntil(B, 'grudge_', a) > tick;
      const allied = sim.militaryAllies(a).includes(b);
      if (allied) base = grudged ? -20 : 55;
      else if (grudged) base = -55;
      else if (A.sanctions.includes(b) || B.sanctions.includes(a)) base = -40;
      else if (A.guarantees.includes(b) || B.guarantees.includes(a)) base = 30;
    }
    const cur = s.relations[k], next = cur + (base - cur) * 0.02;
    if (Math.abs(next - base) < 0.5) { if (base === 0) delete s.relations[k]; else s.relations[k] = base; }
    else s.relations[k] = next;
  }
}

/** Strategic layer upkeep: modernisation points, doctrine for the AI, unlock spending. */
export function dailyStrategy(sim: Sim) {
  const s = sim.s;
  for (const c of Object.values(s.countries)) {
    if (!c.alive) continue;
    // Points accrue from factories + capital labs, so industry pays twice.
    let mil = 0, labs = 0;
    for (const p of sim.provsByCtrl().get(c.id) ?? []) {
      mil += s.prov.buildings[p].milfactory ?? 0;
      labs += s.prov.buildings[p].lab ?? 0;
    }
    const gain = mil + (labs >= 4 ? 1 : 0);
    if (gain && s.tick % (24 * 10) === 0) c.unlockPoints = Math.min(12, c.unlockPoints + (gain >= 3 ? 1 : 0) + (s.tick % (24 * 30) === 0 ? 1 : 0));
    if (c.modifiers.ops_bonus === undefined) c.modifiers.ops_bonus = 0;
  }
  autoUnlock(sim);
}

/** Authoritative game: simulation + all subsystems wired together. */
export function createSim(world: World, state: GameState): Sim {
  const sim = new Sim(world, state);
  sim.onDaily(dailyRelations);
  sim.onDaily(dailyDomestic);
  sim.onDaily(dailyEvents);
  sim.onDaily(dailyAI);
  sim.onDaily(dailyStrategy);
  sim.onHourly(hourlyAI);
  return sim;
}

export function dispatch(sim: Sim, country: string, cmd: Command): string | null {
  try {
    return applyCommand(sim, country, cmd);
  } catch (e) {
    console.error('command failed', cmd, e);
    return 'Ошибка команды';
  }
}
