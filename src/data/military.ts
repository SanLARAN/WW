import type { BuildingType, MissileType, UnitType } from '../game/types';
import type { Province } from '../world/world';
import { Terrain } from '../world/worldTypes';

export interface UnitStats {
  name: string;
  short: string;
  atk: number;
  def: number;
  /** km/h */
  speed: number;
  /** engagement range, km */
  range: number;
  cost: number; // $bn
  steel: number;
  rare: number;
  oil: number; // per day upkeep
  manpower: number; // thousands
  days: number;
  upkeep: number; // $bn/day
  domain: 'land' | 'air' | 'sea';
  ammo: number;
  desc: string;
  requires?: string; // tech id
}

export const UNIT: Record<UnitType, UnitStats> = {
  infantry: { name: 'Мотострелковая бригада', short: 'Пехота', atk: 9, def: 14, speed: 1.6, range: 18, cost: 0.6, steel: 3, rare: 0, oil: 0.4, manpower: 4, days: 30, upkeep: 0.0035, domain: 'land', ammo: 0, desc: 'Основа армии. Держит фронт, захватывает территорию, сильна в обороне и городах.' },
  armor: { name: 'Танковая бригада', short: 'Танки', atk: 18, def: 11, speed: 2.4, range: 20, cost: 1.4, steel: 8, rare: 1, oil: 1.2, manpower: 3, days: 50, upkeep: 0.008, domain: 'land', ammo: 0, desc: 'Ударный кулак. Прорыв обороны и быстрое наступление на равнинах. Уязвима для FPV и ПТРК.' },
  artillery: { name: 'Артиллерийская бригада', short: 'Арта', atk: 15, def: 5, speed: 1.4, range: 60, cost: 0.8, steel: 5, rare: 0, oil: 0.5, manpower: 2, days: 40, upkeep: 0.005, domain: 'land', ammo: 0, desc: 'Ствольная артиллерия и РСЗО. Бьёт по врагу на дистанции до 60 км.' },
  airdef: { name: 'Зенитный ракетный полк', short: 'ПВО', atk: 3, def: 6, speed: 1.2, range: 160, cost: 1.6, steel: 4, rare: 3, oil: 0.4, manpower: 1, days: 60, upkeep: 0.007, domain: 'land', ammo: 32, desc: 'Перехват ракет, дронов и авиации в радиусе действия. Ограниченный боекомплект.' },
  drones: { name: 'Отряд БПЛА', short: 'Дроны', atk: 12, def: 2, speed: 6, range: 90, cost: 0.3, steel: 1, rare: 2, oil: 0.1, manpower: 0.5, days: 20, upkeep: 0.002, domain: 'land', ammo: 0, desc: 'Ударные и FPV-дроны. Дёшево, точно, далеко. Глушатся РЭБ и сбиваются ПВО.' },
  air: { name: 'Авиаполк', short: 'ВВС', atk: 22, def: 8, speed: 450, range: 70, cost: 4, steel: 3, rare: 4, oil: 3, manpower: 0.6, days: 120, upkeep: 0.02, domain: 'air', ammo: 0, desc: 'Истребители и штурмовики. Удары по войскам, господство в воздухе. Боится ПВО.' },
  navy: { name: 'Корабельная группа', short: 'Флот', atk: 16, def: 20, speed: 30, range: 60, cost: 5, steel: 20, rare: 3, oil: 2.5, manpower: 2, days: 240, upkeep: 0.025, domain: 'sea', ammo: 8, desc: 'Контроль морей, обстрел побережья, пуски крылатых ракет.' },
  special: { name: 'Отряд спецназа', short: 'Спецназ', atk: 11, def: 7, speed: 3.2, range: 15, cost: 0.4, steel: 0.5, rare: 0.5, oil: 0.1, manpower: 0.5, days: 30, upkeep: 0.003, domain: 'land', ammo: 0, desc: 'Диверсии, захват ключевых объектов, разведка. Быстрый и незаметный.' },
};

export interface MissileStats { name: string; real: string; range: number; dmg: number; radius: number; evade: number; speed: number; cost: number; days: number; requires?: string; desc: string }

export const MISSILE: Record<MissileType, MissileStats> = {
  ballistic: { name: 'Оперативно-тактическая ракета', real: 'Искандер / ATACMS', range: 500, dmg: 30, radius: 25, evade: 0.45, speed: 2.2, cost: 0.004, days: 10, desc: 'Быстрая баллистика. Трудно перехватить.' },
  cruise: { name: 'Крылатая ракета', real: 'Калибр / Tomahawk / Storm Shadow', range: 2500, dmg: 25, radius: 20, evade: 0.3, speed: 0.55, cost: 0.002, days: 8, desc: 'Летит низко, огибая рельеф. Дальность до 2500 км.' },
  hypersonic: { name: 'Гиперзвуковая ракета', real: 'Кинжал / Циркон / DF-17', range: 2000, dmg: 40, radius: 25, evade: 0.85, speed: 4.5, cost: 0.01, days: 20, requires: 'mis_hyper', desc: 'Почти неуязвима для ПВО. Требует технологии.' },
  shahed: { name: 'Дрон-камикадзе', real: 'Shahed-136 / Lancet', range: 2000, dmg: 12, radius: 12, evade: 0.12, speed: 0.25, cost: 0.00005, days: 2, desc: 'Дёшево и массово. Перегружает ПВО.' },
  icbm: { name: 'МБР с ядерной БЧ', real: 'Ярс / Minuteman III / DF-41', range: 13000, dmg: 100, radius: 140, evade: 0.92, speed: 1.6, cost: 0.08, days: 90, requires: 'nuke_strat', desc: 'Стратегическое ядерное оружие. Мир этого не забудет.' },
};

export interface BuildingStats { name: string; cost: number; days: number; desc: string; max: number; allowed: (p: Province) => boolean; reason: string }

const urban = (p: Province) => p.light > 0.12 || !!p.city;

export const BUILDING: Record<BuildingType, BuildingStats> = {
  factory: { name: 'Гражданский завод', cost: 2, days: 120, max: 5, desc: '+ВВП и производство', allowed: urban, reason: 'Нужен крупный город' },
  milfactory: { name: 'Военный завод', cost: 3, days: 150, max: 5, desc: '+15% скорости военного производства', allowed: urban, reason: 'Нужен крупный город' },
  refinery: { name: 'НПЗ / нефтевышки', cost: 2.5, days: 120, max: 3, desc: '+нефть и газ', allowed: (p) => !!(p.resources.oil || p.resources.gas), reason: 'Нужно месторождение нефти или газа' },
  mine: { name: 'Шахта / карьер', cost: 1.5, days: 90, max: 3, desc: '+сталь, уран, редкоземельные', allowed: (p) => !!(p.resources.steel || p.resources.rare || p.resources.uranium), reason: 'Нужно месторождение руды' },
  shipyard: { name: 'Верфь', cost: 3, days: 180, max: 3, desc: 'Позволяет строить флот', allowed: (p) => p.coastal && urban(p), reason: 'Нужен прибрежный город' },
  airbase: { name: 'Авиабаза', cost: 1.5, days: 90, max: 3, desc: 'Базирование авиации, +ремонт ВВС', allowed: (p) => p.terrain !== Terrain.Mountains, reason: 'Нельзя строить в горах' },
  lab: { name: 'НИИ', cost: 2, days: 120, max: 3, desc: '+10% очков исследований', allowed: urban, reason: 'Нужен крупный город' },
  npp: { name: 'АЭС', cost: 6, days: 360, max: 2, desc: '+ВВП, -потребление газа', allowed: (p) => p.coastal || p.terrain === Terrain.Plains || p.terrain === Terrain.Forest, reason: 'Нужна вода для охлаждения' },
  bunker: { name: 'Укрепрайон', cost: 1, days: 60, max: 5, desc: '+20% обороны в провинции', allowed: () => true, reason: '' },
  farm: { name: 'Агрокомплекс', cost: 1, days: 90, max: 3, desc: '+продовольствие', allowed: (p) => p.terrain === Terrain.Plains || !!p.resources.food, reason: 'Нужны сельхозугодья' },
};

const UNIT_NAMES: Record<UnitType, string[]> = {
  infantry: ['мотострелковая бригада', 'механизированная бригада', 'бригада морской пехоты', 'горно-стрелковая бригада'],
  armor: ['танковая бригада', 'бронетанковая бригада', 'гвардейская танковая бригада'],
  artillery: ['артиллерийская бригада', 'бригада РСЗО', 'ракетная бригада'],
  airdef: ['зенитный ракетный полк', 'бригада ПВО', 'зенитный дивизион'],
  drones: ['отряд БПЛА', 'батальон ударных дронов', 'FPV-отряд'],
  air: ['истребительный авиаполк', 'штурмовой авиаполк', 'бомбардировочный полк'],
  navy: ['корабельная группа', 'эскадра', 'ударная группа'],
  special: ['отряд спецназа', 'группа ССО', 'разведбатальон'],
};

export function unitName(type: UnitType, n: number): string {
  const list = UNIT_NAMES[type];
  const name = list[n % list.length];
  const masc = /^(отряд|FPV-отряд|зенитный|истребительный|штурмовой|бомбардировочный|батальон|разведбатальон|группа ССО_)/.test(name);
  return `${n}-${masc ? 'й' : 'я'} ${name}`;
}
