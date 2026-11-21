import { PROFILE_KEY } from './types';
import { PERKS, XP_PER_LEVEL, levelOf, xpForLevel, type Perk } from '../sim/weapons';

/**
 * Permanent progression.
 *
 * Surviving a run — even a short one — feeds a persistent profile: XP, level,
 * unlocked perks and "изобретения" (field inventions) that change the rules of
 * the next run. No accounts, no server: everything lives in localStorage and is
 * carried into co-op as a shared XP pool.
 */
export interface Invention {
  id: string;
  name: string;
  desc: string;
  cost: number; // levels of the profile
  /** what it modifies */
  mod:
    | { kind: 'magBonus'; value: number }
    | { kind: 'startHp'; value: number }
    | { kind: 'droneCharges'; value: number }
    | { kind: 'dropRate'; value: number }
    | { kind: 'regen'; value: number }
    | { kind: 'xpGain'; value: number };
}

export const INVENTIONS: Invention[] = [
  { id: 'pouch', name: 'Разгрузочный жилет', desc: '+25% ёмкости магазина: патроны носят на себе, а не в рюкзаке.', cost: 2, mod: { kind: 'magBonus', value: 0.25 } },
  { id: 'plates', name: 'Бронеплиты «Гранит»', desc: '+25 к предельному здоровью. Тяжелее, но переживает очередь.', cost: 4, mod: { kind: 'startHp', value: 25 } },
  { id: 'fpv_pack', name: 'FPV-подсумок', desc: 'Начинаешь бой с двумя дронами-камикадзе вместо одного.', cost: 6, mod: { kind: 'droneCharges', value: 1 } },
  { id: 'supply_net', name: 'Радиосеть снабжения', desc: 'Ящики сбрасывают на 30% чаще: «за ленточкой» услышали позывной.', cost: 8, mod: { kind: 'dropRate', value: 0.3 } },
  { id: 'medic_pack', name: 'Аптечка «Альфа»', desc: 'Бинты восстанавливают на 12 единиц больше.', cost: 10, mod: { kind: 'regen', value: 12 } },
  { id: 'field_notes', name: 'Фронтовые записи', desc: '+15% опыта за бой. Опыт — единственное, что отсюда вынесешь.', cost: 12, mod: { kind: 'xpGain', value: 0.15 } },
];

export interface Profile {
  xp: number;
  totalKills: number;
  runs: number;
  bestSurvived: number;
  inventions: string[];
  zoom: number;
  sensitivity: number;
}

const DEFAULT_PROFILE: Profile = {
  xp: 0,
  totalKills: 0,
  runs: 0,
  bestSurvived: 0,
  inventions: [],
  zoom: 0.82,
  sensitivity: 1,
};

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return { ...DEFAULT_PROFILE };
    const p = JSON.parse(raw) as Partial<Profile>;
    return { ...DEFAULT_PROFILE, ...p, inventions: p.inventions ?? [] };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* private mode: the run still works, just without persistence */
  }
}

export const profileLevel = (p: Profile) => levelOf(p.xp);
export const nextLevelAt = (p: Profile) => xpForLevel(levelOf(p.xp) + 1);

export function unlockableInventions(p: Profile): Invention[] {
  return INVENTIONS.filter((i) => !p.inventions.includes(i.id) && profileLevel(p) >= i.cost);
}

export function ownedMod(p: Profile, kind: Invention['mod']['kind']): number {
  let v = 0;
  for (const id of p.inventions) {
    const inv = INVENTIONS.find((i) => i.id === id);
    if (inv && inv.mod.kind === kind) v += inv.mod.value;
  }
  return v;
}

export function buyInvention(p: Profile, id: string): boolean {
  const inv = INVENTIONS.find((i) => i.id === id);
  if (!inv || p.inventions.includes(id) || profileLevel(p) < inv.cost) return false;
  p.inventions.push(id);
  saveProfile(p);
  return true;
}

/** Perks the profile currently has, for the lobby readout. */
export function profilePerks(p: Profile): Perk[] {
  const lvl = levelOf(p.xp);
  return PERKS.filter((perk) => perk.at <= lvl);
}

export { XP_PER_LEVEL, xpForLevel, levelOf };
