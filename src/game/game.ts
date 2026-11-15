import type { World } from '../world/world';
import { Sim } from './sim';
import { dailyDomestic } from './domestic';
import { dailyEvents } from './events';
import { dailyAI, hourlyAI } from './ai';
import { applyCommand, type Command } from './commands';
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

/** Authoritative game: simulation + all subsystems wired together. */
export function createSim(world: World, state: GameState): Sim {
  const sim = new Sim(world, state);
  sim.onDaily(dailyRelations);
  sim.onDaily(dailyDomestic);
  sim.onDaily(dailyEvents);
  sim.onDaily(dailyAI);
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
