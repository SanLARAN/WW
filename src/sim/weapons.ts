import type { WeaponDef, WeaponId } from '../core/types';

/** Weapon table. Numbers are tuned for a 20 Hz simulated step: ranges in metres. */
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  ak: {
    id: 'ak', name: 'АК-74М', mag: 30, cadence: 105, dmg: 31, falloff: 260, spread: 0.0125, recoil: 0.9, auto: true, pellets: 1, reloadMs: 2300,
  },
  shotgun: {
    id: 'shotgun', name: 'Сайга-12', mag: 8, cadence: 380, dmg: 19, falloff: 45, spread: 0.075, recoil: 2.4, auto: false, pellets: 7, reloadMs: 2900,
  },
  sniper: {
    id: 'sniper', name: 'СВД', mag: 10, cadence: 900, dmg: 92, falloff: 900, spread: 0.0022, recoil: 3.1, auto: false, pellets: 1, reloadMs: 3100,
  },
  lmg: {
    id: 'lmg', name: 'ПКМ', mag: 80, cadence: 92, dmg: 34, falloff: 320, spread: 0.019, recoil: 1.4, auto: true, pellets: 1, reloadMs: 4200,
  },
  /** A quadcopter you throw away: kamikaze FPV with a shaped charge. */
  drone: {
    id: 'drone', name: 'FPV-дрон', mag: 1, cadence: 1400, dmg: 160, falloff: 120, spread: 0.01, recoil: 0, auto: false, pellets: 1, reloadMs: 0,
  },
};

export const WEAPON_ORDER: WeaponId[] = ['ak', 'shotgun', 'sniper', 'lmg', 'drone'];

/** Player capsule geometry (metres). */
export const BODY = { radius: 0.34, eye: 1.68, crouchEye: 1.08, height: 1.8 };
export const SPEED = { walk: 2.7, sprint: 5.1, crouch: 1.35, strafeMod: 0.82 };

/** Permanent progression: every level grants a small, real advantage. */
export const XP_PER_LEVEL = 900;
export function levelOf(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 120)) + 1;
}
export function xpForLevel(l: number): number {
  return Math.pow(Math.max(0, l - 1), 2) * 120;
}
export interface Perk { id: string; name: string; desc: string; at: number }
export const PERKS: Perk[] = [
  { id: 'recoil', name: 'Набитая рука', desc: '−12% отдачи', at: 2 },
  { id: 'hp', name: 'Закалка', desc: '+10 к запасу здоровья', at: 4 },
  { id: 'stamina', name: 'Выносливость', desc: 'Бег дольше на 40%', at: 6 },
  { id: 'reload', name: 'Быстрые руки', desc: 'Перезарядка быстрее на 15%', at: 8 },
  { id: 'suppress', name: 'Хладнокровие', desc: 'Подавление действует на 35% слабее', at: 10 },
  { id: 'scavenge', name: 'Мародёр', desc: 'Из ящиков падает больше патронов', at: 13 },
  { id: 'swift', name: 'Лёгкая походка', desc: '+6% скорости передвижения', at: 16 },
  { id: 'medic', name: 'Санинструктор', desc: 'Бинты восстанавливают на 25% больше', at: 20 },
];
export function perksOf(level: number): Perk[] {
  return PERKS.filter((p) => level >= p.at);
}
