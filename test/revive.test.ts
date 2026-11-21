import { generateLayout } from '../src/world/layout';
import { Sim } from '../src/sim/sim';

let pass = 0, fail = 0;
const T = (name: string, ok: boolean, extra = '') => {
  if (ok) { pass++; console.log(`PASS ${name} ${extra}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
};

const layout = generateLayout(3);
const s = new Sim(3, layout);
const a = s.addSoldier('A', true, 0);
const b = s.addSoldier('B', true, 1);
s.s.phase = 'fight';
s.s.wave.timer = 9999;

// kill A with a hostile, then park B next to him
s.damageSoldier(a, 500, null);
T('soldier goes down', !a.alive);
b.x = a.x + 1.5; b.z = a.z;
for (let i = 0; i < 20 * 6; i++) s.step(new Map());
T('squadmate revives', a.alive && a.hp >= 30, `hp=${a.hp.toFixed(0)}`);

// solo: no squadmate, no revive before 20 s
const s2 = new Sim(4, layout);
const solo = s2.addSoldier('S', false, 0);
s2.s.phase = 'fight'; s2.s.wave.timer = 9999;
s2.damageSoldier(solo, 500, null);
for (let i = 0; i < 20 * 10; i++) s2.step(new Map());
T('solo stays down early', !solo.alive);
for (let i = 0; i < 20 * 14; i++) s2.step(new Map());
T('solo self-aid after 20s', solo.alive, `hp=${solo.hp.toFixed(0)}`);

// sim must stay deterministic with revives in the mix
const run = () => {
  const s3 = new Sim(9, layout);
  s3.addSoldier('A', true, 0); s3.addSoldier('B', true, 1);
  s3.s.phase = 'fight';
  for (let i = 0; i < 20 * 30; i++) s3.step(new Map());
  return JSON.stringify(s3.s.soldiers.map((x) => [x.id, x.alive, Math.round(x.hp), Math.round(x.x * 10)]));
};
T('revives deterministic', run() === run());

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exitCode = 1;
