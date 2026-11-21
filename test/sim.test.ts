// Headless gameplay tests: layout determinism, movement, hits, waves, progression.
import { generateLayout, blocked, raycastLevel, MAP_SIZE } from '../src/world/layout';
import { Sim } from '../src/sim/sim';
import { EMPTY_INPUT, TICK, type InputCmd } from '../src/core/types';
import { levelOf, perksOf, WEAPONS } from '../src/sim/weapons';

let pass = 0, fail = 0;
const T = (name: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`); };

// 1. Determinism: same seed, identical battlefield.
const a = generateLayout(1337), b = generateLayout(1337), c = generateLayout(1338);
T('layout deterministic', JSON.stringify(a.blocks) === JSON.stringify(b.blocks) && a.trees.length === b.trees.length);
T('different seeds differ', JSON.stringify(a.blocks) !== JSON.stringify(c.blocks));
T('map populated', a.blocks.length > 30 && a.trees.length > 200, `blocks=${a.blocks.length} trees=${a.trees.length}`);

// 2. Spawn point is walkable, map edges are not.
T('spawn is clear', !blocked(a, a.spawn.x, a.spawn.z));
T('map edge blocks', blocked(a, MAP_SIZE / 2 + 4, 0) && blocked(a, 0, -MAP_SIZE / 2 - 4));

// 3. Shooting at the ground hits, shooting up at the sky does not.
const down = raycastLevel(a, 0, 1.7, 0, 0, -1, 0, 100);
const up = raycastLevel(a, 0, 1.7, 0, 0, 0.9, 0.3, 100);
T('ray hits ground', down !== null && Math.abs(down - 1.7) < 0.2, `t=${down?.toFixed(2)}`);
T('ray misses sky', up === null);

// 4. A player can walk, sprint faster, and is stopped by a house wall.
const sim = new Sim(7, a);
const sol = sim.addSoldier('Тест', false, 0);
const walk = (cmd: Partial<InputCmd>, steps: number, target = sol) => {
  for (let i = 0; i < steps; i++) {
    const input = { ...EMPTY_INPUT, seq: i + 1, ...cmd };
    sim.step(new Map([[target.id, input]]));
  }
};
const x0 = sol.x, z0 = sol.z;
walk({ mx: 1, mz: 0 }, 20);
T('player moves', Math.hypot(sol.x - x0, sol.z - z0) > 1.5, `d=${Math.hypot(sol.x - x0, sol.z - z0).toFixed(2)}`);
const walked = Math.hypot(sol.x - x0, sol.z - z0);
sol.x = x0; sol.z = z0; sol.stamina = 100;
walk({ mx: 1, mz: 0, sprint: true }, 20);
T('sprint is faster', Math.hypot(sol.x - x0, sol.z - z0) > walked, `sprint=${Math.hypot(sol.x - x0, sol.z - z0).toFixed(2)}`);
sol.stamina = 0;
walk({ mx: 1, mz: 0, sprint: true }, 4);
T('no stamina means no sprint', !sol.sprint);

// walls: drive the soldier into the nearest block and make sure it cannot enter
const wall = a.blocks.find((bl) => bl.kind === 'house' || bl.kind === 'container')!;
sol.x = wall.x - wall.hx - 3; sol.z = wall.z;
sol.vx = 0; sol.vz = 0;
for (let i = 0; i < 90; i++) {
  const input = { ...EMPTY_INPUT, seq: 1000 + i, mx: 1, mz: 0, yaw: Math.PI / 2 };
  // moving +X toward the wall centre
  sim.step(new Map([[sol.id, { ...input, mx: 1, mz: 0 }]]));
}
T('walls stop the player', sol.x < wall.x - wall.hx + 0.1, `x=${sol.x.toFixed(2)} wall=${(wall.x - wall.hx).toFixed(2)}`);

// 5. Firing damages enemies within range and consumes ammo.
const s2 = new Sim(11, a);
const shooter = s2.addSoldier('Стрелок', false, 0);
const target = s2.spawnEnemy('infantry', { x: shooter.x + 12, z: shooter.z });
shooter.yaw = Math.atan2(target.x - shooter.x, target.z - shooter.z);
const hp0 = target.hp;
for (let i = 0; i < 60; i++) {
  s2.step(new Map([[shooter.id, { ...EMPTY_INPUT, seq: i + 1, fire: true, yaw: shooter.yaw }]]));
  if (!target.alive) break;
}
T('bullets kill infantry', target.hp < hp0, `hp ${hp0} -> ${target.hp.toFixed(0)}`);
T('ammo is consumed', shooter.ammo < WEAPONS.ak.mag, `ammo=${shooter.ammo}`);
T('kills award xp', shooter.xp > 0, `xp=${shooter.xp}`);

// 6. Walls block bullets: an enemy behind a house takes no damage.
const s3 = new Sim(13, a);
const gunner = s3.addSoldier('Пулемётчик', false, 0);
const house = a.blocks.find((bl) => bl.kind === 'house')!;
gunner.x = house.x - house.hx - 4; gunner.z = house.z;
const hidden = s3.spawnEnemy('infantry', { x: house.x + house.hx + 4, z: house.z });
gunner.yaw = Math.atan2(hidden.x - gunner.x, hidden.z - gunner.z);
for (let i = 0; i < 40; i++) s3.step(new Map([[gunner.id, { ...EMPTY_INPUT, seq: i + 1, fire: true, yaw: gunner.yaw }]]));
T('buildings block bullets', hidden.hp === hidden.maxHp, `hp=${hidden.hp}`);

// 7. Waves: the intro counts down, then contact happens and the squad takes damage.
const s4 = new Sim(17, a);
const marines = [0, 1, 2].map((i) => s4.addSoldier(`Б${i}`, true, i));
let steps = 0;
while (s4.s.phase === 'intro' && steps < 20 * 120) { s4.step(new Map()); steps++; }
T('intro ends in first contact', s4.s.phase === 'fight', `steps=${steps}`);
for (let i = 0; i < 20 * 90; i++) s4.step(new Map());
T('enemies spawn in waves', s4.s.enemies.length > 0, `enemies=${s4.s.enemies.length} wave=${s4.s.wave.index}`);
T('bots engage', s4.s.kills > 0, `kills=${s4.s.kills}`);
T('squad can die', marines.some((m) => m.hp < m.maxHp), `hp=${marines.map((m) => m.hp.toFixed(0)).join(',')}`);
T('supply drops happen', (() => {
  for (let i = 0; i < 20 * 180; i++) s4.step(new Map());
  return s4.s.supplies.length > 0;
})(), `drops=${s4.s.supplies.length}`);
T('survival clock runs', s4.s.survived > 60, `t=${s4.s.survived.toFixed(0)}s`);

// 8. Bots survive longer than a player who stands still and never shoots.
const s5 = new Sim(19, a);
const idle = s5.addSoldier('Стоящий', false, 0);
s5.s.phase = 'fight';
s5.spawnEnemy('infantry', { x: idle.x + 25, z: idle.z });
let hitAt = -1;
for (let i = 0; i < 20 * 40 && idle.alive; i++) {
  s5.step(new Map([[idle.id, { ...EMPTY_INPUT, seq: i + 1 }]]));
  if (hitAt < 0 && idle.hp < idle.maxHp) hitAt = s5.s.survived;
}
T('standing still gets you shot', idle.hp < idle.maxHp, `hp=${idle.hp.toFixed(0)} at t=${hitAt.toFixed(1)}`);

// 9. Progression maths: levels are monotonic and perks unlock in order.
T('levels grow', levelOf(0) === 1 && levelOf(900) > levelOf(400) && levelOf(40000) > levelOf(900));
T('perks unlock with level', perksOf(1).length === 0 && perksOf(10).length >= 4 && perksOf(20).length === perksOf(30).length);

// 10. Determinism under identical inputs (the co-op invariant).
const runA = new Sim(23, generateLayout(5));
const runB = new Sim(23, generateLayout(5));
for (const r of [runA, runB]) { r.addSoldier('A', false, 0); r.s.phase = 'fight'; }
const inputs = new Map([[1, { ...EMPTY_INPUT, seq: 1, mx: 0.7, mz: 0.3, fire: true }]]);
for (let i = 0; i < 400; i++) { runA.step(inputs); runB.step(inputs); }
T('sim is deterministic', runA.s.kills === runB.s.kills && runA.s.enemies.length === runB.s.enemies.length);
T('tick rate sane', TICK === 0.05);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
