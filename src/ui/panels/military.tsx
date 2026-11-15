import { useState } from 'preact/hooks';
import { ctl } from '../../client/controller';
import { audio } from '../../audio/audio';
import { MISSILE, UNIT, BUILDING } from '../../data/military';
import { productionLines, unitCostOk } from '../../game/domestic';
import type { MissileType, UnitType } from '../../game/types';
import { UNIT_TYPES } from '../../render/units';
import { money, num, click } from '../util';

const MISSILES: MissileType[] = ['shahed', 'cruise', 'ballistic', 'hypersonic', 'icbm'];
const MISSILE_ICON: Record<MissileType, string> = { shahed: '🛩', cruise: '🚀', ballistic: '🎯', hypersonic: '⚡', icbm: '☢' };

export function ProductionPanel() {
  const sim = ctl.sim!, c = ctl.country!;
  const lines = productionLines(sim, c);
  return (
    <div class="col" style={{ gap: 0 }}>
      <div class="section row between">
        <span class="small">Производственных линий: <b class="mono">{lines}</b> <span class="muted">(военные заводы + 1)</span></span>
        <span class="small">Казна: <b class="mono">{money(c.budget)}</b></span>
      </div>
      <div class="section">
        <h3 class="sub">Сухопутные войска, авиация, флот</h3>
        <div class="cards">
          {UNIT_TYPES.map((t) => {
            const st = UNIT[t];
            const err = unitCostOk(c, t);
            return (
              <div class="card" key={t} title={st.desc}>
                <div class="row between"><b class="small">{st.short}</b><span class="mono tiny muted">{st.days} дн.</span></div>
                <div class="tiny muted" style={{ minHeight: 30 }}>{st.desc.split('.')[0]}.</div>
                <div class="tiny mono">{money(st.cost)} · ⚙{st.steel}{st.rare ? ` · ◆${st.rare}` : ''} · 👥{st.manpower}k</div>
                <div class="tiny mono muted">АТК {st.atk} · ЗАЩ {st.def} · {st.range} км</div>
                <div class="row">
                  <button class="btn sm grow" disabled={!!err} title={err ?? ''} onClick={click(() => ctl.dispatch({ t: 'buildUnit', unit: t, count: 1 }))}>+1</button>
                  <button class="btn sm grow" disabled={!!err} onClick={click(() => ctl.dispatch({ t: 'buildUnit', unit: t, count: 5 }))}>+5</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div class="section">
        <h3 class="sub">Ракеты и дроны-камикадзе</h3>
        <div class="cards">
          {MISSILES.map((m) => {
            const st = MISSILE[m];
            const locked = st.requires && !c.researched.includes(st.requires);
            const n = m === 'shahed' ? 50 : m === 'icbm' ? 1 : 10;
            return (
              <div class="card" key={m}>
                <div class="row between"><b class="small">{MISSILE_ICON[m]} {st.name}</b></div>
                <div class="tiny muted">{st.real}</div>
                <div class="tiny mono">{num(st.range)} км · {money(st.cost * n)} за {n}</div>
                <button class="btn sm" disabled={!!locked || c.budget < st.cost * n} title={locked ? 'Нужна технология' : ''} onClick={click(() => ctl.dispatch({ t: 'buildMissile', missile: m, count: n }))}>Заказать ×{n}</button>
              </div>
            );
          })}
        </div>
      </div>
      <div class="section">
        <h3 class="sub">Очередь производства</h3>
        {c.queue.length === 0 && <div class="muted small">Пусто. Объекты инфраструктуры строятся через панель провинции (клик по карте).</div>}
        {c.queue.map((q, i) => {
          const name = q.kind === 'unit' ? UNIT[q.item as UnitType].short : q.kind === 'missile' ? MISSILE[q.item as MissileType].name : BUILDING[q.item as keyof typeof BUILDING].name;
          return (
            <div class="row small" key={i} style={{ padding: '6px 0', opacity: i < lines ? 1 : 0.5 }}>
              <span style={{ width: 170 }}>{name}{q.count > 1 ? ` ×${q.count}` : ''}{q.province !== undefined ? ` · ${ctl.world.provinces[q.province].name}` : ''}</span>
              <div class="bar grow"><i style={{ width: `${(q.progress / q.days) * 100}%` }} /></div>
              <span class="mono tiny" style={{ width: 50, textAlign: 'right' }}>{i < lines ? `${Math.ceil(q.days - q.progress)} дн.` : 'ждёт'}</span>
              <button class="btn sm ghost" aria-label="Отменить" onClick={click(() => ctl.dispatch({ t: 'cancelQueue', index: i }))}>✕</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ArmyPanel() {
  const sim = ctl.sim!, c = ctl.country!;
  const [filter, setFilter] = useState<UnitType | 'all'>('all');
  const mine = sim.s.units.filter((u) => u.owner === c.id);
  const list = filter === 'all' ? mine : mine.filter((u) => u.type === filter);
  const enemies = sim.enemiesOf(c.id);
  return (
    <div class="col" style={{ gap: 0 }}>
      <div class="section grid3">
        <div class="stat"><b>{mine.length}</b><span>Соединений</span></div>
        <div class="stat"><b>{mine.filter((u) => u.engaged === 0).length}</b><span>В бою</span></div>
        <div class="stat"><b>{(mine.reduce((a, u) => a + u.str, 0) / Math.max(1, mine.length)).toFixed(0)}%</b><span>Укомплектованность</span></div>
      </div>
      {enemies.length > 0 && <div class="section small"><span class="danger">⚔ Противники: </span>{enemies.map((e) => sim.c(e)!.name).join(', ')}</div>}
      <div class="section row wrap">
        <button class={`btn sm${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>Все</button>
        {UNIT_TYPES.map((t) => { const n = mine.filter((u) => u.type === t).length; return n ? <button key={t} class={`btn sm${filter === t ? ' on' : ''}`} onClick={() => setFilter(t)}>{UNIT[t].short} {n}</button> : null; })}
        <button class="btn sm" style={{ marginLeft: 'auto' }} onClick={click(() => { ctl.selectedUnits = new Set(list.map((u) => u.id)); ctl.bump(); })}>Выделить все</button>
      </div>
      <div>
        {list.map((u) => (
          <div class={`unit-row${ctl.selectedUnits.has(u.id) ? ' on' : ''}`} key={u.id} onClick={() => { audio.ui('select'); ctl.selectedUnits = new Set([u.id]); ctl.focusUnit(u); ctl.bump(); }}>
            <span class="unit-ico" style={{ background: c.color }}>{UNIT[u.type].short.slice(0, 3)}</span>
            <div class="col" style={{ gap: 3 }}>
              <span class="small">{u.name} <span class="dim tiny">· {ctl.world.provinces[ctl.world.provinceAt(u.lat, u.lon)]?.name ?? 'в море'}</span></span>
              <div class="row" style={{ gap: 4 }}><div class="bar ok grow"><i style={{ width: `${u.str}%` }} /></div><div class="bar info grow"><i style={{ width: `${u.org}%` }} /></div></div>
            </div>
            <span class="tiny" style={{ textAlign: 'right' }}>{u.engaged === 0 ? <span class="danger">В БОЮ</span> : u.path.length ? <span class="accent">марш</span> : <span class="muted">{u.xp > 0.5 ? 'ветераны' : 'готов'}</span>}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MissilesPanel() {
  const sim = ctl.sim!, c = ctl.country!;
  const [count, setCount] = useState(1);
  const [confirmNuke, setConfirmNuke] = useState(false);
  const aim = (m: MissileType) => {
    if (m === 'icbm' && !confirmNuke) { setConfirmNuke(true); audio.ui('alert'); return; }
    setConfirmNuke(false);
    ctl.targeting = { missile: m, count: m === 'icbm' ? 1 : count };
    ctl.panel = null;
    audio.ui('confirm');
    ctl.bump();
  };
  const ads = sim.s.units.filter((u) => u.owner === c.id && u.type === 'airdef');
  const inFlight = sim.s.missiles.filter((m) => m.owner === c.id).length;
  const incoming = sim.s.missiles.filter((m) => m.owner !== c.id && sim.s.prov.ctrl[ctl.world.provinceAt(m.to.lat, m.to.lon)] === c.id).length;
  return (
    <div class="col" style={{ gap: 0 }}>
      <div class="section grid3">
        <div class="stat"><b>{inFlight}</b><span>В полёте</span></div>
        <div class="stat"><b class={incoming ? 'danger' : ''}>{incoming}</b><span>Входящие угрозы</span></div>
        <div class="stat"><b>{ads.reduce((a, u) => a + Math.floor(u.ammo), 0)}</b><span>Ракет-перехватчиков</span></div>
      </div>
      <div class="section col">
        <div class="row between"><h3 class="sub" style={{ margin: 0 }}>Залп</h3><span class="mono">×{count}</span></div>
        <input class="slider" type="range" min={1} max={30} value={count} aria-label="Размер залпа" onInput={(e) => setCount(+(e.target as HTMLInputElement).value)} />
        <span class="tiny muted">Массированный залп перегружает ПВО противника. Пуск — из ближайшей к цели провинции (крылатые ракеты — также с кораблей).</span>
      </div>
      <div class="section col">
        {MISSILES.map((m) => {
          const st = MISSILE[m];
          const err = sim.canUseMissile(c, m);
          return (
            <div class="card" key={m} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 26 }}>{MISSILE_ICON[m]}</span>
              <div class="grow col" style={{ gap: 2 }}>
                <b class="small">{st.name} <span class="muted tiny">· {st.real}</span></b>
                <span class="tiny muted">{st.desc} Дальность {num(sim.missileRange(c, m))} км, прорыв ПВО {(st.evade * 100).toFixed(0)}%.</span>
              </div>
              <span class="mono" style={{ fontSize: 18, minWidth: 48, textAlign: 'right' }}>{c.missiles[m]}</span>
              <button class={`btn sm ${m === 'icbm' ? 'danger' : 'primary'}`} disabled={!!err} title={err ?? ''} onClick={click(() => aim(m))}>
                {m === 'icbm' && confirmNuke ? 'ПОДТВЕРДИТЬ ПУСК' : 'Навести'}
              </button>
            </div>
          );
        })}
        {confirmNuke && <div class="toast alert" style={{ animation: 'none' }}>☢ Ядерный удар необратим. Весь мир отвернётся от вас, напряжённость достигнет максимума. Нажмите ещё раз для подтверждения.</div>}
        <div class="tiny muted">Ядерных боеголовок: {c.nukes}</div>
      </div>
    </div>
  );
}
