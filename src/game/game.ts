import type { World } from '../world/world';
import { Sim } from './sim';
import { dailyDomestic } from './domestic';
import { dailyEvents } from './events';
import { dailyAI, hourlyAI } from './ai';
import { applyCommand, type Command } from './commands';
import type { GameState } from './types';

/** Authoritative game: simulation + all subsystems wired together. */
export function createSim(world: World, state: GameState): Sim {
  const sim = new Sim(world, state);
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
