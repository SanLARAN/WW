import type { Sim } from './sim';
import type { BuildingType, CountryState, LL, MissileType, UnitType } from './types';
import { BUILDING, MISSILE, UNIT } from '../data/military';
import { TECH_BY_ID } from '../data/tech';
import { focusAvailable, focusById } from '../data/focus';
import { missileCostOk, unitCostOk } from './domestic';
import { resolvePending } from './events';

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
  | { t: 'event'; key: number; option: number }
  | { t: 'speed'; speed: number };

export type DiploAction = 'war' | 'peace' | 'peaceAnnex' | 'improve' | 'insult' | 'sanction' | 'unsanction' | 'alliance' | 'guarantee' | 'lendlease' | 'volunteers' | 'ultimatum' | 'spy' | 'propaganda' | 'proxy' | 'cyber' | 'coup' | 'callAllies' | 'joinWar' | 'acceptPeace' | 'declinePeace';

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
  joinWar: { name: 'Вступить в войну на их стороне', cost: 0, desc: 'Присоединиться к их войне.' },
  acceptPeace: { name: 'Принять мир', cost: 0, desc: 'Принять предложенные условия мира.' },
  declinePeace: { name: 'Отклонить мир', cost: 0, desc: 'Продолжить войну.' },
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
      if (!T.player && ratio > 3 && !allies.length) {
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
      const accept = T.player ? false : action === 'peace' ? score + weary > -0.05 || sim.rng() < 0.15 : score + weary > 0.35;
      if (T.player) { sim.log(`🕊 ${c.name} предлагает вам ${action === 'peace' ? 'белый мир' : 'капитуляцию'} — откройте «Дипломатию», чтобы ответить`, 'diplo', target); T.flags.push(`peaceoffer_${c.id}_${action}`); return null; }
      if (!accept) return `${T.name} отвергает предложение`;
      sim.makePeace(c.id, target, action === 'peaceAnnex');
      return null;
    }
    case 'callAllies': {
      const war = sim.s.wars.find((w) => sim.sideOf(w, c.id) && sim.sideOf(w, target));
      if (!war || !sim.atWar(c.id, target)) return 'Цель должна быть вашим противником';
      let n = 0;
      for (const a of sim.militaryAllies(c.id)) {
        const A = sim.c(a)!;
        if (sim.sideOf(war, a) || A.player) continue;
        if (sim.rel(a, c.id) > 50 && sim.rng() < 0.7) { sim.joinWar(a, war, sim.sideOf(war, c.id)!); n++; }
      }
      return n ? null : 'Союзники отказались';
    }
    case 'acceptPeace': {
      const flag = c.flags.find((f) => f.startsWith('peaceoffer_' + target + '_'));
      if (!flag) return 'Нет предложения';
      c.flags = c.flags.filter((f) => f !== flag);
      if (sim.atWar(c.id, target)) sim.makePeace(target, c.id, flag.endsWith('peaceAnnex'));
      return null;
    }
    case 'declinePeace': c.flags = c.flags.filter((f) => !f.startsWith('peaceoffer_' + target + '_')); return null;
    case 'joinWar': {
      const war = sim.s.wars.find((w) => sim.sideOf(w, target));
      if (!war) return 'Цель не воюет';
      sim.joinWar(c.id, war, sim.sideOf(war, target)!);
      return null;
    }
  }
}
