import type { GameState } from './types';
import type { Sim } from './sim';
import { tierRank } from '../data/countries';

/**
 * Campaign mode: instead of an endless sandbox, every run has a goal, a clock and
 * a score. Objectives are computed from live state (no bookkeeping arrays), so
 * they survive saves and multiplayer snapshots for free.
 */

export type ObjKind = 'gdp' | 'tech' | 'provinces' | 'stability' | 'military' | 'survive' | 'conquer' | 'alliance' | 'no-war';

export interface Objective {
  id: string;
  label: string;
  hint: string;
  points: number;
  kind: ObjKind;
  target: number;
  /** extra country id for conquer/alliance objectives */
  against?: string;
}

export const CAMPAIGN_YEARS = 10;

export interface CampaignState {
  score: number;
  objectives: Objective[];
  done: Record<string, number>; // id -> tick completed
  started: number; // tick of game start
  endsAt: number; // tick of the ending screen
  finished: boolean;
  won: boolean;
  peak: { gdp: number; provinces: number; tech: number };
}

export function campaignLength() { return 24 * 365 * CAMPAIGN_YEARS; }

/** Fair, tier-scaled goals: a small country is asked for growth, a superpower for order. */
export function buildObjectives(sim: Sim, me: string): Objective[] {
  const c = sim.s.countries[me];
  if (!c) return [];
  const rank = tierRank(c.tier);
  const provs = sim.ownedProvinces(me).length;
  const scale = rank <= 2 ? 1 : rank === 3 ? 0.65 : 0.45;
  const out: Objective[] = [
    {
      id: 'economy', label: 'Экономический рывок',
      hint: `Поднять ВВП до $${Math.round(c.gdp * (1.4 + 0.3 * scale))} млрд`,
      points: 25, kind: 'gdp', target: Math.round(c.gdp * (1.4 + 0.3 * scale)),
    },
    {
      id: 'science', label: 'Научная держава',
      hint: `Технологический уровень ${(c.tech + 1.5).toFixed(1)}`,
      points: 20, kind: 'tech', target: +(c.tech + 1.5).toFixed(2),
    },
    {
      id: 'order', label: 'Внутренняя устойчивость',
      hint: 'Стабильность 65+ и одобрение 50+ одновременно',
      points: 15, kind: 'stability', target: 65,
    },
    {
      id: 'army', label: 'Обороноспособность',
      hint: `Держать ${Math.max(6, Math.round(provs * 0.12))} соединений в строю`,
      points: 15, kind: 'military', target: Math.max(6, Math.round(provs * 0.12)),
    },
    {
      id: 'lands', label: 'Расширение влияния',
      hint: `Контролировать ${Math.round(provs * (1.15 + 0.1 * scale))} провинций`,
      points: 20, kind: 'provinces', target: Math.round(provs * (1.15 + 0.1 * scale)),
    },
    {
      id: 'survive', label: 'Выстоять',
      hint: 'Дожить до конца кампании, не потеряв независимость',
      points: 25, kind: 'survive', target: 1,
    },
  ];
  // A superpower is additionally expected to answer force with force.
  if (rank <= 2) {
    const rival = Object.values(sim.s.countries)
      .filter((x) => x.alive && x.id !== me)
      .sort((a, b) => sim.rel(me, a.id) - sim.rel(me, b.id))[0];
    if (rival) {
      out.push({
        id: 'dominate', label: 'Стратегическое доминирование',
        hint: `Заставить ${rival.name} уступить: оккупировать её столицу или довести до капитуляции`,
        points: 30, kind: 'conquer', target: 1, against: rival.id,
      });
    }
  }
  return out;
}

export function newCampaign(sim: Sim, me: string): CampaignState {
  return {
    score: 0, objectives: buildObjectives(sim, me), done: {}, started: sim.s.tick,
    endsAt: sim.s.tick + campaignLength(), finished: false, won: false,
    peak: { gdp: sim.s.countries[me]?.gdp ?? 0, provinces: sim.ownedProvinces(me).length, tech: sim.s.countries[me]?.tech ?? 0 },
  };
}

function objectiveDone(sim: Sim, me: string, o: Objective): boolean {
  const c = sim.s.countries[me];
  const P = sim.s.prov;
  switch (o.kind) {
    case 'gdp': return !!c && c.gdp >= o.target;
    case 'tech': return !!c && c.tech >= o.target;
    case 'stability': return !!c && c.stability >= o.target && c.approval >= 50;
    case 'military': return sim.s.units.filter((u) => u.owner === me).length >= o.target;
    case 'provinces': return (sim.provsByCtrl().get(me)?.length ?? 0) >= o.target;
    case 'survive': return !!c?.alive;
    case 'alliance': return !!c && c.alliances.includes(o.against ?? '');
    case 'no-war': return !!c && !sim.inWar(me) && sim.s.tick - (c.modifiers.last_war ?? 0) > 24 * 180;
    case 'conquer': {
      const t = o.against ? sim.s.countries[o.against] : null;
      if (!t) return false;
      const capHeld = !t.alive || P.ctrl[t.capital] === me || sim.occupationShare(t.id, me) > 0.45;
      return capHeld;
    }
  }
}

export interface CampaignTick { completed: Objective[]; finished: boolean; won: boolean }

/** Called once per game day by the sim; mutates the campaign state in place. */
export function tickCampaign(sim: Sim, camp: CampaignState, me: string): CampaignTick {
  const c = sim.s.countries[me];
  const res: CampaignTick = { completed: [], finished: false, won: false };
  if (!c) return res;
  camp.peak.gdp = Math.max(camp.peak.gdp, c.gdp);
  camp.peak.tech = Math.max(camp.peak.tech, c.tech);
  camp.peak.provinces = Math.max(camp.peak.provinces, sim.provsByCtrl().get(me)?.length ?? 0);
  for (const o of camp.objectives) {
    if (camp.done[o.id] !== undefined) continue;
    const done = o.kind === 'provinces'
      ? (sim.provsByCtrl().get(me)?.length ?? 0) >= o.target
      : objectiveDone(sim, me, o);
    if (done) {
      camp.done[o.id] = sim.s.tick;
      camp.score += o.points;
      res.completed.push(o);
    }
  }
  // Independence lost = campaign over, immediately.
  if (!c.alive) { camp.finished = true; camp.won = false; res.finished = true; res.won = false; return res; }
  if (sim.s.tick >= camp.endsAt) {
    camp.finished = true;
    camp.won = camp.objectives.every((o) => camp.done[o.id] !== undefined) || camp.score >= 90;
    res.finished = true; res.won = camp.won;
  }
  return res;
}

/** Progress 0..1 for a single objective, shown in the UI. */
export function objectiveProgress(sim: Sim, me: string, o: Objective): number {
  const c = sim.s.countries[me];
  if (!c) return 0;
  let v = 0, t = o.target;
  switch (o.kind) {
    case 'gdp': v = c.gdp; break;
    case 'tech': v = c.tech; break;
    case 'stability': v = Math.min(c.stability, c.approval); t = Math.min(65, 50); break;
    case 'military': v = sim.s.units.filter((u) => u.owner === me).length; break;
    case 'provinces': v = sim.provsByCtrl().get(me)?.length ?? 0; break;
    case 'survive': v = 1; break;
    case 'conquer': {
      const tg = o.against ? sim.s.countries[o.against] : null;
      v = tg ? (!tg.alive ? 1 : Math.min(1, sim.occupationShare(tg.id, me) / 0.45)) : 0;
      t = 1; break;
    }
    default: v = 0;
  }
  return Math.max(0, Math.min(1, v / Math.max(1e-6, t)));
}

/** End-of-campaign flavour text. */
export function verdict(camp: CampaignState, s: GameState, me: string): { title: string; text: string } {
  const c = s.countries[me];
  const total = camp.objectives.reduce((a, o) => a + o.points, 0);
  const ratio = camp.score / Math.max(1, total);
  const name = c?.name ?? 'Страна';
  if (!c?.alive) return { title: 'Государство пало', text: `${name} прекратила существование. История запомнит ваш выбор — но не вашу страну.` };
  if (ratio >= 0.95) return { title: 'Сверхдержава', text: `${name} вышла из десятилетия потрясений сильнее всех. Учебники будут начинать с вас.` };
  if (ratio >= 0.7) return { title: 'Великая держава', text: `${name} укрепилась и вошла в круг тех, чьё слово решает. Наследие прочное.` };
  if (ratio >= 0.45) return { title: 'Крепкая держава', text: `${name} пережила эпоху без катастроф. Не блестяще, но достойно.` };
  if (ratio >= 0.2) return { title: 'На грани', text: `${name} выжила, но упустила почти всё, что могла взять. Уроки дорогие.` };
  return { title: 'Потерянное десятилетие', text: `${name} провела годы в дрейфе. Соседи не заметили вашего отсутствия в истории.` };
}
