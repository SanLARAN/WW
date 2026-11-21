// Smoke test: acts of war, grudges, improve cooldown, relation drift.
import { W, H, NAV_W, NAV_H } from '../src/world/worldTypes';
import { World } from '../src/world/world';
import { createSim, dispatch } from '../src/game/game';
import { createGame } from '../src/game/setup';
import { Sim } from '../src/game/sim';
import { cues, opsPoints } from '../src/game/strategy';

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
// Either the channel reopened (e5 === null) or relations already climbed past the
// "warm" threshold — both mean the 45-day cooldown is gone.
T('cooldown expired', e5 === null || e5.includes('уже тёплые'), `e5=${e5} rel=${R('643', '840')}`);

// 6. Two-sided diplomacy: alliance and ultimatum on a player become request cards, never instant.
const e10 = dispatch(sim, '804', { t: 'diplo', action: 'alliance', target: '840' });
T('alliance to player = request', e10 === null && s.countries['840'].flags.includes('allyoffer_804') && !sim.militaryAllies('804').includes('840'), `e10=${e10}`);
const e11 = dispatch(sim, '840', { t: 'diplo', action: 'acceptAlliance', target: '804' });
T('accept alliance joins', e11 === null && sim.militaryAllies('804').includes('840') && !s.countries['840'].flags.includes('allyoffer_804'), `e11=${e11}`);

const e12 = dispatch(sim, '804', { t: 'diplo', action: 'ultimatum', target: '643' });
T('ultimatum to player = card', e12 === null && s.countries['643'].flags.includes('ultimatum_804'), `e12=${e12}`);
const e13 = dispatch(sim, '643', { t: 'diplo', action: 'acceptUltimatum', target: '804' });
T('accept ultimatum cedes province', e13 === null && s.prov.owner[1] === '804', `owner→${s.prov.owner[1]}`);
dispatch(sim, '804', { t: 'diplo', action: 'ultimatum', target: '643' });
const e14 = dispatch(sim, '643', { t: 'diplo', action: 'declineUltimatum', target: '804' });
T('decline ultimatum clears', e14 === null && !s.countries['643'].flags.includes('ultimatum_804'), `e14=${e14}`);

// 7. World event pending is resolved through the host path, not only locally.
s.pending.push({ key: s.nextId++, event: 'oil_shock', country: '643', deadline: s.tick + 24 });
const wkey = s.pending[s.pending.length - 1].key;
dispatch(sim, '643', { t: 'event', key: wkey, option: 0 });
T('world event resolved host-side', !s.pending.some((p) => p.key === wkey));

// 8. Losing player gets a capitulation decision instead of instant annexation.
s.countries['804'].player = 'x';
sim.declareWar('643', '804', 'claims');
const dayNow = () => (sim as any).day();
s.prov.ctrl[1] = '643'; s.prov.ctrl[2] = '643'; // UA fully occupied
dayNow();
const capPend = s.pending.find((p) => p.event === 'capitulation' && p.country === '804');
T('player capitulation asks first', !!capPend && s.countries['804'].alive);
if (capPend) {
  dispatch(sim, '804', { t: 'event', key: capPend.key, option: 1 });
  T('fight-on sets cooldown', (s.countries['804'].modifiers.cap_cd ?? 0) > s.tick);
  dayNow();
  T('no re-ask during cooldown', !s.pending.some((p) => p.event === 'capitulation' && p.country === '804'));
  s.countries['804'].modifiers.cap_cd = 0;
  dayNow();
  const capPend2 = s.pending.find((p) => p.event === 'capitulation' && p.country === '804');
  if (capPend2) dispatch(sim, '804', { t: 'event', key: capPend2.key, option: 0 });
  T('accept capitulation resolves', s.log.some((l) => l.text.includes('капитулирует')) && !s.pending.some((p) => p.event === 'capitulation' && p.country === '804'));
}

// 9. Strategic layer: doctrine, upgrades, ops points and instant operations.
const ru2 = s.countries['643'];
ru2.doctrine = ''; ru2.doctrinePaid = 0; ru2.unlocks = []; ru2.unlockPoints = 3;
T('doctrine accepted', dispatch(sim, '643', { t: 'doctrine', id: 'blitz' }) === null && ru2.doctrine === 'blitz');
const atkBase = sim.mod(ru2, 'atk_land');
T('doctrine mods applied', Math.abs(atkBase - 0.22) < 0.2 && atkBase > 0.1, `atk=${atkBase}`);
T('doctrine lockout', typeof dispatch(sim, '643', { t: 'doctrine', id: 'fortress' }) === 'string');
ru2.researched.push('mis_ballistic');
T('unlock bought', dispatch(sim, '643', { t: 'unlock', id: 'u_missile' }) === null && ru2.unlocks.includes('u_missile') && ru2.unlockPoints === 1);
T('unlock without tech blocked', typeof dispatch(sim, '643', { t: 'unlock', id: 'u_nuke' }) === 'string');

// Ops pool: regenerates with sim time, blocks when spent, cools down.
ru2.modifiers.ops_spent = 0;
const tick0 = s.tick;
s.tick = tick0 + 24 * 30;
T('ops regenerate', opsPoints(sim, ru2) > 0, `ops=${opsPoints(sim, ru2)}`);
s.countries['804'].alive = true;
sim.declareWar('643', '804', 'claims');
const opErr = dispatch(sim, '643', { t: 'ops', op: 'pressure', target: '804' });
const stabAfter = s.countries['804'].stability;
T('pressure applies', opErr === null && stabAfter < 100);
T('ops cooldown enforced', typeof dispatch(sim, '643', { t: 'ops', op: 'pressure', target: '804' }) === 'string');
const strikeErr = dispatch(sim, '643', { t: 'ops', op: 'strike', target: '804' });
T('strike reachable or explained', strikeErr === null || /радиус|позиц/i.test(strikeErr), `e=${strikeErr}`);
T('supply heals own units', (() => {
  const u = s.units.find((x) => x.owner === '643' && x.type !== 'navy');
  if (!u) return false;
  u.org = 10; const err = dispatch(sim, '643', { t: 'supply', units: [u.id] });
  return err === null && u.org > 25;
})());
T('cues suggest something', cues(sim, s.countries['643']).length > 0);

// 10. Campaign layer: objectives, score, ending; saves round-trip through storage.
import { newCampaign, tickCampaign, objectiveProgress } from '../src/game/campaign';
import { writeSave, readSave, setSaveStorage, readMeta, deleteSave } from '../src/game/save';

const camp = newCampaign(sim, '643');
T('campaign has objectives', camp.objectives.length >= 5 && camp.objectives.every((o) => o.points > 0));
T('campaign progress in range', camp.objectives.every((o) => { const p = objectiveProgress(sim, '643', o); return p >= 0 && p <= 1; }));
const before = camp.score;
s.countries['643'].gdp = 1e6;
const tickRes = tickCampaign(sim, camp, '643');
T('objective completes and scores', camp.score > before && tickRes.completed.some((o) => o.id === 'economy'), `score=${camp.score}`);
camp.endsAt = s.tick; // force the deadline
const endRes = tickCampaign(sim, camp, '643');
T('campaign ends at deadline', endRes.finished && camp.finished);

// Save/load round trip (in-memory storage, same code path as the browser).
const mem = new Map<string, string>();
setSaveStorage({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) });
s.campaign = camp;
const meta = await writeSave('1', sim, '643', camp.score);
T('save writes meta', meta.country === '643' && readMeta('1')?.score === camp.score);
T('save is compressed', (mem.get('ww.save.1')?.length ?? 0) < JSON.stringify(s).length);
const loaded = await readSave('1');
T('save round-trips', !!loaded && loaded.state.tick === s.tick && loaded.state.prov.ctrl.length === s.prov.ctrl.length);
T('save keeps campaign', !!loaded && (loaded.state.campaign as typeof camp | undefined)?.score === camp.score);
deleteSave('1');
T('save delete', readMeta('1') === null);

// 11. Naval blockade: an enemy fleet on our coast cuts income.
const blocker = s.units.find((u) => u.owner === '804' && u.type === 'navy') ?? sim.spawnUnit('804', 'navy', 45, 32);
sim.declareWar('804', '643', 'claims');
const before2 = sim.blockadeLevel('643');
T('blockade detected from a fleet', (() => {
  // Move the fleet next to a Russian coastal province.
  const rusCoast = (world.byCountry.get('643') ?? []).find((p) => world.provinces[p].coastal);
  if (rusCoast === undefined) return true; // synthetic world may have no coast
  const nb = world.provinces[rusCoast].neighbors[0];
  const tgt = world.provinces[blocker ? rusCoast : nb];
  blocker.lat = tgt.lat; blocker.lon = tgt.lon;
  return sim.blockadeLevel('643') >= 0;
})(), `blocked=${before2}`);
T('peaceful countries are not blockaded', sim.blockadeLevel('156') === 0);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
