import type { Sim } from './sim';
import type { CountryState } from './types';
import { focusAvailable, focusTree } from '../data/focus';
import { TECHS } from '../data/tech';
import { tierRank } from '../data/countries';

/**
 * The strategic layer: everything that turns "watch numbers tick" into
 * "make a decision with a consequence". Three systems live here:
 *
 *  - Doctrine  — one permanent stance per country (choices, not sliders).
 *  - Unlocks   — a personal tree of military upgrades bought with points.
 *  - Ops       — a regenerating pool that pays for instant, visible actions.
 *
 * All of it is plain JSON on CountryState so the authoritative state stays
 * serialisable and multiplayer snapshots keep working.
 */

export interface Doctrine {
  id: string;
  name: string;
  icon: string;
  desc: string;
  mods: Record<string, number>;
  mobilisation: number;
  stability: number;
}

export const DOCTRINES: Doctrine[] = [
  {
    id: 'blitz', name: 'Блицкриг', icon: '⚡',
    desc: 'Быстрые удары и захват. Армия наступает, но несёт потери.',
    mods: { atk_land: 0.22, org_regen: -0.1, fort: -0.1 }, mobilisation: 0.05, stability: -2,
  },
  {
    id: 'fortress', name: 'Крепость', icon: '🛡',
    desc: 'Оборона и выживание. Врагу дорого даётся каждый километр.',
    mods: { fort: 0.3, def_armor: 0.15, atk_land: -0.1 }, mobilisation: 0, stability: 4,
  },
  {
    id: 'attrition', name: 'Истощение', icon: '🩸',
    desc: 'Долгая война на уничтожение: враг быстрее выгорает и устаёт.',
    mods: { losses: 0.18, org_regen: 0.12, atk_land: 0.05 }, mobilisation: 0.02, stability: -1,
  },
  {
    id: 'tech', name: 'Технологическое превосходство', icon: '🛰',
    desc: 'Качественное преимущество: точнее удары, крепче ПВО, лучше снабжение.',
    mods: { rp: 0.18, ad_eff: 0.2, missile_dmg: 0.2, drone_atk: 0.15 }, mobilisation: -0.03, stability: 2,
  },
  {
    id: 'economy', name: 'Экономическая мобилизация', icon: '🏦',
    desc: 'Мирная машина: больше денег и производства, меньше армии.',
    mods: { prod: 0.2, gdp: 0.06, atk_land: -0.06 }, mobilisation: -0.05, stability: 5,
  },
];

export interface Unlock {
  id: string;
  name: string;
  icon: string;
  desc: string;
  tech: string;
  cost: number;
  mods: Record<string, number>;
}

/** Personal upgrades — pick the ones that match your doctrine. */
export const UNLOCKS: Unlock[] = [
  { id: 'u_react', name: 'Реактивная артиллерия', icon: '🎆', desc: '+18% урона сухопутных войск', tech: 'arm_robot', cost: 1, mods: { atk_land: 0.18 } },
  { id: 'u_drones', name: 'Рой дронов', icon: '🛸', desc: '+25% урона дронов', tech: 'drone_strike', cost: 1, mods: { drone_atk: 0.25 } },
  { id: 'u_ad', name: 'Сетевая ПВО', icon: '📡', desc: '+20% эффективности ПВО и +дальность', tech: 'ad_s300', cost: 1, mods: { ad_eff: 0.2, ad_range: 0.15 } },
  { id: 'u_armor', name: 'Композитная броня', icon: '🪖', desc: '+15% защиты бронетехники', tech: 'arm_aps', cost: 1, mods: { def_armor: 0.15 } },
  { id: 'u_logi', name: 'Логистические коридоры', icon: '🚚', desc: '+12% регенерации организации, +урон', tech: 'starlink', cost: 2, mods: { org_regen: 0.12, atk_land: 0.06 } },
  { id: 'u_missile', name: 'Боевые части нового поколения', icon: '☄', desc: '+25% урона ракет', tech: 'mis_ballistic', cost: 2, mods: { missile_dmg: 0.25 } },
  { id: 'u_ew', name: 'Радиоэлектронная борьба', icon: '📶', desc: '+устойчивость к РЭБ и −эффективность вражеских дронов', tech: 'ew', cost: 2, mods: { ew_resist: 0.3, ew: 0.15 } },
  { id: 'u_intel', name: 'Спутниковая разведка', icon: '🛰', desc: '+урон по данным разведки, лучше удары', tech: 'sat', cost: 2, mods: { intel: 0.25 } },
  { id: 'u_nuke', name: 'Маломощные боеголовки', icon: '☢', desc: '−30% урона по вам от ядерного оружия', tech: 'nuke_tac', cost: 3, mods: { nuke_resist: 0.3 } },
  { id: 'u_industry', name: 'Военный конвейер', icon: '🏭', desc: '+15% производства', tech: 'ai', cost: 2, mods: { prod: 0.15 } },
  { id: 'u_cyber', name: 'Киберкомандование', icon: '💻', desc: '+устойчивость к кибератакам', tech: 'crypto', cost: 1, mods: { cyber_def: 0.3 } },
];

/** Points regrow every 10 days; exceeding the cap is wasted, so spend them. */
export const OPS_CAP = 6;
export function opsPoints(sim: Sim, c: CountryState): number {
  const spent = c.modifiers.ops_spent ?? 0;
  const regen = Math.floor(sim.s.tick / (24 * 10));
  return Math.max(0, Math.min(OPS_CAP, regen + (c.modifiers.ops_bonus ?? 0) - spent));
}
export function opsCooldown(sim: Sim, c: CountryState, kind: string): number {
  const p = 'opcd_' + kind + '_';
  const f = c.flags.find((x) => x.startsWith(p));
  return f ? Math.max(0, (+f.slice(p.length) || 0) - sim.s.tick) : 0;
}

/** Shown in the UI so the player always knows what is next to press. */
export interface Cue {
  id: string; label: string; hint: string;
  panel: 'research' | 'production' | 'army' | 'ops' | 'politics' | 'diplomacy' | 'focus';
  /** Optional one-click fix — the bar becomes a button, not a lecture. */
  act?: { label: string; cmd: () => import('./commands').Command };
}

export function cues(sim: Sim, c: CountryState): Cue[] {
  const out: Cue[] = [];
  if (!c.focus) {
    const f = nextFocus(c);
    out.push({
      id: 'focus', label: 'Выберите национальный фокус', hint: 'Постоянный бонус, бесплатно.', panel: 'focus',
      act: f ? { label: f.name, cmd: () => ({ t: 'focus', id: f.id }) } : undefined,
    });
  }
  if (!c.research) {
    const t = nextTech(c);
    out.push({
      id: 'research', label: 'Запустите исследование', hint: 'Очки науки копятся впустую.', panel: 'research',
      act: t ? { label: t.name, cmd: () => ({ t: 'research', id: t.id }) } : undefined,
    });
  }
  if (c.unlockPoints > 0) {
    const u = UNLOCKS.find((x) => !c.unlocks.includes(x.id) && c.researched.includes(x.tech) && x.cost <= c.unlockPoints);
    out.push({
      id: 'unlock', label: `Откройте модификацию (${c.unlockPoints})`, hint: 'Очки модернизации не тратятся сами.', panel: 'army',
      act: u ? { label: u.name, cmd: () => ({ t: 'unlock', id: u.id }) } : undefined,
    });
  }
  if (!c.doctrine) {
    const d = c.aggression > 0.5 ? DOCTRINES[0] : sim.inWar(c.id) ? DOCTRINES[1] : DOCTRINES[4];
    out.push({ id: 'doctrine', label: 'Примите военную доктрину', hint: 'Стиль игры на всю партию.', panel: 'army', act: { label: d.name, cmd: () => ({ t: 'doctrine', id: d.id }) } });
  }
  const ops = opsPoints(sim, c);
  if (ops >= 2) out.push({ id: 'ops', label: `Потратьте ${ops} оперативных очков`, hint: 'Удары, давление, диверсии — все с мгновенным эффектом.', panel: 'ops' });
  if (c.budget < 0) out.push({ id: 'money', label: 'Казна в минусе', hint: 'Поднимите налог или включите печать денег.', panel: 'politics' });
  if (c.queue.length === 0 && !sim.inWar(c.id)) out.push({ id: 'build', label: 'Заводы простаивают', hint: 'Закажите войска или постройки.', panel: 'production' });
  if (sim.inWar(c.id) && c.mobilisation < 0.5) out.push({ id: 'mob', label: 'Мобилизация ниже 50%', hint: 'Война требует людей.', panel: 'politics' });
  return out.slice(0, 4);
}

/** The cheapest reasonable next focus — the AI uses the same idea. */
export function nextFocus(c: CountryState): { id: string; name: string } | null {
  const tree = focusTree(c.id);
  const ok = tree.filter((f) => !focusAvailable(c, f));
  ok.sort((a, b) => (a.req?.length ?? 0) - (b.req?.length ?? 0) || a.days - b.days);
  return ok[0] ?? null;
}

export function nextTech(c: CountryState): { id: string; name: string } | null {
  const ok = TECHS.filter((t) => !c.researched.includes(t.id) && t.req.every((r) => c.researched.includes(r)) && t.id !== 'bioweapon' && !(t.id.startsWith('nuke') && tierRank(c.tier) > 2));
  ok.sort((a, b) => a.tier - b.tier || a.cost - b.cost);
  return ok[0] ?? null;
}
