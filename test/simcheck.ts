/** Headless long-run playtest: real world, no player, historical off.
 *  Reports world evolution + per-day cost so regressions in either the sim or the
 *  AI hooks show up immediately. Usage: node test/simcheck.mjs [days] */
import { makeWorld } from './harness';
import { createGame } from '../src/game/setup';
import { createSim } from '../src/game/game';
import { applyCommand } from '../src/game/commands';

const DAYS = Number(process.argv[2] ?? 60);
const w = await makeWorld();
const s = createGame(w, { mode: 'campaign', difficulty: 'normal', historical: false });
const sim = createSim(w, s);
s.settings.historical = true; // scripted wars off: the AI must create its own
s.countries['643'].player = 'p';
const hour = () => (sim as any).hour();

const start = { units: s.units.length, alive: Object.values(s.countries).filter((c) => c.alive).length };
console.log(`world ${w.provinces.length} provinces, ${w.tags.length} countries, ${start.units} units`);
let worst = 0, captures = 0, died = 0;
const prevCtrl = Uint8Array.from(s.prov.ctrl.map((x) => w.tags.indexOf(x)));
const maxDay = 400;
for (let d = 0; d < Math.min(DAYS, maxDay); d++) {
  const t0 = performance.now();
  for (let h = 0; h < 24; h++) hour();
  const ms = performance.now() - t0;
  worst = Math.max(worst, ms);
  for (let i = 0; i < s.prov.ctrl.length; i++) {
    const now = w.tags.indexOf(s.prov.ctrl[i]);
    if (now !== prevCtrl[i]) { prevCtrl[i] = now; captures++; }
  }
  if (d % 10 === 9) {
    const alive = Object.values(s.countries).filter((c) => c.alive).length;
    const c643 = s.countries['643'];
    const owned = w.provinces.filter((p) => s.prov.owner[p.id] === '643').length;
    console.log(`d${d + 1} ${ms.toFixed(0)}ms units ${s.units.length} alive ${alive} wars ${s.wars.length} missiles ${s.missiles.length} caps ${captures} | RU gdp ${c643.gdp.toFixed(0)} pop ${c643.pop.toFixed(2)} prov ${owned} tech ${c643.researched.length} res ${c643.research?.id ?? '-'} bld ${owned ? Object.values(s.prov.buildings[c643.capital]).reduce((a, b) => a + (b ?? 0), 0) : 0}`);
  }
}
died = start.alive - Object.values(s.countries).filter((c) => c.alive).length;
console.log(`\ncaptures ${captures}, countries died ${died}, worst day ${worst.toFixed(0)}ms`);
const err = applyCommand(sim, '643', { t: 'buildUnit', unit: 'armor', count: 1 });
console.log('player build command:', err ?? 'ok', 'queue', s.countries['643'].queue.length);
console.log('log tail:', s.log.slice(-6).map((l) => l.text));
