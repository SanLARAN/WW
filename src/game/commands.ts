import type { Sim } from './sim';
import type { BuildingType, CountryState, LL, MissileType, UnitType } from './types';
import { BUILDING, MISSILE, UNIT } from '../data/military';
import { TECH_BY_ID } from '../data/tech';
import { focusAvailable, focusById } from '../data/focus';
import { missileCostOk, unitCostOk } from './domestic';
import { resolvePending } from './events';
import { DOCTRINES, UNLOCKS, opsPoints, opsCooldown } from './strategy';
import { trade as tradeState, routeBlocked, SECTORS, type Sector } from './trade';

export type Command =
  | { t: 'move'; units: number[]; to: LL; append?: boolean }
  | { t: 'hold'; units: number[] }
  | { t: 'disband'; units: number[] }
  | { t: 'buildUnit'; unit: UnitType; count: number }
  | { t: 'buildMissile'; missile: MissileType; count: number }
  | { t: 'buildBuilding'; building: BuildingType; province: number }
  | { t: 'cancelQueue'; index: number }
  | { t: 'research'; id: string }
  | { t: 'focus'; id: string }
  | { t: 'policy'; key: 'tax' | 'researchShare' | 'mobilisation'; value: number }
  | { t: 'econ'; value: CountryState['econ'] }
  | { t: 'printing'; on: boolean }
  | { t: 'quarantine'; value: CountryState['quarantine'] }
  | { t: 'launch'; missile: MissileType; to: LL; count: number; targetUnit?: number | null }
  | { t: 'diplo'; action: DiploAction; target: string; arg?: number | string }
  | { t: 'ops'; op: OpAction; target: string }
  | { t: 'doctrine'; id: string }
  | { t: 'unlock'; id: string }
  | { t: 'trade'; partner: string; res: string }
  | { t: 'routeClose'; id: number }
  | { t: 'company'; sector: string }
  | { t: 'companyClose'; id: number }
  | { t: 'supply'; units: number[] }
  | { t: 'event'; key: number; option: number }
  | { t: 'speed'; speed: number };

/** Strategic operations: one click, immediate, capped by ops points and cooldowns. */
export type OpAction = 'strike' | 'supply' | 'pressure' | 'influence' | 'sabotage' | 'fortify';

export const OPS_INFO: Record<OpAction, { name: string; icon: string; ops: number; cd: number; target: 'enemy' | 'any'; desc: string }> = {
  strike: { name: 'Ракетный удар', icon: '🎯', ops: 2, cd: 6, target: 'enemy', desc: 'Удар по войскам у границы: урон, срыв марша, −орг. Дорого по ресурсам.' },
  supply: { name: 'Снабжение фронта', icon: '📦', ops: 1, cd: 4, target: 'any', desc: 'Выбранным войскам +35 организации прямо сейчас.' },
  pressure: { name: 'Давление', icon: '🧨', ops: 1, cd: 5, target: 'any', desc: '−8 стабильности, −6 одобрения. Требует ВВП и «не добрых» отношений.' },
  influence: { name: 'Купить влияние', icon: '💸', ops: 1, cd: 8, target: 'any', desc: '+14 к отношениям сразу, стоит казны.' },
  sabotage: { name: 'Диверсия', icon: '🕵', ops: 2, cd: 10, target: 'any', desc: '−1 военный завод и −10% ВВП цели. Провал = скандал и −12 отношений.' },
  fortify: { name: 'Возвести укрепления', icon: '🧱', ops: 1, cd: 6, target: 'any', desc: 'Бункер в столице страны-цели (только своя страна/союзник).' },
};

export type DiploAction = 'war' | 'peace' | 'peaceAnnex' | 'improve' | 'insult' | 'sanction' | 'unsanction' | 'alliance' | 'guarantee' | 'lendlease' | 'volunteers' | 'ultimatum' | 'spy' | 'propaganda' | 'proxy' | 'cyber' | 'coup' | 'callAllies' | 'callToArms' | 'acceptCall' | 'declineCall' | 'joinWar' | 'acceptPeace' | 'declinePeace' | 'acceptAlliance' | 'declineAlliance' | 'acceptUltimatum' | 'declineUltimatum';

export const DIPLO_INFO: Record<DiploAction, { name: string; cost: number; desc: string; hostile?: boolean }> = {
  improve: { name: 'Улучшить отношения', cost: 1, desc: '+8 к отношениям (макс. +30). Раз в 45 дней. Не работает в войне и пока цель помнит удары.' },
  insult: { name: 'Дипломатический демарш', cost: 0, desc: '-20 к отношениям, +5 национализма.', hostile: true },
  sanction: { name: 'Ввести санкции', cost: 0, desc: 'Бьёт по экономике цели пропорционально вашему ВВП. -25 к отношениям.', hostile: true },
  unsanction: { name: 'Снять санкции', cost: 0, desc: '+10 к отношениям.' },
  alliance: { name: 'Предложить военный союз', cost: 0, desc: 'Нужны отношения > 60 и схожая идеология. Союзники вступают в войну.' },
  guarantee: { name: 'Гарантировать независимость', cost: 0, desc: 'Вы вступите в войну, если на страну нападут.' },
  lendlease: { name: 'Ленд-лиз', cost: 0, desc: 'Передать $ и вооружение (ПВО/артиллерию). +15 к отношениям.' },
  volunteers: { name: 'Отправить добровольцев', cost: 0.5, desc: 'Передать стране бригаду «отпускников».' },
  ultimatum: { name: 'Ультиматум', cost: 0, desc: 'Потребовать пограничную провинцию. Слабые могут уступить.', hostile: true },
  spy: { name: 'Шпионаж: украсть технологию', cost: 1, desc: 'Шанс получить их технологию. При провале -15 к отношениям.', hostile: true },
  propaganda: { name: 'Пропаганда', cost: 0.5, desc: '-5 стабильности цели.', hostile: true },
  proxy: { name: 'Поддержать оппозицию', cost: 2, desc: '-8 стабильности цели, рост протестов.', hostile: true },
  cyber: { name: 'Кибератака на инфраструктуру', cost: 1, desc: 'Блэкаут: -1% ВВП цели. Требует «Кибератаки».', hostile: true },
  coup: { name: 'Организовать переворот', cost: 10, desc: 'Сменить режим при стабильности < 25. Требует «Глубокое внедрение».', hostile: true },
  war: { name: 'Объявить войну', cost: 0, desc: 'Без повода — огромный штраф к мировому мнению.', hostile: true },
  peace: { name: 'Предложить белый мир', cost: 0, desc: 'Возврат к довоенным границам.' },
  peaceAnnex: { name: 'Потребовать капитуляции', cost: 0, desc: 'Аннексия оккупированных территорий. Принимают при разгроме.' },
  callAllies: { name: 'Призвать союзников', cost: 0, desc: 'Попросить военных союзников вступить в вашу войну.' },
  callToArms: { name: 'Призвать к оружию', cost: 0, desc: 'Попросить союзника вступить в ваши войны. Раз в 90 дней на страну.' },
  acceptCall: { name: 'Ответить на призыв', cost: 0, desc: 'Вступить в войну на стороне союзника.' },
  declineCall: { name: 'Отклонить призыв', cost: 0, desc: 'Отказаться вступать в войну.' },
  joinWar: { name: 'Вступить в войну на их стороне', cost: 0, desc: 'Присоединиться к их войне.' },
  acceptPeace: { name: 'Принять мир', cost: 0, desc: 'Принять предложенные условия мира.' },
  declinePeace: { name: 'Отклонить мир', cost: 0, desc: 'Продолжить войну.' },
  acceptAlliance: { name: 'Принять союз', cost: 0, desc: 'Вступить в военный союз.' },
  declineAlliance: { name: 'Отклонить союз', cost: 0, desc: 'Отказаться от военного союза.' },
  acceptUltimatum: { name: 'Уступить', cost: 0, desc: 'Принять ультиматум и отдать провинцию.' },
  declineUltimatum: { name: 'Отвергнуть', cost: 0, desc: 'Отвергнуть ультиматум.' },
};

export const CASUS_BELLI: Record<string, string> = {
  claims: 'Территориальные претензии', protect: 'Защита соотечественников', terror: 'Борьба с терроризмом',
  preventive: 'Превентивный удар', provocation: 'Ответ на провокацию', none: 'Без повода',
};

/** Validate and apply a command from `country`. Returns error text or null. */
export function applyCommand(sim: Sim, country: string, cmd: Command): string | null {
  const c = sim.c(country);
  if (!c || !c.alive) return 'Страна недоступна';
  switch (cmd.t) {
    case 'move': {
      let ok = 0, blocked = false;
      const dp = sim.world.provinceAt(cmd.to.lat, cmd.to.lon);
      for (const id of cmd.units) {
        const u = sim.unit(id);
        if (!u || u.owner !== country) continue;
        if (dp >= 0 && UNIT[u.type].domain === 'land' && u.type !== 'drones' && !sim.canEnter(country, dp)) { blocked = true; continue; }
        if (UNIT[u.type].domain === 'air') {
          const d = Math.hypot(cmd.to.lat - u.lat, cmd.to.lon - u.lon) * 111;
          if (d > 3000) continue;
        }
        if (sim.orderMove(u, cmd.to.lat + (ok % 3 - 1) * 0.06, cmd.to.lon + (((ok / 3) | 0) % 3 - 1) * 0.06)) { u.hold = false; ok++; }
      }
      if (ok) return null;
      return blocked ? 'Чужая территория — сначала объявите войну или договоритесь о доступе' : 'Нет пути';
    }
    case 'hold': for (const id of cmd.units) { const u = sim.unit(id); if (u?.owner === country) { u.path = []; u.hold = true; } } return null;
    case 'disband': for (const id of cmd.units) { const u = sim.unit(id); if (u?.owner === country) { sim.removeUnit(u); c.manpower += UNIT[u.type].manpower * u.str * 0.005; } } return null;
    case 'buildUnit': {
      const st = UNIT[cmd.unit];
      for (let i = 0; i < cmd.count; i++) {
        const err = unitCostOk(c, cmd.unit);
        if (err) return i ? null : err;
        if (cmd.unit === 'navy' && !(sim.world.byCountry.get(c.id) ?? []).some((p) => (sim.s.prov.buildings[p].shipyard ?? 0) > 0)) return 'Нужна верфь';
        c.budget -= st.cost; c.manpower -= st.manpower; c.stock.steel -= st.steel; c.stock.rare -= st.rare;
        const q = c.queue.find((x) => x.kind === 'unit' && x.item === cmd.unit && x.progress === 0);
        if (q) q.count++; else c.queue.push({ kind: 'unit', item: cmd.unit, progress: 0, days: st.days, count: 1 });
      }
      return null;
    }
    case 'buildMissile': {
      const err = missileCostOk(c, cmd.missile, cmd.count);
      if (err) return err;
      c.budget -= MISSILE[cmd.missile].cost * cmd.count;
      c.queue.push({ kind: 'missile', item: cmd.missile, progress: 0, days: MISSILE[cmd.missile].days, count: cmd.count });
      return null;
    }
    case 'buildBuilding': {
      const b = BUILDING[cmd.building];
      const p = sim.world.provinces[cmd.province];
      if (!p || sim.s.prov.ctrl[cmd.province] !== country) return 'Провинция не под вашим контролем';
      if (!b.allowed(p)) return b.reason;
      if ((sim.s.prov.buildings[cmd.province][cmd.building] ?? 0) >= b.max) return 'Достигнут максимум';
      if (c.budget < b.cost) return `Нужно $${b.cost} млрд`;
      c.budget -= b.cost;
      c.queue.push({ kind: 'building', item: cmd.building, province: cmd.province, progress: 0, days: b.days, count: 1 });
      return null;
    }
    case 'cancelQueue': c.queue.splice(cmd.index, 1); return null;
    case 'research': {
      const t = TECH_BY_ID.get(cmd.id);
      if (!t || c.researched.includes(t.id)) return 'Недоступно';
      if (!t.req.every((r) => c.researched.includes(r))) return 'Сначала изучите предыдущие технологии';
      c.research = { id: t.id, progress: c.research?.id === t.id ? c.research.progress : 0 };
      return null;
    }
    case 'focus': {
      const f = focusById(cmd.id);
      if (!f) return 'Нет фокуса';
      const err = focusAvailable(c, f);
      if (err) return err;
      c.focus = { id: f.id, progress: 0 };
      return null;
    }
    case 'policy': {
      if (cmd.key === 'tax') c.tax = clamp(cmd.value, 0.1, 0.6);
      else if (cmd.key === 'researchShare') c.researchShare = clamp(cmd.value, 0, 0.06);
      else {
        const prev = c.mobilisation;
        c.mobilisation = clamp(cmd.value, 0, 1);
        if (c.mobilisation > prev + 0.05) { c.stability -= (c.mobilisation - prev) * 15; c.manpower += c.pop * 1000 * (c.mobilisation - prev) * 0.02; }
      }
      return null;
    }
    case 'econ': c.econ = cmd.value; c.stability -= 3; return null;
    case 'printing': c.printing = cmd.on; return null;
    case 'quarantine': c.quarantine = cmd.value; return null;
    case 'launch': {
      let n = 0, last: string | null = null;
      for (let i = 0; i < Math.min(cmd.count, 50); i++) {
        const spread = cmd.count > 1 ? 0.15 : 0;
        const r = sim.launch(country, cmd.missile, { lat: cmd.to.lat + (sim.rng() - 0.5) * spread, lon: cmd.to.lon + (sim.rng() - 0.5) * spread }, cmd.targetUnit ?? null);
        if (typeof r === 'string') { last = r; break; }
        n++;
      }
      return n ? null : last;
    }
    case 'diplo': return diplo(sim, c, cmd.action, cmd.target, cmd.arg);
    case 'ops': return ops(sim, c, cmd.op, cmd.target);
    case 'doctrine': return execDoctrine(sim, c, cmd.id);
    case 'unlock': return execUnlock(sim, c, cmd.id);
    case 'trade': return openRoute(sim, c, cmd.partner, cmd.res);
    case 'routeClose': {
      const t = tradeState(sim);
      const r = t.routes.find((x) => x.id === cmd.id);
      if (!r || (r.a !== c.id && r.b !== c.id)) return 'Маршрут не найден';
      t.routes = t.routes.filter((x) => x.id !== cmd.id);
      const other = r.a === c.id ? r.b : r.a;
      sim.addRel(c.id, other, -6);
      return null;
    }
    case 'company': {
      const sec = SECTORS[cmd.sector as Sector];
      if (!sec) return 'Неизвестный сектор';
      const cost = companyCost(sim, c);
      if (c.budget < cost) return `Нужно $${cost.toFixed(0)} млрд`;
      c.budget -= cost;
      const t = tradeState(sim);
      t.companies.push({ id: t.nextId++, owner: c.id, name: `${sec.name} ${c.name}`, sector: cmd.sector as Sector, capital: cost, founded: sim.s.tick });
      for (const [k, v] of Object.entries(sec.mods)) sim.addMod(c, k, v);
      sim.log(`🏢 ${c.name} основывает компанию: ${sec.name} ($${cost.toFixed(0)} млрд)`, 'econ', c.id);
      return null;
    }
    case 'companyClose': {
      const t = tradeState(sim);
      const co = t.companies.find((x) => x.id === cmd.id && x.owner === c.id);
      if (!co) return 'Компания не найдена';
      // Selling out returns most of the value but drops the sector bonus.
      c.budget += co.capital * 0.9;
      t.companies = t.companies.filter((x) => x.id !== co.id);
      const sec = SECTORS[co.sector];
      if (sec) for (const [k, v] of Object.entries(sec.mods)) sim.addMod(c, k, -v);
      return null;
    }
    case 'supply': {
      let n = 0;
      for (const id of cmd.units) {
        const u = sim.unit(id);
        if (!u || u.owner !== country) continue;
        u.org = Math.min(100, u.org + 20); u.str = Math.min(100, u.str + 4); u.ammo += 2; n++;
      }
      if (!n) return 'Выберите свои войска';
      c.budget -= 0.4 * n; c.stock.oil = Math.max(0, c.stock.oil - 2 * n);
      return null;
    }
    case 'event': {
      const p = sim.s.pending.find((x) => x.key === cmd.key);
      if (!p || p.country !== country) return null;
      resolvePending(sim, cmd.key, cmd.option);
      return null;
    }
    case 'speed': sim.s.speed = clamp(Math.round(cmd.speed), 0, 5); return null;
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Willingness of ally `a` to join `c`'s wars: relations, aggression, own fatigue and enemy strength. */
function callToArmsScore(sim: Sim, c: CountryState, a: CountryState): number {
  const power = (x: CountryState) => sim.s.units.filter((u) => u.owner === x.id).reduce((s, u) => s + u.str, 0) * (1 + x.tech * 0.05);
  const foes = new Set<string>();
  for (const w of sim.s.wars) { const s = sim.sideOf(w, c.id); if (s) for (const id of s === 'a' ? w.defenders : w.attackers) foes.add(id); }
  let foePower = 0;
  for (const id of foes) { const e = sim.c(id); if (e) foePower += power(e); }
  const myPower = power(a);
  let score = sim.rel(a.id, c.id) * 0.6 + a.aggression * 40 - a.warExhaustion * 0.5 - sim.enemiesOf(a.id).length * 15;
  if (a.stability < 35) score -= 20;
  if (myPower < foePower * 0.5) score -= 30;
  if (myPower < foePower * 0.25) score -= 30;
  return score;
}

function diplo(sim: Sim, c: CountryState, action: DiploAction, target: string, arg?: number | string): string | null {
  const T = sim.c(target);
  if (!T || !T.alive || target === c.id) return 'Некорректная цель';
  const info = DIPLO_INFO[action];
  if (c.budget < info.cost) return `Нужно $${info.cost} млрд`;
  const rel = sim.rel(c.id, target);
  const atWar = sim.atWar(c.id, target);
  const power = (x: CountryState) => sim.s.units.filter((u) => u.owner === x.id).reduce((a, u) => a + u.str, 0) * (1 + x.tech * 0.05);
  const spySkill = 0.35 + sim.mod(c, 'spy') - sim.mod(T, 'cyber_def') * 0.5;
  const notify = (text: string) => { if (T.player) sim.log(text, 'diplo', T.id); };
  c.budget -= info.cost;
  switch (action) {
    case 'improve': {
      if (atWar) return 'Сначала заключите мир';
      const g = sim.flagUntil(T, 'grudge_', c.id);
      if (g > sim.s.tick) return `${T.name} не забудет ваши действия ещё ~${Math.ceil((g - sim.s.tick) / 24 / 30)} мес.`;
      const cd = sim.flagUntil(c, 'relcd_', target);
      if (cd > sim.s.tick) return `Дипломатический канал занят: повторно через ${Math.ceil((cd - sim.s.tick) / 24)} дн.`;
      if (rel >= 30) return 'Отношения уже тёплые — дальше только союз и совместные дела';
      sim.addRel(c.id, target, 8);
      sim.setFlagUntil(c, 'relcd_', target, sim.s.tick + 24 * 45);
      return null;
    }
    case 'insult': sim.addRel(c.id, target, -20); c.nationalism += 5; sim.addGrudge(target, c.id, 30); notify(`${c.name} выразила вам дипломатический протест`); return null;
    case 'sanction': if (!c.sanctions.includes(target)) { c.sanctions.push(target); sim.addRel(c.id, target, -25); sim.addGrudge(target, c.id, 180); sim.log(`🚫 ${c.name} вводит санкции против ${T.name}`, 'diplo'); } return null;
    case 'unsanction': c.sanctions = c.sanctions.filter((x) => x !== target); sim.addRel(c.id, target, 10); return null;
    case 'alliance': {
      const ideo = c.ideology.reduce((s, v, k) => s + Math.abs(v - T.ideology[k]), 0) / 4;
      if (!T.player && (rel < 60 || ideo > 70)) return `${T.name} отказывается (отношения ${Math.round(rel)}, идеологическая дистанция ${Math.round(ideo)})`;
      if (T.player) {
        if (!T.flags.includes(`allyoffer_${c.id}`)) T.flags.push(`allyoffer_${c.id}`);
        sim.log(`🤝 ${c.name} предлагает вам военный союз — откройте «Дипломатию», чтобы ответить`, 'diplo', target);
        return null;
      }
      const mil = c.alliances.find((a) => a.startsWith('X') || ['NATO', 'CSTO', 'AUKUS'].includes(a));
      const id = mil ?? `X${c.id}`;
      if (!c.alliances.includes(id)) c.alliances.push(id);
      if (!T.alliances.includes(id)) T.alliances.push(id);
      sim.invalidateAllies();
      sim.addRel(c.id, target, 15);
      sim.log(`🤝 ${T.name} вступает в военный союз с ${c.name}`, 'diplo');
      return null;
    }
    case 'guarantee': if (!c.guarantees.includes(target)) { c.guarantees.push(target); sim.addRel(c.id, target, 15); sim.log(`🛡 ${c.name} гарантирует независимость ${T.name}`, 'diplo'); } return null;
    case 'lendlease': {
      const amount = typeof arg === 'number' ? arg : Math.min(5, c.budget * 0.2);
      if (c.budget < amount) return 'Недостаточно средств';
      c.budget -= amount; T.budget += amount; sim.addRel(c.id, target, 15);
      for (const e of sim.enemiesOf(target)) sim.addRel(c.id, e, -10);
      sim.log(`📦 Ленд-лиз: ${c.name} → ${T.name} ($${amount.toFixed(1)} млрд)`, 'diplo');
      return null;
    }
    case 'volunteers': {
      const u = sim.s.units.find((x) => x.owner === c.id && x.type === 'infantry');
      if (!u) return 'Нет свободных бригад';
      const cap = sim.world.provinces[T.capital];
      sim.removeUnit(u);
      const v = sim.spawnUnit(T.id, 'infantry', cap.lat, cap.lon);
      v.name = `Добровольцы из ${c.name}`; v.xp = u.xp; v.str = u.str;
      sim.addRel(c.id, target, 10);
      for (const e of sim.enemiesOf(target)) sim.addRel(c.id, e, -15);
      return null;
    }
    case 'ultimatum': {
      const P = sim.s.prov;
      const border = (sim.world.byCountry.get(target) ?? []).filter((p) => P.owner[p] === target && sim.world.provinces[p].neighbors.some((n) => P.ctrl[n] === c.id));
      if (!border.length) return 'Нет общей границы';
      const ratio = power(c) / Math.max(1, power(T));
      const allies = sim.militaryAllies(target).filter((a) => !sim.militaryAllies(c.id).includes(a));
      if (T.player) {
        if (!T.flags.includes(`ultimatum_${c.id}`)) T.flags.push(`ultimatum_${c.id}`);
        sim.log(`📜 ${c.name} выдвигает вам ультиматум: уступите пограничную провинцию или будет война — откройте «Дипломатию», чтобы ответить`, 'diplo', target);
        return null;
      }
      if (ratio > 3 && !allies.length) {
        const p = border[0];
        P.owner[p] = c.id; P.ctrl[p] = c.id;
        sim.log(`📜 ${T.name} принимает ультиматум и уступает ${sim.world.provinces[p].name}`, 'diplo');
        c.opinion -= 10; sim.addRel(c.id, target, -40);
        return null;
      }
      sim.addRel(c.id, target, -30); sim.s.tension += 5;
      return `${T.name} отвергает ультиматум`;
    }
    case 'spy': {
      if (sim.rng() < spySkill) {
        const tech = T.researched.find((t) => !c.researched.includes(t));
        if (!tech) return 'У них нечего красть';
        c.researched.push(tech);
        for (const [k, v] of Object.entries(TECH_BY_ID.get(tech)?.mods ?? {})) sim.addMod(c, k, v);
        sim.log(`🕵 Агенты ${c.name} похитили технологию: ${TECH_BY_ID.get(tech)?.name}`, 'info', c.id);
        return null;
      }
      sim.addRel(c.id, target, -15); notify(`Разоблачена шпионская сеть ${c.name}!`);
      return 'Агенты провалились';
    }
    case 'propaganda': T.stability -= 5 * (0.5 + spySkill); return null;
    case 'proxy': T.stability -= 8 * (0.5 + spySkill); sim.addRel(c.id, target, -10); return null;
    case 'cyber': {
      if (!c.researched.includes('cyber_attack')) { c.budget += info.cost; return 'Нужна технология «Кибератаки»'; }
      if (sim.rng() < 0.5 + sim.mod(c, 'cyber') - sim.mod(T, 'cyber_def')) { T.gdp *= 0.99; T.stability -= 3; sim.log(`💻 Блэкаут в ${T.name} после кибератаки`, 'alert', T.id); return null; }
      return 'Атака отражена';
    }
    case 'coup': {
      if (!sim.mod(c, 'coup')) { c.budget += info.cost; return 'Нужна технология «Глубокое внедрение»'; }
      if (T.stability > 25) return 'Режим слишком устойчив';
      if (sim.rng() < spySkill) {
        T.ideology = [...c.ideology]; T.leader = 'Новое правительство'; T.stability = 40;
        sim.setRel(c.id, target, 70);
        if (sim.atWar(target, c.id)) sim.makePeace(c.id, target, false);
        sim.log(`🎭 Переворот в ${T.name}! Новый режим ориентируется на ${c.name}`, 'alert');
        return null;
      }
      sim.addRel(c.id, target, -40);
      return 'Заговор раскрыт';
    }
    case 'war': {
      if (atWar) return 'Уже в войне';
      const cb = typeof arg === 'string' ? arg : 'none';
      sim.declareWar(c.id, target, cb);
      return null;
    }
    case 'peace':
    case 'peaceAnnex': {
      if (!atWar) return 'Вы не воюете';
      const P = sim.s.prov;
      let theirs = 0, taken = 0, mine = 0, lost = 0;
      for (let i = 0; i < P.owner.length; i++) {
        const ps = sim.world.provinces[i].popShare;
        if (P.owner[i] === target) { theirs += ps; if (P.ctrl[i] === c.id) taken += ps; }
        if (P.owner[i] === c.id) { mine += ps; if (P.ctrl[i] === target) lost += ps; }
      }
      const score = taken / Math.max(1e-6, theirs) - lost / Math.max(1e-6, mine);
      const weary = T.warExhaustion / 100;
      const war = sim.s.wars.find((w) => sim.sideOf(w, c.id) && sim.sideOf(w, target));
      const months = war ? (sim.s.tick - war.start) / (24 * 30) : 0;
      // Nobody fights forever: exhaustion, a frozen front or a long war all make
      // a white peace attractive. Annexation still needs a real military win.
      const stalemate = months > 6 && Math.abs(score) < 0.1;
      const accept = T.player ? false
        : action === 'peace'
          ? score > -0.05 || weary > 0.15 || stalemate || months > 15 || sim.rng() < 0.15
          : score > 0.35 || (score > 0.15 && weary > 0.4);
      if (T.player) {
        const flag = `peaceoffer_${c.id}_${action}`;
        if (!T.flags.includes(flag)) {
          T.flags.push(flag);
          sim.log(`🕊 ${c.name} предлагает вам ${action === 'peace' ? 'белый мир' : 'капитуляцию'} — откройте «Дипломатию», чтобы ответить`, 'diplo', target);
        }
        return null;
      }
      if (!accept) return `${T.name} отвергает предложение`;
      sim.makePeace(c.id, target, action === 'peaceAnnex');
      const rest = sim.enemiesOf(c.id).filter((e) => !sim.c(e)?.player);
      if (rest.length) for (const e of rest) if (sim.rng() < 0.5) sim.makePeace(c.id, e, false);
      return null;
    }
    case 'callAllies': {
      const war = sim.s.wars.find((w) => sim.sideOf(w, c.id) && sim.sideOf(w, target));
      if (!war || !sim.atWar(c.id, target)) return 'Цель должна быть вашим противником';
      const side = sim.sideOf(war, c.id)!;
      const defensive = war.defenders.includes(c.id);
      let n = 0;
      for (const a of sim.militaryAllies(c.id)) {
        const A = sim.c(a);
        if (!A || sim.sideOf(war, a)) continue;
        if (A.player) {
          if (!A.flags.includes(`calltoarms_${c.id}`)) { A.flags.push(`calltoarms_${c.id}`); sim.log(`📣 ${c.name} призывает вас к оружию — откройте «Дипломатию», чтобы ответить`, 'diplo', a); n++; }
          continue;
        }
        if (callToArmsScore(sim, c, A) + (defensive ? 15 : 0) > 30) { sim.joinWar(a, war, side); n++; }
        else sim.addRel(c.id, a, -5);
      }
      return n ? null : 'Союзники отказались';
    }
    case 'callToArms': {
      const joinable = sim.s.wars.filter((w) => sim.sideOf(w, c.id) && !sim.sideOf(w, target));
      if (!joinable.length) return sim.s.wars.some((w) => sim.sideOf(w, c.id)) ? 'Они уже воюют на вашей стороне' : 'Вы ни с кем не воюете';
      if (!sim.militaryAllies(c.id).includes(target) && rel < 40) return 'Нужен военный союз или отношения > 40';
      const cd = sim.flagUntil(c, 'cta_', target);
      if (cd > sim.s.tick) return `Военный запрос уже отправлен: повторно через ${Math.ceil((cd - sim.s.tick) / 24)} дн.`;
      sim.setFlagUntil(c, 'cta_', target, sim.s.tick + 24 * 90);
      if (T.player) {
        if (!T.flags.includes(`calltoarms_${c.id}`)) T.flags.push(`calltoarms_${c.id}`);
        sim.log(`📣 ${c.name} призывает вас к оружию — откройте «Дипломатию», чтобы ответить`, 'diplo', target);
        return null;
      }
      const defensive = joinable.some((w) => w.defenders.includes(c.id));
      if (callToArmsScore(sim, c, T) + (defensive ? 15 : 0) > 30) {
        for (const w of joinable) sim.joinWar(target, w, sim.sideOf(w, c.id)!);
        return null;
      }
      sim.addRel(c.id, target, -8);
      return `${T.name} отказалась вступать в войну`;
    }
    case 'acceptCall': {
      const flag = `calltoarms_${target}`;
      if (!c.flags.includes(flag)) return 'Нет призыва';
      c.flags = c.flags.filter((f) => f !== flag);
      let n = 0;
      for (const w of sim.s.wars.filter((w) => sim.sideOf(w, target) && !sim.sideOf(w, c.id))) { sim.joinWar(c.id, w, sim.sideOf(w, target)!); n++; }
      if (!n) return 'Война уже окончена';
      return null;
    }
    case 'declineCall': {
      const flag = `calltoarms_${target}`;
      if (!c.flags.includes(flag)) return 'Нет призыва';
      c.flags = c.flags.filter((f) => f !== flag);
      sim.addRel(target, c.id, -8);
      if (T.player) sim.log(`${c.name} отклоняет ваш призыв к оружию`, 'diplo', target);
      return null;
    }
    case 'acceptPeace': {
      const flag = c.flags.find((f) => f.startsWith('peaceoffer_' + target + '_'));
      if (!flag) return 'Нет предложения';
      c.flags = c.flags.filter((f) => f !== flag);
      if (sim.atWar(c.id, target)) sim.makePeace(target, c.id, flag.endsWith('peaceAnnex'));
      return null;
    }
    case 'declinePeace': c.flags = c.flags.filter((f) => !f.startsWith('peaceoffer_' + target + '_')); return null;
    case 'acceptAlliance': {
      const flag = `allyoffer_${target}`;
      if (!c.flags.includes(flag)) return 'Нет предложения';
      c.flags = c.flags.filter((f) => f !== flag);
      const mil = T.alliances.find((a) => a.startsWith('X') || ['NATO', 'CSTO', 'AUKUS'].includes(a)) ?? `X${target}`;
      if (!T.alliances.includes(mil)) T.alliances.push(mil);
      if (!c.alliances.includes(mil)) c.alliances.push(mil);
      sim.invalidateAllies();
      sim.addRel(c.id, target, 15);
      sim.log(`🤝 ${c.name} вступает в военный союз с ${T.name}`, 'diplo');
      return null;
    }
    case 'declineAlliance': {
      const flag = `allyoffer_${target}`;
      if (!c.flags.includes(flag)) return 'Нет предложения';
      c.flags = c.flags.filter((f) => f !== flag);
      sim.addRel(target, c.id, -5);
      if (T.player) sim.log(`${c.name} отклоняет ваше предложение военного союза`, 'diplo', target);
      return null;
    }
    case 'acceptUltimatum': {
      const flag = `ultimatum_${target}`;
      if (!c.flags.includes(flag)) return 'Нет ультиматума';
      c.flags = c.flags.filter((f) => f !== flag);
      const P = sim.s.prov;
      const border = (sim.world.byCountry.get(c.id) ?? []).filter((p) => P.owner[p] === c.id && sim.world.provinces[p].neighbors.some((n) => P.ctrl[n] === target));
      const p = border[0];
      if (p === undefined) return 'Нет общей границы';
      P.owner[p] = target; P.ctrl[p] = target;
      sim.log(`📜 ${c.name} принимает ультиматум ${T.name} и уступает ${sim.world.provinces[p].name}`, 'diplo');
      T.opinion -= 10; sim.addRel(target, c.id, -40);
      return null;
    }
    case 'declineUltimatum': {
      const flag = `ultimatum_${target}`;
      if (!c.flags.includes(flag)) return 'Нет ультиматума';
      c.flags = c.flags.filter((f) => f !== flag);
      sim.addRel(target, c.id, -30); sim.s.tension += 5;
      if (T.player) sim.log(`${c.name} отвергает ваш ультиматум`, 'diplo', target);
      return null;
    }
    case 'joinWar': {
      const war = sim.s.wars.find((w) => sim.sideOf(w, target));
      if (!war) return 'Цель не воюет';
      sim.joinWar(c.id, war, sim.sideOf(war, target)!);
      return null;
    }
  }
}

// ================================================================================================ strategic layer
/** Spend ops points and start the cooldown; returns an error when unaffordable. */
function payOps(sim: Sim, c: CountryState, kind: string, cost: number, cd: number): string | null {
  if (opsPoints(sim, c) < cost) return 'Недостаточно оперативных очков — подождите или постройте штабы';
  const left = opsCooldown(sim, c, kind);
  if (left > 0) return `Перезарядка: ${left} ч`;
  c.flags = c.flags.filter((x) => !x.startsWith('opcd_' + kind + '_'));
  c.flags.push(`opcd_${kind}_${sim.s.tick + cd}`);
  c.modifiers.ops_spent = (c.modifiers.ops_spent ?? 0) + cost;
  return null;
}

function ops(sim: Sim, c: CountryState, op: OpAction, target: string): string | null {
  const info = OPS_INFO[op];
  const T = sim.c(target);
  if (!T || !T.alive) return 'Цель недоступна';
  if (info.target === 'enemy' && !sim.atWar(c.id, target)) return 'Нужно быть в состоянии войны с целью';
  const err = payOps(sim, c, op, info.ops, info.cd);
  if (err) return err;
  const rng = sim.rng();
  switch (op) {
    case 'strike': {
      if (c.missiles.cruise <= 0 && c.missiles.ballistic <= 0) c.missiles.shahed += 6;
      const type: MissileType = c.missiles.ballistic > 0 ? 'ballistic' : c.missiles.cruise > 0 ? 'cruise' : 'shahed';
      c.missiles[type] = Math.max(0, c.missiles[type] - 1);
      const site = sim.launchSite(c, { lat: sim.world.provinces[T.capital].lat, lon: sim.world.provinces[T.capital].lon }, type);
      if (!site || site.km > site.range) { c.missiles[type]++; return 'Цель вне радиуса ракет — переведите войска ближе'; }
      let hit = 0;
      for (const u of sim.s.units) {
        if (u.owner !== target) continue;
        if (Math.abs(u.lat - site.lat) > 12) continue;
        const d = Math.hypot(u.lat - site.lat, u.lon - site.lon);
        if (d > 9) continue;
        u.str -= 14 * (1 - d / 9); u.org -= 22; hit++;
      }
      sim.log(`🎯 ${c.name}: оперативный удар по ${T.name} — целей поражено ${hit}`, 'war', c.id);
      if (!hit) sim.log(`🎯 ${c.name} наносит удар по ${T.name} — потерь нет, но фронт встряхнуло`, 'war', c.id);
      return null;
    }
    case 'supply':
    case 'fortify':
      return null;
    case 'pressure': {
      const power = Math.min(1.5, 0.45 + Math.log10(Math.max(1, c.gdp) / Math.max(1, T.gdp)) * 0.6);
      if (power <= 0.5) return `${T.name} слишком сильна — давление не сработает`;
      T.stability = Math.max(0, T.stability - 8 * power);
      T.approval = Math.max(0, T.approval - 6 * power);
      sim.addRel(c.id, target, -6);
      sim.log(`🧨 ${c.name} давит на ${T.name}: −${(8 * power).toFixed(0)} стабильности`, 'diplo', c.id);
      return null;
    }
    case 'influence': {
      const cost = Math.max(0.4, Math.min(4, T.gdp * 0.004));
      if (c.budget < cost) { c.modifiers.ops_spent = Math.max(0, (c.modifiers.ops_spent ?? 0) - info.ops); return `Нужно ${cost.toFixed(1)} млрд`; }
      c.budget -= cost;
      sim.addRel(c.id, target, 14);
      sim.log(`💸 ${c.name} покупает влияние в ${T.name} (+14 отношений)`, 'diplo', c.id);
      return null;
    }
    case 'sabotage': {
      const ok = rng < 0.55 + Math.min(0.3, c.tech / 30) - Math.min(0.25, T.tech / 40);
      if (!ok) {
        sim.addRel(c.id, target, -12);
        T.stability -= 2;
        sim.log(`🕵 Диверсия ${c.name} против ${T.name} провалилась — международный скандал`, 'diplo', c.id);
        return null;
      }
      for (const p of sim.ownedProvinces(target)) if ((sim.s.prov.buildings[p].milfactory ?? 0) > 0) { sim.s.prov.buildings[p].milfactory!--; break; }
      T.gdp *= 0.9;
      sim.addRel(c.id, target, -4);
      sim.log(`🕵 ${c.name}: диверсия на заводах ${T.name} удалась (−10% ВВП)`, 'diplo', c.id);
      return null;
    }
  }
}

function execDoctrine(sim: Sim, c: CountryState, id: string): string | null {
  const d = DOCTRINES.find((x) => x.id === id);
  if (!d) return 'Неизвестная доктрина';
  if ((c.doctrine ?? '') === id) return 'Уже выбрана';
  if ((c.doctrinePaid ?? 0) > sim.s.tick) return 'Смена доктрины раз в 90 дней';
  for (const [k, v] of Object.entries(d.mods)) sim.addMod(c, k, v);
  c.doctrine = id;
  c.doctrinePaid = sim.s.tick + 24 * 90;
  c.mobilisation = Math.min(1, c.mobilisation + d.mobilisation);
  c.stability = Math.min(100, c.stability + d.stability);
  sim.log(`📜 ${c.name} принимает доктрину «${d.name}»`, 'info', c.id);
  return null;
}

/** Auto-unlock only ever spends points you were not using — that is the point. */
export function autoUnlock(sim: Sim): void {
  for (const c of Object.values(sim.s.countries)) {
    if (!c.alive || c.player) continue;
    if (c.unlockPoints < 1) continue;
    const avail = UNLOCKS.filter((u) => !c.unlocks.includes(u.id) && c.researched.includes(u.tech));
    if (!avail.length) continue;
    avail.sort((a, b) => a.cost - b.cost);
    if (avail[0].cost <= c.unlockPoints) execUnlock(sim, c, avail[0].id);
  }
}

function execUnlock(sim: Sim, c: CountryState, id: string): string | null {
  const u = UNLOCKS.find((x) => x.id === id);
  if (!u) return 'Неизвестная модификация';
  if (c.unlocks.includes(id)) return 'Уже открыто';
  if (!c.researched.includes(u.tech)) return `Нужна технология`;
  if (c.unlockPoints < u.cost) return 'Не хватает очков модернизации';
  c.unlockPoints -= u.cost;
  c.unlocks.push(id);
  for (const [k, v] of Object.entries(u.mods)) sim.addMod(c, k, v);
  // Country-scoped so it never floods the global feed of other players.
  if (c.player) sim.log(`🛠 ${c.name}: ${u.name}`, 'info', c.id);
  return null;
}


// ================================================================================================ trade
export function companyCost(sim: Sim, c: CountryState): number {
  const t = tradeState(sim);
  const mine = t.companies.filter((x) => x.owner === c.id).length;
  return Math.round((12 + mine * 9) * (0.5 + Math.sqrt(Math.max(1, c.gdp)) / 45));
}

/** Open a trade agreement. Cheap, instant, and it has to survive politics. */
function openRoute(sim: Sim, c: CountryState, partner: string, res: string): string | null {
  const B = sim.c(partner);
  if (!B || !B.alive || B.id === c.id) return 'Недоступный партнёр';
  if (!RES_KEYS_SET.has(res)) return 'Неизвестный ресурс';
  const t = tradeState(sim);
  if (t.routes.some((r) => r.res === res && ((r.a === c.id && r.b === partner) || (r.a === partner && r.b === c.id)))) return 'Такой маршрут уже есть';
  const blocked = routeBlocked(sim, c.id, partner);
  if (blocked) return blocked;
  if (B.player) {
    // Human partners get asked, AI partners decide on the spot.
    const flag = `tradeoffer_${c.id}_${res}`;
    if (!B.flags.includes(flag)) B.flags.push(flag);
    sim.log(`🤝 ${c.name} предлагает вам торговое соглашение (${res}) — ответьте в «Торговле»`, 'diplo', partner);
    return null;
  }
  const willingness = sim.rel(c.id, partner) > -20 || sim.militaryAllies(c.id).includes(partner) || sim.militaryAllies(partner).includes(c.id);
  const greedy = sim.rng() < 0.35;
  if (!willingness && !greedy) return `${B.name} отказывается: отношения слишком холодные`;
  t.routes.push({ id: t.nextId++, a: c.id, b: partner, res: res as never, since: sim.s.tick });
  sim.addRel(c.id, partner, 6);
  sim.log(`🤝 ${c.name} и ${B.name}: торговое соглашение (${res})`, 'diplo', c.id);
  return null;
}

const RES_KEYS_SET = new Set(['oil', 'gas', 'uranium', 'steel', 'rare', 'food']);
