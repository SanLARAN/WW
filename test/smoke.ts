// Smoke test: acts of war, grudges, improve cooldown, relation drift.
import { W, H, NAV_W, NAV_H } from '../src/world/worldTypes';
import { World } from '../src/world/world';
import { createSim, dispatch } from '../src/game/game';
import { createGame } from '../src/game/setup';
import { Sim } from '../src/game/sim';

const tags = ['643', '804', '156', '840']; // RU, UA, CN, US
const prov = new Uint16Array(W * H); // value = province index + 1
const nav = new Uint8Array(NAV_W * NAV_H);
const put = (lat: number, lon: number, pid: number) => {
  const x = Math.floor(((lon + 180) / 360) * W), y = Math.floor(((90 - lat) / 180) * H);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) prov[(y + dy) * W + x + dx] = pid + 1;
};
put(55, 37, 0); put(56, 38, 1); put(49, 32, 2); put(38, -97, 3); put(30, 110, 4);
// nav grid: land corridor between the RU and UA blobs so ground pathfinding can connect them.
const mark = (lat: number, lon: number) => {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = Math.floor(((lon + 180) / 360) * NAV_W) + dx, y = Math.floor(((90 - lat) / 180) * NAV_H) + dy;
    if (x >= 0 && x < NAV_W && y >= 0 && y < NAV_H) nav[y * NAV_W + x] = 1;
  }
};
for (let t = 0; t <= 1; t += 0.02) mark(56 + (49 - 56) * t, 38 + (32 - 38) * t);
mark(55, 37); mark(38, -97);

const world = new World({
  tags, prov, ctry: new Uint8Array(1), nav,
  pLat: new Float32Array([55, 56, 49, 38, 30]), pLon: new Float32Array([37, 38, 32, -97, 110]),
  pArea: new Float32Array([100, 100, 100, 100, 100]), pCountry: new Uint8Array([0, 0, 1, 3, 2]),
  pTerrain: new Uint8Array(5), pCoastal: new Uint8Array(5), pElev: new Float32Array(5),
  pLight: new Float32Array(5),
  adjOffsets: new Uint32Array([0, 1, 3, 4, 4, 4]), adjList: new Uint32Array([1, 0, 2, 1]),
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

// 1. All spawned ground units stand on their own soil — no accidental wars on tick one.
const stray = s.units.filter((u) => u.type !== 'navy' && u.type !== 'air').filter((u) => { const p = world.provinceAt(u.lat, u.lon); return p < 0 || s.prov.ctrl[p] !== u.owner; });
T('ground units on own soil', stray.length === 0, `stray=${stray.length}`);

// 2. Improve fires once, then 45-day cooldown.
const e1 = dispatch(sim, '643', { t: 'diplo', action: 'improve', target: '840' });
const e2 = dispatch(sim, '643', { t: 'diplo', action: 'improve', target: '840' });
T('improve once + cooldown', e1 === null && typeof e2 === 'string', `e1=${e1} e2=${e2}`);

// 2a. Neutral territory is closed: move orders rejected, scripted limited strikes don't start wars.
const ru = sim.spawnUnit('643', 'infantry', 56, 38);
ru.engaged = 0;
const relBeforeStrike = R('643', '804');
const mv0 = dispatch(sim, '643', { t: 'move', units: [ru.id], to: { lat: 49, lon: 32 } });
T('neutral move rejected', typeof mv0 === 'string' && ru.path.length === 0, `mv0=${mv0}`);
const lim = sim.launch('643', 'cruise', { lat: 49, lon: 32 }, null, { actOfWar: false });
T('limited strike flies', typeof lim === 'object');
T('limited strike ≠ war', !sim.atWar('643', '804'), `rel ${relBeforeStrike}→${R('643', '804')}`);

// 2b. Missile strike on neutral = war + grudge + improve blocked.
T('pre-war', !sim.atWar('643', '804'));
dispatch(sim, '643', { t: 'launch', missile: 'cruise', to: { lat: 49, lon: 32 }, count: 1 });
T('strike => war', sim.atWar('643', '804'), `rel=${R('643', '804')}`);
T('war log', s.log.some((l) => l.text.includes('без объявления войны')));
T('grudge set', sim.flagUntil(s.countries['804'], 'grudge_', '643') > s.tick);
const e3 = dispatch(sim, '643', { t: 'diplo', action: 'improve', target: '804' });
T('improve blocked at war', e3 === 'Сначала заключите мир', `e3=${e3}`);

// 2d. Call to arms: AI ally joins, player ally gets a request flag, refusal clears it, 90-day cooldown.
s.countries['643'].alliances.push('X643');
s.countries['156'].alliances.push('X643');
s.countries['840'].alliances.push('X643');
sim.invalidateAllies();
const e6 = dispatch(sim, '643', { t: 'diplo', action: 'callToArms', target: '156' });
const w643 = s.wars.find((w) => sim.sideOf(w, '643'));
T('ally joins war', e6 === null && !!w643 && !!sim.sideOf(w643, '156'), `e6=${e6}`);
s.countries['840'].player = 'x';
const e7 = dispatch(sim, '643', { t: 'diplo', action: 'callToArms', target: '840' });
T('player ally gets request', e7 === null && s.countries['840'].flags.includes('calltoarms_643'), `e7=${e7}`);
const e8 = dispatch(sim, '840', { t: 'diplo', action: 'declineCall', target: '643' });
T('decline clears request', e8 === null && !s.countries['840'].flags.includes('calltoarms_643'), `e8=${e8}`);
const e9 = dispatch(sim, '643', { t: 'diplo', action: 'callToArms', target: '156' });
T('already-on-side message', typeof e9 === 'string', `e9=${e9}`);
const e9b = dispatch(sim, '643', { t: 'diplo', action: 'callToArms', target: '840' });
T('call-to-arms cooldown', typeof e9b === 'string' && e9b.includes('уже отправлен'), `e9b=${e9b}`);

// 2c. Inside a real war, ground movement into enemy land works.
const mv1 = dispatch(sim, '643', { t: 'move', units: [ru.id], to: { lat: 49, lon: 32 } });
T('war move allowed', mv1 === null && ru.path.length > 0, `mv1=${mv1}`);
hour(24);
T('unit advanced', Math.hypot(ru.lat - 56, ru.lon - 38) > 0.05, `pos=${ru.lat.toFixed(1)},${ru.lon.toFixed(1)}`);

// 3. After peace the grudge still blocks improve; stranded troops get a withdrawal grace period.
sim.makePeace('643', '804', false);
ru.lat = 49; ru.lon = 32; ru.path = []; // stranded inside UA land
hour(3);
T('peace grace: no instant re-war', !sim.atWar('643', '804'));
for (let i = 0; i < 24 * 50 && !sim.atWar('643', '804'); i++) (sim as any).hour();
T('stranded troops eventually trigger war', sim.atWar('643', '804'));
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
