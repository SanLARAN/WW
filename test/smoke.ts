// Smoke test: acts of war, grudges, improve cooldown, relation drift.
import { W, H, NAV_W, NAV_H } from '../src/world/worldTypes';
import { World } from '../src/world/world';
import { createSim, dispatch } from '../src/game/game';
import { createGame } from '../src/game/setup';
import { Sim } from '../src/game/sim';

const tags = ['643', '804', '156', '840']; // RU, UA, CN, US
const prov = new Uint16Array(W * H); // value = province index + 1
const put = (lat: number, lon: number, pid: number) => {
  const x = Math.floor(((lon + 180) / 360) * W), y = Math.floor(((90 - lat) / 180) * H);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) prov[(y + dy) * W + x + dx] = pid + 1;
};
put(55, 37, 0); put(56, 38, 1); put(49, 32, 2); put(38, -97, 3);

const world = new World({
  tags, prov, ctry: new Uint8Array(1), nav: new Uint8Array(NAV_W * NAV_H),
  pLat: new Float32Array([55, 56, 49, 38]), pLon: new Float32Array([37, 38, 32, -97]),
  pArea: new Float32Array([100, 100, 100, 100]), pCountry: new Uint8Array([0, 0, 1, 3]),
  pTerrain: new Uint8Array(4), pCoastal: new Uint8Array(4), pElev: new Float32Array(4),
  pLight: new Float32Array(4),
  adjOffsets: new Uint32Array([0, 1, 3, 4, 4]), adjList: new Uint32Array([1, 0, 2, 1]),
});

const s = createGame(world, { mode: 'campaign', difficulty: 'normal', historical: false });
const sim = createSim(world, s); // full wiring: relations drift, domestic, AI
const R = (a: string, b: string) => Math.round(sim.rel(a, b));
const hour = (n: number) => { for (let i = 0; i < n; i++) (sim as any).hour(); };

let pass = 0, fail = 0;
const T = (name: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };

s.countries['643'].missiles.cruise = 5;
s.countries['643'].player = true;
console.log(`start rel: RU-US=${R('643', '840')} RU-UA=${R('643', '804')}`);

// 1. Improve fires once, then 45-day cooldown.
const e1 = dispatch(sim, '643', { t: 'diplo', action: 'improve', target: '840' });
const e2 = dispatch(sim, '643', { t: 'diplo', action: 'improve', target: '840' });
T('improve once + cooldown', e1 === null && typeof e2 === 'string', `e1=${e1} e2=${e2}`);

// 2. Missile strike on neutral = war + grudge + improve blocked.
T('pre-war', !sim.atWar('643', '804'));
dispatch(sim, '643', { t: 'launch', missile: 'cruise', to: { lat: 49, lon: 32 }, count: 1 });
T('strike => war', sim.atWar('643', '804'), `rel=${R('643', '804')}`);
T('war log', s.log.some((l) => l.text.includes('без объявления войны')));
T('grudge set', sim.flagUntil(s.countries['804'], 'grudge_', '643') > s.tick);
const e3 = dispatch(sim, '643', { t: 'diplo', action: 'improve', target: '804' });
T('improve blocked at war', e3 === 'Сначала заключите мир', `e3=${e3}`);

// 3. After peace the grudge still blocks improve.
sim.makePeace('643', '804', false);
const e4 = dispatch(sim, '643', { t: 'diplo', action: 'improve', target: '804' });
T('improve blocked by grudge', typeof e4 === 'string' && e4.includes('не забудет'), `e4=${e4}`);

// 4. Relations drift toward baseline.
s.relations[Sim.key('643', '156')] = 80;
hour(24 * 30);
T('drift down', sim.rel('643', '156') < 70, `rel=${sim.rel('643', '156').toFixed(1)}`);

// 5. Cooldown expires after 45+ days.
hour(24 * 20);
const e5 = dispatch(sim, '643', { t: 'diplo', action: 'improve', target: '840' });
T('cooldown expired', e5 === null, `e5=${e5} rel=${R('643', '840')}`);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
