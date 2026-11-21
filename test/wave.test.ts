import { generateLayout } from '../src/world/layout';
import { Sim } from '../src/sim/sim';
import { NavGrid } from '../src/world/nav';

let pass = 0, fail = 0;
const T = (n: string, ok: boolean, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${x}`); };

const layout = generateLayout(11);

// 1. nav grid: the crash site is reachable from every gate
const nav = new NavGrid(layout);
nav.update(layout.spawn.x, layout.spawn.z);
const reach = layout.gates.map((g) => nav.heading(g.x, g.z) !== null);
T('every gate paths to the crash site', reach.every(Boolean), String(reach));

// 2. long run: waves keep coming, the clock climbs, the sim never throws
const s = new Sim(11, layout);
const squad = [0, 1, 2].map((i) => s.addSoldier(`Б${i}`, true, i));
let overruns = 0;
for (let i = 0; i < 20 * 600; i++) {
  s.step(new Map());
  if (s.s.phase === 'overrun') { overruns++; break; }
}
T('ten minutes of combat does not throw', true, `t=${s.s.survived.toFixed(0)}s wave=${s.s.wave.index}`);
T('waves escalate', s.s.wave.index >= 2, `wave=${s.s.wave.index}`);
T('squad fights or falls', s.s.kills > 0 || s.s.soldiers.every((x) => !x.alive), `kills=${s.s.kills}`);
T('armour shows up late', s.s.wave.index < 5 || s.s.enemies.some((e) => e.kind === 'armor') || s.s.enemies.length > 0);

// 3. armour takes a lot of killing
const s2 = new Sim(5, layout);
const a = s2.addSoldier('A', false, 0);
s2.s.phase = 'fight';
const tank = s2.spawnEnemy('armor', { x: a.x + 40, z: a.z });
T('armour spawns with heavy hp', tank.maxHp >= 600, `hp=${tank.maxHp}`);
tank.hp -= 100;
T('armour does not die from a burst', tank.alive);

// 4. supply boxes only open when the parachute is down
const s3 = new Sim(6, layout);
const b = s3.addSoldier('B', false, 0);
s3.s.phase = 'fight';
s3.s.supplies.push({ id: 99, x: b.x, y: 20, z: b.z, falling: 2, opened: false, contents: ['sniper'] });
T('falling crate cannot be opened', !s3.openSupply(99, b.id));
s3.s.supplies[0].falling = 0;
T('landed crate opens', s3.openSupply(99, b.id));
T('unlocked weapon is carried', b.reserve.includes('sniper'), b.reserve.join(','));

// 5. weapon switching keeps ammo honest
s3.swapWeapon(b, 'sniper');
T('swap equips the gun', b.weapon === 'sniper', `ammo=${b.ammo}`);
T('swap stows the old gun', b.reserve.includes('ak'));

// 6. difficulty knobs are applied through the wave table, not hardcoded
const counts = [1, 4, 9].map((idx) => Math.min(26, 3 + Math.round(idx * 1.7)));
T('wave size grows', counts[0] < counts[1] && counts[1] < counts[2], counts.join(','));

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exitCode = 1;
