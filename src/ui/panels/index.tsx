import type { ComponentChildren } from 'preact';
import { ctl, type Panel } from '../../client/controller';
import { audio } from '../../audio/audio';
import { ALLIANCE_INFO } from '../../data/countries';
import { RESOURCE_INFO, type ResourceKey } from '../../data/resources';
import { PRICE, sanctionPenalty, upkeep, dailyIncome } from '../../game/domestic';
import { dateOf } from '../../game/types';
import { money, num, people, pct, fmtDate, click } from '../util';
import { ProductionPanel, ArmyPanel, MissilesPanel } from './military';
import { ResearchPanel, FocusPanel } from './science';
import { DiplomacyPanel } from './diplomacy';
import { SettingsBody } from './settings';

const TITLES: Record<Exclude<Panel, null>, string> = {
  overview: 'Обзор страны', economy: 'Экономика', production: 'Производство', research: 'Технологии', focus: 'Национальные фокусы',
  diplomacy: 'Дипломатия', army: 'Вооружённые силы', missiles: 'Ракетные войска', politics: 'Внутренняя политика', log: 'Журнал событий', settings: 'Настройки',
};

export function PanelHost({ panel }: { panel: Exclude<Panel, null> }) {
  const wide = panel === 'research' || panel === 'focus';
  const body: Record<Exclude<Panel, null>, () => ComponentChildren> = {
    overview: () => <Overview />, economy: () => <Economy />, production: () => <ProductionPanel />, research: () => <ResearchPanel />,
    focus: () => <FocusPanel />, diplomacy: () => <DiplomacyPanel />, army: () => <ArmyPanel />, missiles: () => <MissilesPanel />,
    politics: () => <Politics />, log: () => <Log />, settings: () => <SettingsBody inGame />,
  };
  return (
    <section class={`panel main-panel${wide ? ' wide' : ''}`} aria-label={TITLES[panel]}>
      <div class="panel-head">
        <h2 class="panel-title">{TITLES[panel]}</h2>
        <button class="btn sm ghost" aria-label="Закрыть" onClick={() => { audio.ui('close'); ctl.panel = null; ctl.bump(); }}>✕</button>
      </div>
      <div class="panel-body" style={{ flex: 1 }}>{body[panel]()}</div>
    </section>
  );
}

export function Axes({ v }: { v: [number, number, number, number] }) {
  const names: [string, string][] = [['Левая', 'Правая'], ['Прогрессивное', 'Консервативное'], ['Глобализм', 'Национализм'], ['Демократия', 'Авторитаризм']];
  return (
    <div class="col" style={{ gap: 10 }}>
      {names.map(([a, b], i) => (
        <div class="axis" key={i}><span>{a}</span><div class="track"><i style={{ left: `${(v[i] + 100) / 2}%` }} /></div><span>{b}</span></div>
      ))}
    </div>
  );
}

function Overview() {
  const sim = ctl.sim!, c = ctl.country!;
  const wars = sim.s.wars.filter((w) => sim.sideOf(w, c.id));
  return (
    <div class="col" style={{ gap: 0 }}>
      <div class="section">
        <div class="row"><span class="swatch" style={{ background: c.color, width: 24, height: 16 }} /><h2 class="big-name" style={{ fontSize: 24 }}>{c.name}</h2></div>
        <div class="muted small" style={{ marginTop: 4 }}>{c.leader} · столица {ctl.world.provinces[c.capital].name}</div>
      </div>
      <div class="section grid3">
        <div class="stat"><b>{money(c.gdp)}</b><span>ВВП · {pct(c.gdpGrowth, 1)}</span></div>
        <div class="stat"><b>{people(c.pop)}</b><span>Население</span></div>
        <div class="stat"><b>{money(c.budget)}</b><span>Казна</span></div>
        <div class="stat"><b>{c.stability.toFixed(0)}</b><span>Стабильность</span></div>
        <div class="stat"><b>{c.approval.toFixed(0)}</b><span>Одобрение</span></div>
        <div class="stat"><b>{c.opinion.toFixed(0)}</b><span>Мировое мнение</span></div>
        <div class="stat"><b>{c.tech.toFixed(1)}</b><span>Техуровень</span></div>
        <div class="stat"><b>{c.nukes}</b><span>Ядерные БЧ</span></div>
        <div class="stat"><b>{sim.s.units.filter((u) => u.owner === c.id).length}</b><span>Соединений</span></div>
      </div>
      <div class="section">
        <h3 class="sub">Блоки и союзы</h3>
        <div class="row wrap">{c.alliances.length ? c.alliances.map((a) => <span class="chip" key={a} style={{ borderColor: ALLIANCE_INFO[a]?.color }}>{ALLIANCE_INFO[a]?.name ?? (a.startsWith('X') ? 'Военный союз' : a)}</span>) : <span class="muted small">Внеблоковая страна</span>}</div>
      </div>
      <div class="section">
        <h3 class="sub">Войны</h3>
        {wars.length ? wars.map((w) => (
          <div class="kv" key={w.id}><span class="danger">⚔ {w.name}</span><span>с {fmtDate(dateOf(w.start))}</span></div>
        )) : <span class="muted small">Мирное время</span>}
      </div>
      <div class="section"><h3 class="sub">Политический компас</h3><Axes v={c.ideology} /></div>
    </div>
  );
}

function Economy() {
  const sim = ctl.sim!, c = ctl.country!;
  const types: [typeof c.econ, string, string][] = [['market', 'Рыночная', 'быстрый рост, нестабильность'], ['mixed', 'Смешанная', 'баланс'], ['planned', 'Плановая', 'стабильность, медленный рост'], ['war', 'Военная', 'макс. оборонка']];
  const sanc = sanctionPenalty(sim, c);
  const set = (key: 'tax' | 'researchShare', v: number) => ctl.dispatch({ t: 'policy', key, value: v });
  return (
    <div class="col" style={{ gap: 0 }}>
      <div class="section grid3">
        <div class="stat"><b>{money(c.gdp)}</b><span>ВВП</span></div>
        <div class="stat"><b class={c.gdpGrowth >= 0 ? 'ok' : 'danger'}>{pct(c.gdpGrowth, 2)}</b><span>Рост в год</span></div>
        <div class="stat"><b>{pct(c.inflation, 1)}</b><span>Инфляция</span></div>
        <div class="stat"><b>{money(c.debt)}</b><span>Госдолг · {((c.debt / c.gdp) * 100).toFixed(0)}% ВВП</span></div>
        <div class="stat"><b class={sanc > 0.1 ? 'danger' : ''}>{(sanc * 100).toFixed(0)}%</b><span>Под санкциями (доля мира)</span></div>
        <div class="stat"><b>${sim.s.oilPrice.toFixed(0)}</b><span>Нефть Brent</span></div>
      </div>
      <div class="section col">
        <h3 class="sub">Бюджет в день</h3>
        <div class="kv"><span>Налоговые поступления</span><span class="ok">+{money(dailyIncome(sim, c))}</span></div>
        <div class="kv"><span>Содержание армии</span><span class="danger">−{money(upkeep(sim, c))}</span></div>
        <div class="kv"><span>Наука</span><span class="danger">−{money((c.gdp * c.researchShare) / 365 * 0.15)}</span></div>
        <div class="kv"><span>Обслуживание долга</span><span class="danger">−{money((c.debt * 0.02) / 365)}</span></div>
        <div class="kv"><span><b>Итого (с торговлей)</b></span><span class={c.income - c.expenses >= 0 ? 'ok' : 'danger'}>{money(c.income - c.expenses)}</span></div>
      </div>
      <div class="section col">
        <div class="row between"><h3 class="sub" style={{ margin: 0 }}>Налоговая ставка</h3><span class="mono">{(c.tax * 100).toFixed(0)}%</span></div>
        <input class="slider" type="range" min={10} max={60} value={c.tax * 100} aria-label="Налоговая ставка" onChange={(e) => set('tax', +(e.target as HTMLInputElement).value / 100)} />
        <span class="tiny muted">Выше 35% — недовольство и замедление роста.</span>
        <div class="row between" style={{ marginTop: 8 }}><h3 class="sub" style={{ margin: 0 }}>Расходы на науку</h3><span class="mono">{(c.researchShare * 100).toFixed(1)}% ВВП</span></div>
        <input class="slider" type="range" min={0} max={60} value={c.researchShare * 1000} aria-label="Расходы на науку" onChange={(e) => set('researchShare', +(e.target as HTMLInputElement).value / 1000)} />
      </div>
      <div class="section col">
        <h3 class="sub">Тип экономики</h3>
        <div class="grid2">
          {types.map(([id, n, d]) => <button key={id} class={`btn${c.econ === id ? ' on' : ''}`} style={{ height: 'auto', padding: 8, flexDirection: 'column', alignItems: 'flex-start' }} onClick={click(() => ctl.dispatch({ t: 'econ', value: id }))}><span>{n}</span><span class="tiny muted">{d}</span></button>)}
        </div>
        <label class="row small" style={{ marginTop: 8 }}><input type="checkbox" checked={c.printing} onChange={(e) => ctl.dispatch({ t: 'printing', on: (e.target as HTMLInputElement).checked })} /> Печатать деньги (+доход, разгон инфляции)</label>
      </div>
      <div class="section">
        <h3 class="sub">Ресурсы · запас · производство · потребление</h3>
        {(Object.keys(RESOURCE_INFO) as ResourceKey[]).map((k) => {
          const net = c.prod[k] - c.use[k];
          return (
            <div class="kv" key={k}>
              <span>{RESOURCE_INFO[k].icon} {RESOURCE_INFO[k].name}</span>
              <span>{c.stock[k].toFixed(0)} · <span class="ok">+{c.prod[k].toFixed(1)}</span> · <span class="danger">−{c.use[k].toFixed(1)}</span> = <span class={net >= 0 ? 'ok' : 'danger'}>{net.toFixed(1)}</span></span>
            </div>
          );
        })}
        <div class="tiny muted" style={{ marginTop: 6 }}>Излишки сверх 300 продаются на мировом рынке (цена ед.: нефть {money(PRICE.oil * sim.s.oilPrice / 60)}). Дефицит закупается — если не мешают санкции.</div>
      </div>
    </div>
  );
}

function Politics() {
  const c = ctl.country!;
  const bars: [string, number, string][] = [
    ['Стабильность', c.stability, 'ok'], ['Одобрение лидера', c.approval, 'info'], ['Коррупция', c.corruption, 'danger'],
    ['Национализм', c.nationalism, ''], ['Свобода прессы', c.pressFreedom, 'info'], ['Уровень жизни', c.living, 'ok'], ['Военная усталость', c.warExhaustion, 'danger'],
  ];
  const q: [typeof c.quarantine, string][] = [['none', 'Без ограничений'], ['soft', 'Мягкие меры'], ['hard', 'Жёсткий карантин']];
  return (
    <div class="col" style={{ gap: 0 }}>
      <div class="section col">
        {bars.map(([n, v, k]) => (
          <div key={n}><div class="row between small"><span class="muted">{n}</span><span class="mono">{v.toFixed(0)}</span></div><div class={`bar ${k}`}><i style={{ width: `${Math.max(0, Math.min(100, v))}%` }} /></div></div>
        ))}
      </div>
      <div class="section col">
        <h3 class="sub">Фракции · поддержка</h3>
        {Object.entries(c.factions).map(([n, v]) => (
          <div key={n}><div class="row between small"><span>{n}</span><span class={`mono ${v < 30 ? 'danger' : ''}`}>{v.toFixed(0)}</span></div><div class={`bar ${v < 30 ? 'danger' : ''}`}><i style={{ width: `${v}%` }} /></div></div>
        ))}
        <span class="tiny muted">Недовольство силовиков при низкой стабильности грозит мятежом.</span>
      </div>
      <div class="section"><h3 class="sub">Идеология</h3><Axes v={c.ideology} /></div>
      <div class="section col">
        <h3 class="sub">Санитарные меры</h3>
        <div class="row">{q.map(([id, n]) => <button key={id} class={`btn sm${c.quarantine === id ? ' on' : ''}`} onClick={click(() => ctl.dispatch({ t: 'quarantine', value: id }))}>{n}</button>)}</div>
        <div class="row between" style={{ marginTop: 8 }}><h3 class="sub" style={{ margin: 0 }}>Мобилизация</h3><span class="mono">{(c.mobilisation * 100).toFixed(0)}%</span></div>
        <input class="slider" type="range" min={0} max={100} value={c.mobilisation * 100} aria-label="Мобилизация" onChange={(e) => ctl.dispatch({ t: 'policy', key: 'mobilisation', value: +(e.target as HTMLInputElement).value / 100 })} />
        <span class="tiny muted">Резерв: {num(c.manpower)} тыс. Повышение мобилизации снижает стабильность.</span>
      </div>
    </div>
  );
}

function Log() {
  const s = ctl.state!;
  const me = ctl.me;
  const list = s.log.filter((e) => !e.country || e.country === me || e.kind === 'war' || e.kind === 'diplo' || e.kind === 'alert' || e.kind === 'event').slice(-150).reverse();
  return (
    <div class="col" style={{ gap: 0 }}>
      {list.map((e, i) => (
        <div class="kv small" key={i} style={{ borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
          <span style={{ color: e.kind === 'war' || e.kind === 'alert' ? '#ffb3b0' : 'var(--text)', fontFamily: 'var(--font-ui)' }}>{e.text}</span>
          <span class="dim tiny" style={{ whiteSpace: 'nowrap' }}>{fmtDate(dateOf(e.t))}</span>
        </div>
      ))}
    </div>
  );
}
