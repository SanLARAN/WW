import type { Sim } from '../game/sim';
import type { CountryState } from '../game/types';
import { fx } from './focus';

export interface EventOption {
  label: string;
  tip?: string;
  ai?: number | ((sim: Sim, c: CountryState) => number);
  effect: (sim: Sim, c: CountryState) => void;
}

export interface GameEvent {
  id: string;
  title: string;
  text: string;
  icon: string;
  /** historical trigger date YYYY-MM-DD */
  date?: string;
  who?: string[] | 'all';
  /** random: mean days between occurrences (per eligible country) */
  mtth?: number;
  cond?: (sim: Sim, c: CountryState) => boolean;
  once?: boolean;
  /** world event: applies once globally, shown to every player */
  world?: boolean;
  options: EventOption[];
}

const westBloc = (sim: Sim) => Object.values(sim.s.countries).filter((o) => o.alive && (o.alliances.includes('NATO') || o.alliances.includes('EU') || ['392', '036', '554', '410', '158', '756'].includes(o.id)));
const sanction = (sim: Sim, from: CountryState[], target: string) => { for (const o of from) if (o.id !== target && !o.sanctions.includes(target)) { o.sanctions.push(target); sim.addRel(o.id, target, -15); } };
const atWarWith = (sim: Sim, a: string, b: string) => sim.atWar(a, b);
const historical = (sim: Sim) => sim.s.settings.historical;

export const EVENTS: GameEvent[] = [
  // ------------------------------------------------------------------ 2020
  {
    id: 'soleimani', date: '2020-01-03', who: ['364'], icon: '🎯', title: 'Убийство Касема Сулеймани',
    text: 'Американский беспилотник MQ-9 Reaper ликвидировал генерала КСИР Касема Сулеймани в аэропорту Багдада. Страна требует возмездия.',
    options: [
      { label: 'Ракетный удар по базе Айн-эль-Асад', tip: '-10 отношений с США, +10 национализма, напряжённость растёт', ai: 0.8, effect: (s, c) => {
        for (let i = 0; i < 6; i++) s.launch(c.id, 'ballistic', { lat: 33.8 + (s.rng() - 0.5) * 0.1, lon: 42.44 + (s.rng() - 0.5) * 0.1 });
        s.addRel(c.id, '840', -10); c.nationalism += 10; s.s.tension += 8;
      } },
      { label: 'Проявить сдержанность', tip: '-6 стабильности', ai: 0.2, effect: (_s, c) => { c.stability -= 6; } },
    ],
  },
  {
    id: 'covid', date: '2020-03-11', who: 'all', icon: '🦠', title: 'Пандемия COVID-19',
    text: 'ВОЗ объявила пандемию нового коронавируса. Больницы переполнены, экономики останавливаются. Как ответит правительство?',
    options: [
      { label: 'Жёсткий карантин', tip: 'Сильный удар по ВВП, меньше жертв, -4 стабильности', ai: (_s, c) => (c.ideology[3] > 40 ? 3 : 1), effect: (s, c) => { c.quarantine = 'hard'; c.stability -= 4; s.addMod(c, 'tmp_covid_gdp', -2); } },
      { label: 'Мягкие ограничения', tip: 'Умеренный удар по ВВП', ai: 2, effect: (s, c) => { c.quarantine = 'soft'; s.addMod(c, 'tmp_covid_gdp', -2.5); c.pop *= 0.999; } },
      { label: 'Игнорировать', tip: 'Экономика работает, но -10 стабильности и рост смертности', ai: 0.4, effect: (s, c) => { s.addMod(c, 'tmp_covid_gdp', -1); c.stability -= 10; c.pop *= 0.997; } },
    ],
  },
  {
    id: 'belarus_protests', date: '2020-08-09', who: ['112'], icon: '✊', title: 'Протесты в Беларуси',
    text: 'После президентских выборов сотни тысяч людей вышли на улицы Минска. Оппозиция заявляет о фальсификациях.',
    options: [
      { label: 'Подавить протесты', tip: '+5 стабильности, санкции Запада, +10 с Россией', ai: 0.85, effect: (s, c) => { c.stability += 5; c.pressFreedom -= 15; c.opinion -= 20; sanction(s, westBloc(s), c.id); s.addRel(c.id, '643', 10); } },
      { label: 'Диалог с оппозицией', tip: '-10 стабильности, сдвиг к демократии, +15 с ЕС, -20 с Россией', ai: 0.15, effect: (s, c) => { c.stability -= 10; fx.ideology(c, 3, -25); fx.relAlliance(s, c, 'EU', 15); s.addRel(c.id, '643', -20); } },
    ],
  },
  {
    id: 'karabakh', date: '2020-09-27', who: ['031'], icon: '⚔', title: 'Нагорный Карабах',
    text: 'На линии соприкосновения снова стреляют. Турция обещает поддержку, ударные дроны Bayraktar TB2 готовы. Начать операцию по возвращению территорий?',
    cond: (s, c) => !atWarWith(s, c.id, '051'),
    options: [
      { label: 'Начать операцию «Железный кулак»', tip: 'Война с Арменией, +3 отряда БПЛА от Турции', ai: 0.9, effect: (s, c) => { fx.spawn(s, c, 'drones', 3); fx.tech(s, c, 'drone_strike'); s.declareWar(c.id, '051', 'claims'); } },
      { label: 'Сохранить статус-кво', tip: '-5 стабильности', ai: 0.1, effect: (_s, c) => { c.stability -= 5; } },
    ],
  },
  {
    id: 'us_election_2020', date: '2020-11-03', who: ['840'], icon: '🗳', title: 'Выборы президента США',
    text: 'Самые напряжённые выборы в истории страны. Подсчёт голосов идёт несколько дней.',
    options: [
      { label: 'Победа Джо Байдена', tip: 'Курс на союзников: +10 с ЕС и НАТО', ai: 0.8, effect: (s, c) => { c.leader = 'Джо Байден'; fx.ideology(c, 2, -25); fx.relAlliance(s, c, 'NATO', 10); } },
      { label: 'Победа Дональда Трампа', tip: 'America First: +10 национализма, -5 с ЕС', ai: 0.2, effect: (s, c) => { fx.ideology(c, 2, 20); c.nationalism += 10; fx.relAlliance(s, c, 'EU', -5); } },
    ],
  },
  {
    id: 'tigray', date: '2020-11-04', who: ['231'], icon: '🔥', title: 'Кризис в Тыграе',
    text: 'Силы Народного фронта освобождения Тыграя атаковали базу федеральной армии.',
    options: [
      { label: 'Военная операция', tip: '-8 стабильности, +10 военной усталости', ai: 0.8, effect: (_s, c) => { c.stability -= 8; c.warExhaustion += 10; } },
      { label: 'Переговоры', tip: '-4 стабильности, +5 мирового мнения', ai: 0.2, effect: (_s, c) => { c.stability -= 4; c.opinion += 5; } },
    ],
  },
  {
    id: 'vaccines', date: '2020-12-08', who: 'all', icon: '💉', title: 'Вакцины от COVID-19',
    text: 'Первые вакцины одобрены. Начинается глобальная гонка за дозами.',
    options: [
      { label: 'Массовая вакцинация', tip: 'Снять карантин. Стоит $0.5 млрд на 10 млн жителей', ai: 3, effect: (s, c) => { c.budget -= c.pop * 0.05; c.quarantine = 'none'; delete c.modifiers.tmp_covid_gdp; fx.tech(s, c, 'bio'); } },
      { label: 'Ограничения ещё на полгода', tip: 'Ничего не тратим', ai: 0.3, effect: (_s, c) => { c.quarantine = c.quarantine === 'hard' ? 'soft' : c.quarantine; } },
    ],
  },
  // ------------------------------------------------------------------ 2021
  {
    id: 'afghan', date: '2021-08-15', who: ['840'], icon: '🚁', title: 'Вывод войск из Афганистана',
    text: 'Талибы стремительно наступают на Кабул. Правительство Ашрафа Гани на грани падения.',
    options: [
      { label: 'Завершить вывод', tip: '-10 мирового мнения, Афганистан переходит к талибам', ai: 0.9, effect: (s, c) => { c.opinion -= 10; c.stability -= 3; const af = s.c('004'); if (af) { af.leader = 'Талибан'; af.ideology = [0, 100, 90, 100]; af.alliances = []; s.setRel('004', '840', -70); } } },
      { label: 'Остаться', tip: '-$30 млрд, +5 военной усталости', ai: 0.1, effect: (_s, c) => { c.budget -= 30; c.warExhaustion += 5; } },
    ],
  },
  {
    id: 'aukus', date: '2021-09-15', who: ['036'], icon: '⚓', title: 'AUKUS',
    text: 'США и Великобритания предлагают Австралии атомные подводные лодки. Франция в ярости из-за сорванного контракта.',
    options: [
      { label: 'Подписать договор', tip: '+1 корабельная группа, -15 с Францией', ai: 1, effect: (s, c) => { fx.spawn(s, c, 'navy', 1); s.addRel(c.id, '250', -15); s.addRel(c.id, '840', 10); } },
      { label: 'Остаться с Францией', tip: '+10 с Францией', ai: 0, effect: (s, c) => { s.addRel(c.id, '250', 10); } },
    ],
  },
  {
    id: 'energy_crisis', date: '2021-10-01', who: ['276', '250', '380', '724', '616', '528', '056', '040', '203', '348'], icon: '🔥', title: 'Энергетический кризис в Европе',
    text: 'Цены на газ выросли в пять раз. Промышленность сокращает выпуск, счета граждан растут.',
    options: [
      { label: 'Субсидировать население', tip: '-$ бюджет, +2 стабильности', ai: 1, effect: (_s, c) => { c.budget -= c.gdp * 0.004; c.stability += 2; } },
      { label: 'Пусть рынок решает', tip: '-5 стабильности, ВВП страдает', ai: 0.5, effect: (s, c) => { c.stability -= 5; s.addMod(c, 'tmp_gdp', -1.5); } },
    ],
  },
  {
    id: 'buildup', date: '2021-11-01', who: ['643'], icon: '🛰', title: 'Войска у границ Украины',
    text: 'Генштаб предлагает сосредоточить группировку у границ Украины для давления на Запад.',
    options: [
      { label: 'Наращивать группировку', tip: '+4 бригады у границы, напряжённость +15, -10 с НАТО', ai: (s) => (historical(s) ? 10 : 0.6), effect: (s, c) => {
        const ua = s.c('804');
        const border = (s.world.byCountry.get('643') ?? []).filter((p) => s.world.provinces[p].neighbors.some((n) => s.s.prov.owner[n] === '804'));
        for (let i = 0; i < 6; i++) fx.spawn(s, c, i % 3 === 0 ? 'armor' : 'infantry', 1, border[i % Math.max(1, border.length)] ?? c.capital);
        s.s.tension += 15; fx.relAlliance(s, c, 'NATO', -10); if (ua) s.addRel(c.id, ua.id, -15);
      } },
      { label: 'Отвести войска', tip: '-5 национализма, напряжённость -5', ai: 0.4, effect: (s, c) => { c.nationalism -= 5; s.s.tension -= 5; } },
    ],
  },
  // ------------------------------------------------------------------ 2022
  {
    id: 'feb24', date: '2022-02-24', who: ['643'], icon: '⚡', title: '24 февраля',
    text: 'Всё готово. Генштаб ждёт приказа. Решение изменит историю — в любую сторону.',
    cond: (s, c) => !atWarWith(s, c.id, '804') && !!s.c('804')?.alive,
    options: [
      { label: 'Начать специальную военную операцию', tip: 'Война с Украиной. Масштабные санкции Запада', ai: (s, c) => (historical(s) ? 10 : c.aggression * 1.5), effect: (s, c) => {
        s.declareWar(c.id, '804', 'protect');
        sanction(s, westBloc(s), c.id); c.opinion -= 40; s.s.oilPrice = 110;
      } },
      { label: 'Отказаться от вторжения', tip: 'Альтернативная история: -5 стабильности, напряжённость -15', ai: (s, c) => (historical(s) ? 0 : 1 - c.aggression), effect: (s, c) => { c.stability -= 5; s.s.tension -= 15; s.addRel(c.id, '804', 10); c.flags.push('no_svo'); } },
    ],
  },
  {
    id: 'invasion', who: ['804'], icon: '🚨', title: 'Вторжение!',
    text: 'В 5 утра ракеты ударили по аэродромам и складам. Колонны пересекают границу с севера, востока и юга.',
    cond: (s, c) => atWarWith(s, c.id, '643') && !c.flags.includes('invasion_fired'), mtth: 1,
    options: [
      { label: 'Всеобщая мобилизация', tip: '+5 бригад, +30 национализма, +10 стабильности (сплочение)', ai: 1, effect: (s, c) => { c.flags.push('invasion_fired'); fx.spawn(s, c, 'infantry', 5); c.mobilisation = 0.8; c.manpower += c.pop * 20; c.nationalism += 30; c.stability += 10; for (const o of westBloc(s)) if (!o.player) { s.addRel(o.id, c.id, 20); } } },
      { label: 'Просить переговоров', tip: '-10 стабильности', ai: 0, effect: (_s, c) => { c.flags.push('invasion_fired'); c.stability -= 10; } },
    ],
  },
  {
    id: 'west_aid', who: ['840', '826', '276', '616', '250'], icon: '📦', title: 'Помощь Украине',
    text: 'Украина просит оружие: ПВО, артиллерию, боеприпасы. Решение за вами.',
    cond: (s, c) => atWarWith(s, '643', '804') && !c.flags.includes('aid_ukr') && !atWarWith(s, c.id, '804'), mtth: 5,
    options: [
      { label: 'Масштабная военная помощь', tip: 'Украина получает ПВО и артиллерию, -$ бюджет, -20 с Россией', ai: 0.9, effect: (s, c) => { c.flags.push('aid_ukr'); const ua = s.c('804')!; fx.spawn(s, ua, 'airdef', 1); fx.spawn(s, ua, 'artillery', c.id === '840' ? 2 : 1); ua.budget += c.gdp * 0.0015; c.budget -= c.gdp * 0.0015; s.addRel(c.id, '643', -20); s.addRel(c.id, '804', 20); } },
      { label: 'Только гуманитарная помощь', tip: '+5 с Украиной', ai: 0.1, effect: (s, c) => { c.flags.push('aid_ukr'); s.addRel(c.id, '804', 5); } },
    ],
  },
  {
    id: 'mobilisation_rus', date: '2022-09-21', who: ['643'], icon: '📜', title: 'Частичная мобилизация',
    text: 'Фронт требует людей. Минобороны предлагает призвать 300 тысяч резервистов.',
    cond: (s, c) => s.inWar(c.id),
    options: [
      { label: 'Объявить мобилизацию', tip: '+6 бригад, -8 стабильности', ai: 1, effect: (s, c) => { fx.spawn(s, c, 'infantry', 6); c.mobilisation += 0.2; c.stability -= 8; } },
      { label: 'Обойтись контрактниками', tip: '-$5 млрд на выплаты', ai: 0.3, effect: (_s, c) => { c.budget -= 5; } },
    ],
  },
  {
    id: 'nordstream', date: '2022-09-26', who: ['276'], icon: '💥', title: 'Диверсия на «Северных потоках»',
    text: 'Взрывы на дне Балтийского моря уничтожили газопроводы. Кто виноват — неизвестно.',
    options: [{ label: 'Начать расследование', tip: 'Газ подорожает', ai: 1, effect: (s, c) => { s.addMod(c, 'tmp_gdp', -0.8); const r = s.c('643'); if (r) r.flags = r.flags.filter((f) => f !== 'ns2'); } }],
  },
  {
    id: 'grain_deal', date: '2022-07-22', who: ['792'], icon: '🌾', title: 'Зерновая сделка',
    text: 'Турция может стать посредником в вывозе украинского зерна через Чёрное море.',
    cond: (s) => atWarWith(s, '643', '804'),
    options: [
      { label: 'Выступить посредником', tip: '+10 мирового мнения, +10 с обеими сторонами', ai: 1, effect: (s, c) => { c.opinion += 10; s.addRel(c.id, '643', 10); s.addRel(c.id, '804', 10); } },
      { label: 'Не вмешиваться', ai: 0, effect: () => undefined },
    ],
  },
  // ------------------------------------------------------------------ 2023
  {
    id: 'prigozhin', date: '2023-06-23', who: ['643'], icon: '🚚', title: 'Мятеж ЧВК',
    text: 'Колонны частной военной компании движутся на Москву. Ростов уже под их контролем.',
    cond: (s, c) => s.inWar(c.id),
    options: [
      { label: 'Переговоры через Минск', tip: '-6 стабильности', ai: 0.8, effect: (_s, c) => { c.stability -= 6; } },
      { label: 'Подавить силой', tip: '-2 бригады, -10 стабильности, затем +5 силовикам', ai: 0.2, effect: (s, c) => { const us = s.s.units.filter((u) => u.owner === c.id && u.type === 'infantry').slice(0, 2); for (const u of us) s.removeUnit(u); c.stability -= 10; } },
    ],
  },
  {
    id: 'brics', date: '2023-08-24', who: ['156'], icon: '🌐', title: 'Расширение БРИКС',
    text: 'На саммите в Йоханнесбурге приглашены Иран, Египет, Эфиопия, ОАЭ и Саудовская Аравия.',
    options: [{ label: 'Поддержать расширение', ai: 1, effect: (s) => { for (const id of ['364', '818', '231', '784', '682']) { const o = s.c(id); if (o && !o.alliances.includes('BRICS')) o.alliances.push('BRICS'); } } }],
  },
  {
    id: 'oct7', date: '2023-10-07', who: ['376'], icon: '🚨', title: '7 октября',
    text: 'Боевики ХАМАС прорвали границу сектора Газа. Сотни погибших. Страна в шоке.',
    cond: (s, c) => !!s.c('275')?.alive && !atWarWith(s, c.id, '275'),
    options: [
      { label: 'Операция «Железные мечи»', tip: 'Война с Палестиной, -25 мирового мнения', ai: 0.95, effect: (s, c) => { s.declareWar(c.id, '275', 'terror'); c.opinion -= 15; c.nationalism += 20; } },
      { label: 'Ограниченный ответ', tip: '-10 стабильности', ai: 0.05, effect: (_s, c) => { c.stability -= 10; } },
    ],
  },
  // ------------------------------------------------------------------ 2024
  {
    id: 'us_election_2024', date: '2024-11-05', who: ['840'], icon: '🗳', title: 'Выборы 2024',
    text: 'Америка снова выбирает. Мир затаил дыхание.',
    options: [
      { label: 'Победа Дональда Трампа', tip: 'Изоляционизм: -10 с ЕС, +15 национализма', ai: 0.6, effect: (s, c) => { c.leader = 'Дональд Трамп'; fx.ideology(c, 2, 30); c.nationalism += 15; fx.relAlliance(s, c, 'EU', -10); } },
      { label: 'Победа Камалы Харрис', tip: 'Преемственность курса', ai: 0.4, effect: (s, c) => { c.leader = 'Камала Харрис'; fx.relAlliance(s, c, 'NATO', 5); } },
    ],
  },
  // ------------------------------------------------------------------ alternative history (random)
  {
    id: 'taiwan_op', who: ['156'], icon: '🎯', title: 'Операция против Тайваня', mtth: 400, once: true,
    text: 'Флот и десантные силы готовы. Политбюро должно принять решение о воссоединении силой.',
    cond: (s, c) => s.s.tick > 24 * 365 * 2 && (c.flags.includes('taiwan_ready') || s.s.tension > 60) && !!s.c('158')?.alive && !s.s.settings.historical,
    options: [
      { label: 'Начать операцию', tip: 'Война с Тайванем. США может вмешаться', ai: (_s, c) => c.aggression, effect: (s, c) => { s.declareWar(c.id, '158', 'claims'); sanction(s, westBloc(s), c.id); } },
      { label: 'Ждать', ai: 1, effect: (s) => { s.s.tension -= 5; } },
    ],
  },
  {
    id: 'iran_bomb', who: ['364'], icon: '☢', title: 'Иранская бомба', mtth: 600, once: true,
    text: 'Учёные докладывают: обогащения урана достаточно для создания боеприпаса.',
    cond: (s, c) => s.s.tick > 24 * 365 * 2 && c.nukes === 0 && !s.s.settings.historical,
    options: [
      { label: 'Провести испытание', tip: '+5 боеголовок, +2 МБР, санкции, напряжённость +20', ai: 0.4, effect: (s, c) => { c.nukes += 5; c.missiles.icbm += 2; fx.tech(s, c, 'nuke_tac'); fx.tech(s, c, 'nuke_strat'); sanction(s, westBloc(s), c.id); s.s.tension += 20; s.addRel(c.id, '376', -30); } },
      { label: 'Сохранить пороговый статус', ai: 0.6, effect: (_s, c) => { c.stability += 2; } },
    ],
  },
  {
    id: 'arab_spring', who: ['818', '788', '434', '760', '887', '012', '504', '400', '368'], icon: '🔥', title: 'Новая арабская весна', mtth: 900,
    text: 'Цены на хлеб растут, молодёжь выходит на площади. Режим под угрозой.',
    cond: (_s, c) => c.stability < 40,
    options: [
      { label: 'Разогнать протестующих', tip: '+5 стабильности, -15 мирового мнения', ai: 0.6, effect: (_s, c) => { c.stability += 5; c.opinion -= 15; } },
      { label: 'Уступить и провести выборы', tip: 'Смена власти, -10 стабильности, сдвиг к демократии', ai: 0.4, effect: (_s, c) => { c.stability -= 10; fx.ideology(c, 3, -30); c.leader = 'Переходное правительство'; } },
    ],
  },
  // ------------------------------------------------------------------ domestic random
  {
    id: 'corruption', icon: '💰', title: 'Коррупционный скандал', mtth: 500, who: 'all',
    text: 'Журналисты опубликовали расследование о миллиардах на счетах чиновников.',
    cond: (_s, c) => c.corruption > 40,
    options: [
      { label: 'Громкое расследование', tip: '-5 коррупции, -3 стабильности', ai: 1, effect: (_s, c) => { c.corruption -= 5; c.stability -= 3; } },
      { label: 'Замять дело', tip: '+3 коррупции, -5 свободы прессы', ai: 1, effect: (_s, c) => { c.corruption += 3; c.pressFreedom -= 5; } },
    ],
  },
  {
    id: 'protests', icon: '📢', title: 'Массовые протесты', mtth: 200, who: 'all',
    text: 'Тысячи людей на улицах столицы требуют отставки правительства.',
    cond: (_s, c) => c.stability < 35,
    options: [
      { label: 'Уступки протестующим', tip: '+4 стабильности, -$ бюджет', ai: 1, effect: (_s, c) => { c.stability += 4; c.budget -= c.gdp * 0.002; } },
      { label: 'Жёсткий разгон', tip: '+2 стабильности, -10 мнения, -10 прессы', ai: 1, effect: (_s, c) => { c.stability += 2; c.opinion -= 10; c.pressFreedom -= 10; } },
    ],
  },
  {
    id: 'disaster', icon: '🌪', title: 'Стихийное бедствие', mtth: 1400, who: 'all',
    text: 'Наводнения и ураганы разрушили дороги и дома. Тысячи людей остались без крова.',
    options: [
      { label: 'Масштабная помощь', tip: '-$ бюджет, +3 стабильности', ai: 1, effect: (_s, c) => { c.budget -= c.gdp * 0.003; c.stability += 3; } },
      { label: 'Минимальная помощь', tip: '-5 стабильности', ai: 0.5, effect: (_s, c) => { c.stability -= 5; } },
    ],
  },
  {
    id: 'terror', icon: '💣', title: 'Теракт', mtth: 1600, who: 'all',
    text: 'Взрыв в метро в час пик. Страна в трауре.',
    options: [
      { label: 'Усилить безопасность', tip: '+3 стабильности, -5 свободы прессы', ai: 1, effect: (_s, c) => { c.stability += 3; c.pressFreedom -= 5; c.nationalism += 3; } },
      { label: 'Сохранить свободы', tip: '-4 стабильности, +5 мнения', ai: 0.5, effect: (_s, c) => { c.stability -= 4; c.opinion += 5; } },
    ],
  },
  {
    id: 'leak', icon: '📂', title: 'Утечка секретных данных', mtth: 1800, who: 'all',
    text: 'Секретные документы о военных планах появились в мессенджерах.',
    options: [
      { label: 'Найти виновных', tip: '-3 стабильности', ai: 1, effect: (_s, c) => { c.stability -= 3; } },
      { label: 'Назвать фейком', tip: '-5 мирового мнения', ai: 1, effect: (_s, c) => { c.opinion -= 5; } },
    ],
  },
  {
    id: 'mutiny', icon: '🪖', title: 'Военный мятеж', mtth: 300, who: 'all',
    text: 'Недовольные командиры выводят войска на улицы столицы.',
    cond: (_s, c) => (c.factions['Силовики'] ?? 50) < 25 && c.stability < 35,
    options: [
      { label: 'Пойти на уступки военным', tip: '-$ бюджет, +силовики', ai: 1, effect: (_s, c) => { c.budget -= c.gdp * 0.004; c.milShare += 0.005; } },
      { label: 'Арестовать заговорщиков', tip: '-1 бригада, -8 стабильности', ai: 0.5, effect: (s, c) => { const u = s.s.units.find((x) => x.owner === c.id && x.type === 'infantry'); if (u) s.removeUnit(u); c.stability -= 8; } },
    ],
  },
  {
    id: 'assassination', icon: '🔫', title: 'Покушение на лидера', mtth: 2500, who: 'all',
    text: (`Охрана предотвратила покушение в последний момент. Нация потрясена.`),
    cond: (_s, c) => c.stability < 30,
    options: [{ label: 'Ответить жёстко', tip: '+5 национализма, +3 стабильности', ai: 1, effect: (_s, c) => { c.nationalism += 5; c.stability += 3; } }],
  },
  {
    id: 'econ_crisis', icon: '📉', title: 'Экономический кризис', mtth: 300, who: 'all',
    text: 'Банки закрывают кредитные линии, бизнес массово увольняет сотрудников.',
    cond: (_s, c) => c.gdpGrowth < -1,
    options: [
      { label: 'Пакет стимулов', tip: '-$ бюджет, рост ВВП +1% на время', ai: 1, effect: (s, c) => { c.budget -= c.gdp * 0.01; s.addMod(c, 'tmp_gdp', 1.5); } },
      { label: 'Жёсткая экономия', tip: '-5 стабильности', ai: 0.5, effect: (_s, c) => { c.stability -= 5; c.debt *= 0.97; } },
    ],
  },
  // ------------------------------------------------------------------ world events
  {
    id: 'oil_shock', world: true, mtth: 900, icon: '🛢', title: 'Нефтяной шок', text: 'Атака на танкеры в Ормузском проливе. Нефть дорожает до $120.',
    options: [{ label: 'Понятно', effect: (s) => { s.s.oilPrice = 120; } }],
  },
  {
    id: 'fin_crisis', world: true, mtth: 1800, icon: '🏦', title: 'Мировой финансовый кризис', text: 'Обвал фондовых рынков. Все экономики теряют 2–4% ВВП.',
    options: [{ label: 'Понятно', effect: (s) => { for (const c of Object.values(s.s.countries)) { c.gdp *= 0.97; c.stability -= 2; } } }],
  },
  {
    id: 'cyber_global', world: true, mtth: 1200, icon: '💻', title: 'Глобальная кибератака', text: 'Неизвестные хакеры отключили энергосети в нескольких странах.',
    options: [{ label: 'Понятно', effect: (s) => { const list = Object.values(s.s.countries).filter((c) => c.gdp > 500 && !c.researched.includes('quantum')); const v = list[Math.floor(s.rng() * list.length)]; if (v) { v.gdp *= 0.99; v.stability -= 3; s.log(`💻 Блэкаут: ${v.name}`, 'alert', v.id); } } }],
  },
  {
    id: 'breakthrough', world: true, mtth: 1000, icon: '💡', title: 'Технологический прорыв', text: 'Учёные одной из стран совершили прорыв.',
    options: [{ label: 'Понятно', effect: (s) => { const list = Object.values(s.s.countries).filter((c) => c.research); const v = list[Math.floor(s.rng() * list.length)]; if (v?.research) { v.research.progress += 400; s.log(`💡 Прорыв: ${v.name}`, 'info', v.id); } } }],
  },
  {
    id: 'volcano', world: true, mtth: 3000, icon: '🌋', title: 'Извержение супервулкана', text: 'Пепел закрыл солнце над половиной полушария. Урожаи под угрозой.',
    options: [{ label: 'Понятно', effect: (s) => { for (const c of Object.values(s.s.countries)) { c.stock.food -= 30; c.gdp *= 0.995; } } }],
  },
  {
    id: 'meteor', world: true, mtth: 5000, icon: '☄', title: 'Метеоритная угроза', text: 'К Земле летит астероид. Человечество впервые объединяется перед общей угрозой.',
    options: [{ label: 'Понятно', effect: (s) => { s.s.tension = Math.max(0, s.s.tension - 25); for (const k of Object.keys(s.s.relations)) s.s.relations[k] = Math.min(100, s.s.relations[k] + 5); } }],
  },
  {
    id: 'migration', world: true, mtth: 1500, icon: '🚶', title: 'Миграционный кризис', text: 'Сотни тысяч беженцев у границ Европы.',
    options: [{ label: 'Понятно', effect: (s) => { for (const c of Object.values(s.s.countries)) if (c.alliances.includes('EU')) c.stability -= 3; } }],
  },
  {
    id: 'scandal', world: true, mtth: 700, icon: '🗞', title: 'Международный скандал', text: 'Дипломатическая переписка утекла в прессу. Две страны отзывают послов.',
    options: [{ label: 'Понятно', effect: (s) => { const ids = Object.keys(s.s.countries).filter((id) => s.s.countries[id].gdp > 200); const a = ids[Math.floor(s.rng() * ids.length)], b = ids[Math.floor(s.rng() * ids.length)]; if (a && b && a !== b) { s.addRel(a, b, -20); s.log(`🗞 Скандал: ${s.c(a)!.name} и ${s.c(b)!.name} отзывают послов`, 'diplo'); } } }],
  },
];

export const EVENT_BY_ID = new Map(EVENTS.map((e) => [e.id, e]));
