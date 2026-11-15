import type { Sim } from '../game/sim';
import type { CountryState, MissileType, UnitType } from '../game/types';
import { TECH_BY_ID } from './tech';

export interface Focus {
  id: string;
  name: string;
  desc: string;
  icon: string;
  days: number;
  x: number;
  y: number;
  req?: string[];
  /** requires any of these */
  reqAny?: string[];
  excl?: string[];
  effect?: (sim: Sim, c: CountryState) => void;
}

// ---- effect helpers ---------------------------------------------------------------------------
export const fx = {
  rel(sim: Sim, c: CountryState, ids: string[], d: number) { for (const id of ids) if (sim.c(id)) sim.addRel(c.id, id, d); },
  relAlliance(sim: Sim, c: CountryState, alliance: string, d: number) {
    for (const o of Object.values(sim.s.countries)) if (o.id !== c.id && o.alliances.includes(alliance)) sim.addRel(c.id, o.id, d);
  },
  spawn(sim: Sim, c: CountryState, type: UnitType, n: number, near?: number) {
    const w = sim.world;
    for (let i = 0; i < n; i++) {
      if (type === 'navy') {
        const coast = (w.byCountry.get(c.id) ?? []).filter((p) => w.provinces[p].coastal && sim.s.prov.ctrl[p] === c.id);
        const base = w.provinces[coast[i % Math.max(1, coast.length)] ?? c.capital];
        const pos = sim.seaNear(base.lat, base.lon);
        if (pos) sim.spawnUnit(c.id, type, pos.lat, pos.lon);
        continue;
      }
      const base = w.provinces[near ?? c.capital];
      sim.spawnUnit(c.id, type, base.lat + (sim.rng() - 0.5) * 0.6, base.lon + (sim.rng() - 0.5) * 0.6);
    }
  },
  missiles(c: CountryState, type: MissileType, n: number) { c.missiles[type] += n; },
  tech(sim: Sim, c: CountryState, id: string) {
    if (c.researched.includes(id)) return;
    const t = TECH_BY_ID.get(id);
    if (!t) return;
    c.researched.push(id);
    for (const [k, v] of Object.entries(t.mods ?? {})) sim.addMod(c, k, v);
  },
  build(sim: Sim, c: CountryState, type: Parameters<typeof addBuilding>[2], n: number) {
    const provs = (sim.world.byCountry.get(c.id) ?? []).slice().sort((a, b) => sim.world.provinces[b].popShare - sim.world.provinces[a].popShare);
    for (let i = 0; i < n; i++) addBuilding(sim, provs[i % Math.min(5, provs.length)], type);
  },
  ideology(c: CountryState, axis: 0 | 1 | 2 | 3, d: number) { c.ideology[axis] = Math.max(-100, Math.min(100, c.ideology[axis] + d)); },
};

function addBuilding(sim: Sim, p: number, type: 'factory' | 'milfactory' | 'lab' | 'npp' | 'refinery' | 'bunker' | 'shipyard' | 'airbase') {
  const b = sim.s.prov.buildings[p];
  b[type] = Math.min(5, (b[type] ?? 0) + 1);
}

const NATO_EU = (sim: Sim) => Object.values(sim.s.countries).filter((o) => o.alliances.includes('NATO') || o.alliances.includes('EU')).map((o) => o.id);

// ---- generic tree ------------------------------------------------------------------------------
const GENERIC: Focus[] = [
  { id: 'g_econ', name: 'Экономические реформы', icon: '💹', days: 42, x: 0, y: 0, desc: '+0.5% к росту ВВП.', effect: (s, c) => s.addMod(c, 'gdp', 0.5) },
  { id: 'g_infra', name: 'Инфраструктура', icon: '🏗', days: 56, x: 0, y: 1, req: ['g_econ'], desc: '+2 гражданских завода в крупнейших городах.', effect: (s, c) => fx.build(s, c, 'factory', 2) },
  { id: 'g_hitech', name: 'Хай-тек кластер', icon: '🧪', days: 56, x: 0, y: 2, req: ['g_infra'], desc: '+1 НИИ, +10% очков исследований.', effect: (s, c) => { fx.build(s, c, 'lab', 1); s.addMod(c, 'rp', 0.1); } },
  { id: 'g_military', name: 'Модернизация армии', icon: '🎖', days: 42, x: 1, y: 0, desc: '+5% атаки сухопутных войск.', effect: (s, c) => s.addMod(c, 'atk_land', 0.05) },
  { id: 'g_milbudget', name: 'Рост оборонного заказа', icon: '🏭', days: 56, x: 1, y: 1, req: ['g_military'], desc: '+2 военных завода.', effect: (s, c) => fx.build(s, c, 'milfactory', 2) },
  { id: 'g_prof', name: 'Профессиональная армия', icon: '🪖', days: 70, x: 1, y: 2, req: ['g_milbudget'], excl: ['g_conscript'], desc: 'Опыт войск +, потери -10%.', effect: (s, c) => { s.addMod(c, 'losses', -0.1); for (const u of s.s.units) if (u.owner === c.id) u.xp = Math.min(1, u.xp + 0.2); } },
  { id: 'g_conscript', name: 'Всеобщий призыв', icon: '📜', days: 42, x: 2, y: 2, req: ['g_milbudget'], excl: ['g_prof'], desc: 'Мобилизационный резерв x2, -5 стабильности.', effect: (_s, c) => { c.manpower *= 2; c.mobilisation = Math.min(1, c.mobilisation + 0.2); c.stability -= 5; } },
  { id: 'g_west', name: 'Западный вектор', icon: '🧭', days: 49, x: 3, y: 0, excl: ['g_east', 'g_neutral'], desc: '+20 к отношениям со странами НАТО и ЕС.', effect: (s, c) => fx.rel(s, c, NATO_EU(s), 20) },
  { id: 'g_east', name: 'Восточный вектор', icon: '🧭', days: 49, x: 4, y: 0, excl: ['g_west', 'g_neutral'], desc: '+20 к отношениям со странами ШОС и БРИКС.', effect: (s, c) => { fx.relAlliance(s, c, 'SCO', 20); fx.relAlliance(s, c, 'BRICS', 20); } },
  { id: 'g_neutral', name: 'Нейтралитет', icon: '🕊', days: 49, x: 5, y: 0, excl: ['g_west', 'g_east'], desc: '+5 стабильности, +10 мирового мнения.', effect: (_s, c) => { c.stability += 5; c.opinion += 10; } },
  { id: 'g_anticorr', name: 'Борьба с коррупцией', icon: '⚖', days: 63, x: 3, y: 1, desc: '-10 коррупции.', effect: (_s, c) => { c.corruption = Math.max(0, c.corruption - 10); } },
  { id: 'g_reforms', name: 'Политические реформы', icon: '🗳', days: 56, x: 3, y: 2, req: ['g_anticorr'], excl: ['g_strong'], desc: 'Сдвиг к демократии, +10 мирового мнения, -3 стабильности.', effect: (_s, c) => { fx.ideology(c, 3, -15); c.opinion += 10; c.stability -= 3; c.pressFreedom += 10; } },
  { id: 'g_strong', name: 'Сильная рука', icon: '✊', days: 56, x: 4, y: 2, req: ['g_anticorr'], excl: ['g_reforms'], desc: 'Сдвиг к авторитаризму, +8 стабильности, -15 свободы прессы.', effect: (_s, c) => { fx.ideology(c, 3, 15); c.stability += 8; c.pressFreedom -= 15; } },
  { id: 'g_science', name: 'Наука прежде всего', icon: '🔬', days: 42, x: 5, y: 1, desc: '+0.5% ВВП на науку.', effect: (_s, c) => { c.researchShare = Math.min(0.06, c.researchShare + 0.005); } },
  { id: 'g_space', name: 'Космическая программа', icon: '🛰', days: 70, x: 5, y: 2, req: ['g_science'], desc: 'Открывает «Космос» и «Спутники».', effect: (s, c) => { fx.tech(s, c, 'space'); fx.tech(s, c, 'sat'); } },
];

const UKR: Focus[] = [
  { id: 'ukr_minsk_keep', name: 'Соблюдать Минские соглашения', icon: '📝', days: 35, x: 0, y: 0, excl: ['ukr_minsk_sabotage'], desc: '+5 стабильности, +15 отношений с Россией, автономия Донбасса.', effect: (s, c) => { c.stability += 5; fx.rel(s, c, ['643'], 15); } },
  { id: 'ukr_minsk_sabotage', name: 'Саботировать Минск', icon: '🛡', days: 35, x: 1, y: 0, excl: ['ukr_minsk_keep'], desc: 'Готовиться к войне: +2 бригады, +10 национализма, -15 отношений с РФ.', effect: (s, c) => { fx.spawn(s, c, 'infantry', 2); c.nationalism += 10; fx.rel(s, c, ['643'], -15); } },
  { id: 'ukr_west', name: 'Западный вектор', icon: '🇪🇺', days: 42, x: 2, y: 0, desc: '+15 отношений с НАТО и ЕС.', effect: (s, c) => fx.rel(s, c, NATO_EU(s), 15) },
  { id: 'ukr_nato', name: 'Заявка в НАТО', icon: '🛡', days: 70, x: 2, y: 1, req: ['ukr_west'], desc: 'Сближение с альянсом. Россия будет в ярости (-25).', effect: (s, c) => { fx.relAlliance(s, c, 'NATO', 15); fx.rel(s, c, ['643'], -25); s.s.tension += 6; c.flags.push('nato_applicant'); } },
  { id: 'ukr_eu', name: 'Заявка в ЕС', icon: '⭐', days: 56, x: 3, y: 1, req: ['ukr_west'], desc: '+0.5% к росту ВВП, +10 отношений с ЕС.', effect: (s, c) => { s.addMod(c, 'gdp', 0.5); fx.relAlliance(s, c, 'EU', 10); } },
  { id: 'ukr_arms', name: 'Закупка вооружений', icon: '🚀', days: 49, x: 4, y: 1, req: ['ukr_west'], desc: 'Javelin, NLAW, Bayraktar: +2 отряда БПЛА, +1 ПВО, +5% атаки.', effect: (s, c) => { fx.spawn(s, c, 'drones', 2); fx.spawn(s, c, 'airdef', 1); s.addMod(c, 'atk_land', 0.05); fx.tech(s, c, 'drone_strike'); } },
  { id: 'ukr_army', name: 'Реформа армии', icon: '🎖', days: 42, x: 5, y: 0, desc: '+5% атаки, +10 организации.', effect: (s, c) => { s.addMod(c, 'atk_land', 0.05); for (const u of s.s.units) if (u.owner === c.id) u.org = 100; } },
  { id: 'ukr_nato_std', name: 'Стандарты НАТО', icon: '📐', days: 56, x: 5, y: 1, req: ['ukr_army'], desc: 'Опыт войск +0.2, потери -10%.', effect: (s, c) => { s.addMod(c, 'losses', -0.1); for (const u of s.s.units) if (u.owner === c.id) u.xp = Math.min(1, u.xp + 0.2); } },
  { id: 'ukr_terdef', name: 'Территориальная оборона', icon: '🏘', days: 49, x: 6, y: 1, req: ['ukr_army'], desc: '+3 бригады ТрО, +10% к обороне своих провинций.', effect: (s, c) => { fx.spawn(s, c, 'infantry', 3); s.addMod(c, 'fort', 0.1); } },
  { id: 'ukr_vpk', name: 'Развитие ВПК («Нептун»)', icon: '🏭', days: 70, x: 7, y: 1, req: ['ukr_army'], desc: '+40 крылатых ракет, +1 военный завод.', effect: (s, c) => { fx.missiles(c, 'cruise', 40); fx.build(s, c, 'milfactory', 1); } },
  { id: 'ukr_internal', name: 'Внутренняя политика', icon: '🏛', days: 35, x: 8, y: 0, desc: '+3 стабильности.', effect: (_s, c) => { c.stability += 3; } },
  { id: 'ukr_oligarchs', name: 'Борьба с олигархами', icon: '⚖', days: 56, x: 8, y: 1, req: ['ukr_internal'], desc: '-8 коррупции.', effect: (_s, c) => { c.corruption -= 8; } },
  { id: 'ukr_decentr', name: 'Децентрализация', icon: '🗺', days: 49, x: 9, y: 1, req: ['ukr_internal'], desc: '+4 стабильности.', effect: (_s, c) => { c.stability += 4; } },
  { id: 'ukr_it', name: 'IT-сектор', icon: '💻', days: 56, x: 10, y: 1, req: ['ukr_internal'], desc: '+0.6% к росту ВВП, +10% исследований.', effect: (s, c) => { s.addMod(c, 'gdp', 0.6); s.addMod(c, 'rp', 0.1); } },
];

const RUS: Focus[] = [
  { id: 'rus_army', name: 'Модернизация армии', icon: '🎖', days: 42, x: 0, y: 0, desc: '+5% атаки сухопутных войск.', effect: (s, c) => s.addMod(c, 'atk_land', 0.05) },
  { id: 'rus_equip', name: 'Новые образцы техники', icon: '🛡', days: 63, x: 0, y: 1, req: ['rus_army'], desc: 'Армата, Курганец: +2 танковые бригады, +10% защиты брони.', effect: (s, c) => { fx.spawn(s, c, 'armor', 2); s.addMod(c, 'def_armor', 0.1); } },
  { id: 'rus_prof', name: 'Контрактная армия', icon: '🪖', days: 56, x: 1, y: 1, req: ['rus_army'], excl: ['rus_draft'], desc: 'Опыт войск +0.2.', effect: (s, c) => { for (const u of s.s.units) if (u.owner === c.id) u.xp = Math.min(1, u.xp + 0.2); } },
  { id: 'rus_draft', name: 'Опора на призыв', icon: '📜', days: 42, x: 2, y: 1, req: ['rus_army'], excl: ['rus_prof'], desc: 'Мобрезерв x1.8.', effect: (_s, c) => { c.manpower *= 1.8; } },
  { id: 'rus_hyper', name: 'Гиперзвуковое оружие', icon: '🚀', days: 70, x: 3, y: 1, req: ['rus_army'], desc: '+20 гиперзвуковых ракет «Кинжал».', effect: (s, c) => { fx.tech(s, c, 'mis_hyper'); fx.missiles(c, 'hypersonic', 20); } },
  { id: 'rus_energy', name: 'Энергетическая стратегия', icon: '⛽', days: 35, x: 4, y: 0, desc: '+0.2% ВВП.', effect: (s, c) => s.addMod(c, 'gdp', 0.2) },
  { id: 'rus_ns2', name: 'Северный поток — 2', icon: '🔧', days: 70, x: 4, y: 1, req: ['rus_energy'], desc: '+15 отношений с Германией, +0.4% ВВП.', effect: (s, c) => { fx.rel(s, c, ['276'], 15); s.addMod(c, 'gdp', 0.4); c.flags.push('ns2'); } },
  { id: 'rus_pivot', name: 'Поворот на Восток', icon: '🐉', days: 56, x: 5, y: 1, req: ['rus_energy'], desc: '+20 с Китаем, доступ к чёрному рынку при санкциях.', effect: (s, c) => { fx.rel(s, c, ['156', '356'], 20); c.flags.push('black_market'); } },
  { id: 'rus_npp', name: 'Ядерная энергетика', icon: '⚛', days: 63, x: 6, y: 1, req: ['rus_energy'], desc: '+1 АЭС.', effect: (s, c) => fx.build(s, c, 'npp', 1) },
  { id: 'rus_geo', name: 'Геополитика', icon: '🌐', days: 35, x: 7, y: 0, desc: '+5 национализма.', effect: (_s, c) => { c.nationalism += 5; } },
  { id: 'rus_minsk', name: 'Минские соглашения', icon: '📝', days: 42, x: 7, y: 1, req: ['rus_geo'], desc: '+10 отношений с Украиной, +3 стабильности.', effect: (s, c) => { fx.rel(s, c, ['804'], 10); c.stability += 3; } },
  { id: 'rus_union', name: 'Союзное государство', icon: '🤝', days: 70, x: 8, y: 1, req: ['rus_geo'], desc: '+20 отношений с Беларусью, общая оборона.', effect: (s, c) => { fx.rel(s, c, ['112'], 20); const b = s.c('112'); if (b && !b.alliances.includes('XUNION')) { b.alliances.push('XUNION'); c.alliances.push('XUNION'); s.invalidateAllies(); } } },
  { id: 'rus_africa', name: 'Влияние в Африке (ЧВК)', icon: '🌍', days: 56, x: 9, y: 1, req: ['rus_geo'], desc: '+30 с Мали, ЦАР, Ливией, Суданом; +2 отряда спецназа.', effect: (s, c) => { fx.rel(s, c, ['466', '140', '434', '729'], 30); fx.spawn(s, c, 'special', 2); } },
  { id: 'rus_syria', name: 'Сирийская операция', icon: '✈', days: 49, x: 10, y: 1, req: ['rus_geo'], desc: '+20 с Сирией, боевой опыт авиации.', effect: (s, c) => { fx.rel(s, c, ['760'], 20); for (const u of s.s.units) if (u.owner === c.id && u.type === 'air') u.xp = Math.min(1, u.xp + 0.3); } },
  { id: 'rus_internal', name: 'Внутренняя политика', icon: '🏛', days: 35, x: 11, y: 0, desc: '+3 стабильности.', effect: (_s, c) => { c.stability += 3; } },
  { id: 'rus_const', name: 'Конституционная реформа 2020', icon: '📕', days: 49, x: 11, y: 1, req: ['rus_internal'], desc: '+6 стабильности, сдвиг к авторитаризму.', effect: (_s, c) => { c.stability += 6; fx.ideology(c, 3, 10); } },
  { id: 'rus_druble', name: 'Цифровой рубль', icon: '₽', days: 56, x: 12, y: 1, req: ['rus_internal'], desc: 'Обход санкций: доступ к чёрному рынку.', effect: (_s, c) => { if (!c.flags.includes('black_market')) c.flags.push('black_market'); } },
  { id: 'rus_import', name: 'Импортозамещение', icon: '🏭', days: 70, x: 13, y: 1, req: ['rus_internal'], desc: '+0.2% ВВП, +1 военный завод.', effect: (s, c) => { s.addMod(c, 'gdp', 0.2); fx.build(s, c, 'milfactory', 1); } },
];

const USA: Focus[] = [
  { id: 'usa_army', name: 'Великая держава', icon: '🦅', days: 35, x: 0, y: 0, desc: '+5% атаки.', effect: (s, c) => s.addMod(c, 'atk_land', 0.05) },
  { id: 'usa_pacific', name: 'Разворот к Тихому океану', icon: '⚓', days: 70, x: 0, y: 1, req: ['usa_army'], desc: '+2 корабельные группы, +10 с Японией, Кореей, Австралией.', effect: (s, c) => { fx.spawn(s, c, 'navy', 2); fx.rel(s, c, ['392', '410', '036'], 10); } },
  { id: 'usa_nato', name: 'Укрепление НАТО', icon: '🛡', days: 56, x: 1, y: 1, req: ['usa_army'], desc: '+10 с НАТО, бригады в Польше.', effect: (s, c) => { fx.relAlliance(s, c, 'NATO', 10); const pl = s.c('616'); if (pl) fx.spawn(s, c, 'armor', 2, pl.capital); } },
  { id: 'usa_hyper', name: 'Гиперзвуковая гонка', icon: '🚀', days: 84, x: 2, y: 1, req: ['usa_army'], desc: 'Открывает гиперзвуковое оружие.', effect: (s, c) => { fx.tech(s, c, 'mis_hyper'); fx.missiles(c, 'hypersonic', 10); } },
  { id: 'usa_econ', name: 'Экономика прежде всего', icon: '💵', days: 35, x: 3, y: 0, desc: '+0.3% ВВП.', effect: (s, c) => s.addMod(c, 'gdp', 0.3) },
  { id: 'usa_chips', name: 'CHIPS Act', icon: '🔌', days: 70, x: 3, y: 1, req: ['usa_econ'], desc: '+2 завода, +10% исследований.', effect: (s, c) => { fx.build(s, c, 'factory', 2); s.addMod(c, 'rp', 0.1); } },
  { id: 'usa_tariffs', name: 'Торговая война с Китаем', icon: '📉', days: 49, x: 4, y: 1, req: ['usa_econ'], desc: '-20 с Китаем, Китай теряет 0.3% роста.', effect: (s, c) => { fx.rel(s, c, ['156'], -20); const ch = s.c('156'); if (ch) s.addMod(ch, 'gdp', -0.3); } },
  { id: 'usa_shale', name: 'Сланцевая революция', icon: '🛢', days: 56, x: 5, y: 1, req: ['usa_econ'], desc: '+1 НПЗ, нефтяная независимость.', effect: (s, c) => fx.build(s, c, 'refinery', 1) },
  { id: 'usa_unity', name: 'Национальное единство', icon: '🇺🇸', days: 49, x: 6, y: 0, desc: '+6 стабильности.', effect: (_s, c) => { c.stability += 6; } },
  { id: 'usa_artemis', name: 'Программа «Артемида»', icon: '🌙', days: 120, x: 6, y: 1, req: ['usa_unity'], desc: 'Космос, станция, +10 мнения.', effect: (s, c) => { fx.tech(s, c, 'space'); fx.tech(s, c, 'station'); c.opinion += 10; } },
];

const CHN: Focus[] = [
  { id: 'chn_army', name: 'Армия мирового класса', icon: '🐉', days: 42, x: 0, y: 0, desc: '+5% атаки.', effect: (s, c) => s.addMod(c, 'atk_land', 0.05) },
  { id: 'chn_navy', name: 'Флот открытого моря', icon: '⚓', days: 84, x: 0, y: 1, req: ['chn_army'], desc: '+3 корабельные группы.', effect: (s, c) => fx.spawn(s, c, 'navy', 3) },
  { id: 'chn_a2ad', name: 'Зона A2/AD', icon: '📡', days: 56, x: 1, y: 1, req: ['chn_army'], desc: '+2 ПВО, +10% радиуса ПВО.', effect: (s, c) => { fx.spawn(s, c, 'airdef', 2); s.addMod(c, 'ad_range', 0.1); } },
  { id: 'chn_taiwan', name: 'Подготовка операции «Тайвань»', icon: '🎯', days: 98, x: 2, y: 1, req: ['chn_navy'], desc: '+3 бригады морской пехоты, -20 с Тайванем.', effect: (s, c) => { fx.spawn(s, c, 'infantry', 3); fx.rel(s, c, ['158'], -20); c.flags.push('taiwan_ready'); } },
  { id: 'chn_econ', name: 'Новая эпоха', icon: '💹', days: 35, x: 3, y: 0, desc: '+0.3% ВВП.', effect: (s, c) => s.addMod(c, 'gdp', 0.3) },
  { id: 'chn_belt', name: 'Один пояс — один путь', icon: '🛤', days: 70, x: 3, y: 1, req: ['chn_econ'], desc: '+0.4% ВВП, +10 со странами Азии и Африки.', effect: (s, c) => { s.addMod(c, 'gdp', 0.4); fx.relAlliance(s, c, 'ASEAN', 10); fx.rel(s, c, ['404', '231', '024', '586', '398'], 15); } },
  { id: 'chn_dual', name: 'Двойная циркуляция', icon: '♻', days: 56, x: 4, y: 1, req: ['chn_econ'], desc: 'Устойчивость к санкциям.', effect: (_s, c) => { c.flags.push('black_market'); } },
  { id: 'chn_2025', name: 'Made in China 2025', icon: '🔬', days: 70, x: 5, y: 1, req: ['chn_econ'], desc: '+15% исследований, +1 НИИ.', effect: (s, c) => { s.addMod(c, 'rp', 0.15); fx.build(s, c, 'lab', 1); } },
  { id: 'chn_politics', name: 'Курс партии', icon: '☭', days: 35, x: 6, y: 0, desc: '+3 стабильности.', effect: (_s, c) => { c.stability += 3; } },
  { id: 'chn_credit', name: 'Социальный рейтинг', icon: '📊', days: 56, x: 6, y: 1, req: ['chn_politics'], desc: '+6 стабильности, -15 свободы прессы.', effect: (_s, c) => { c.stability += 6; c.pressFreedom -= 15; } },
  { id: 'chn_hk', name: 'Закон о нацбезопасности ГК', icon: '🏙', days: 42, x: 7, y: 1, req: ['chn_politics'], desc: '+3 стабильности, -10 мирового мнения.', effect: (_s, c) => { c.stability += 3; c.opinion -= 10; } },
];

const NATIONAL: Record<string, Focus[]> = { '804': UKR, '643': RUS, '840': USA, '156': CHN };
const ALL = new Map<string, Focus>([...GENERIC, ...UKR, ...RUS, ...USA, ...CHN].map((f) => [f.id, f]));

export const focusById = (id: string) => ALL.get(id);
export const focusTree = (country: string): Focus[] => NATIONAL[country] ?? GENERIC;

export function focusAvailable(c: CountryState, f: Focus): string | null {
  if (c.focusDone.includes(f.id)) return 'Завершён';
  if (f.req && !f.req.every((r) => c.focusDone.includes(r))) return 'Требуются предыдущие фокусы';
  if (f.excl && f.excl.some((e) => c.focusDone.includes(e) || c.focus?.id === e)) return 'Взаимоисключающий фокус выбран';
  return null;
}
