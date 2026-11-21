import { useEffect, useState } from 'preact/hooks';
import { ctl, type MapMode, type Panel } from '../client/controller';
import { audio } from '../audio/audio';
import { dateOf } from '../game/types';
import { EVENT_BY_ID } from '../data/events';
import { UNIT, BUILDING, MISSILE } from '../data/military';
import { TERRAIN_INFO } from '../world/worldTypes';
import { RESOURCE_INFO, type ResourceKey } from '../data/resources';
import type { BuildingType } from '../game/types';
import { money, num, people, fmtDate, fmtTime, useCtl, click } from './util';
import { cues, opsPoints, OPS_CAP } from '../game/strategy';
import { PanelHost } from './panels';
import { UNIT_TYPES } from '../render/units';

const NAV: [Exclude<Panel, null>, string, string][] = [
  ['overview', '🏛', 'Обзор страны'], ['economy', '💹', 'Экономика'], ['production', '🏭', 'Производство'], ['research', '🔬', 'Технологии'],
  ['focus', '🎯', 'Национальные фокусы'], ['diplomacy', '🤝', 'Дипломатия'], ['ops', '⚡', 'Командование'], ['army', '🪖', 'Вооружённые силы'], ['missiles', '🚀', 'Ракетные войска'],
  ['politics', '⚖', 'Внутренняя политика'], ['log', '📰', 'Журнал событий'], ['settings', '⚙', 'Настройки'],
];

const MODES: [MapMode, string, string][] = [
  ['political', '🗺', 'Политическая'], ['terrain', '⛰', 'Рельеф'], ['diplomacy', '🤝', 'Дипломатия'], ['economy', '💰', 'Экономика'],
  ['military', '⚔', 'Военная'], ['airdefense', '📡', 'ПВО'], ['resources', '🛢', 'Ресурсы'], ['threat', '⚠', 'Угрозы'],
];

export function Hud() {
  const c = useCtl();
  const s = c.state;
  const targeting = !!c.targeting;
  // DOM class sync belongs in an effect — writing it during render tripped React's
  // concurrent renderer every frame the HUD re-rendered.
  useEffect(() => { document.body.classList.toggle('targeting', targeting); }, [targeting]);
  if (!s) return null;
  return (
    <>
      <TopBar />
      <nav class="leftnav" aria-label="Панели">
        {NAV.map(([id, icon, tip]) => (
          <button key={id} class={`nav-btn${c.panel === id ? ' on' : ''}`} aria-label={tip} onMouseEnter={() => audio.ui('hover')}
            onClick={() => { audio.unlock(); audio.ui(c.panel === id ? 'close' : 'open'); c.panel = c.panel === id ? null : id; c.bump(); }}>
            {icon}<span class="tip">{tip}</span>
            {id === 'research' && c.country && !c.country.research && <span class="dot" />}
            {id === 'focus' && c.country && !c.country.focus && <span class="dot" />}
            {id === 'diplomacy' && c.country && c.country.flags.some((f) => /peaceoffer_|calltoarms_|allyoffer_|ultimatum_/.test(f)) && <span class="dot" />}
          </button>
        ))}
      </nav>
      {c.panel && <PanelHost panel={c.panel} />}
      <SidePanel />
      <div class="panel mapmodes" role="toolbar" aria-label="Режимы карты">
        {MODES.map(([id, icon, name]) => (
          <button key={id} class={`mm${c.mapMode === id ? ' on' : ''}`} title={name}
            onClick={click(() => { c.mapMode = id; c.updatePalette(); c.bump(); })}>{icon}<span>{name}</span></button>
        ))}
      </div>
      <div class="toasts" aria-live="polite">{c.toasts.map((t) => <div key={t.id} class={`toast ${t.kind}`}>{t.text}</div>)}</div>
      {c.box && <div class="boxsel" style={{ left: Math.min(c.box.x0, c.box.x1), top: Math.min(c.box.y0, c.box.y1), width: Math.abs(c.box.x1 - c.box.x0), height: Math.abs(c.box.y1 - c.box.y0) }} />}
      {c.targeting && (
        <div class="target-banner">
          <span>🎯 Наведение: <b>{MISSILE[c.targeting.missile].name}</b> ×{c.targeting.count} — ЛКМ по цели, Shift — серия, ПКМ — отмена{c.targetWarn ? <b style="color:#ff9d97"> — ⚠ удар по «{c.targetWarn}» будет объявлением войны!</b> : null}</span>
          <button class="btn sm danger" onClick={click(() => { c.targeting = null; c.bump(); })}>Отмена</button>
        </div>
      )}
      <HoverTip />
      <StatusBar />
      <HintBar />
      <EventModal />
      {c.session && c.session.role !== 'solo' && <Chat />}
      <div class="netstatus">{c.session?.status()}</div>
    </>
  );
}

function TopBar() {
  const c = ctl;
  const s = c.state!, me = c.country;
  const d = dateOf(s.tick);
  const defcon = s.tension > 85 ? 1 : s.tension > 65 ? 2 : s.tension > 45 ? 3 : s.tension > 25 ? 4 : 5;
  const res: [string, string, number, number][] = me ? (['oil', 'gas', 'steel', 'rare', 'food', 'uranium'] as ResourceKey[]).map((k) => [RESOURCE_INFO[k].icon, RESOURCE_INFO[k].name, me.stock[k], me.prod[k] - me.use[k]]) : [];
  return (
    <header class="topbar">
      {me && (
        <div class="tb-country" onClick={click(() => { c.panel = c.panel === 'overview' ? null : 'overview'; c.bump(); })}>
          <span class="flag" style={{ background: `linear-gradient(135deg, ${me.color} 60%, rgba(0,0,0,0.4))` }} />
          <div><b>{me.name}</b><span>{me.leader}</span></div>
        </div>
      )}
      {me && (
        <div class="tb-res">
          <div class={`res${me.budget < 0 ? ' warn' : ''}`} title="Казна · доход в день"><b>{money(me.budget)}<span class={`d ${me.income - me.expenses >= 0 ? 'ok' : 'danger'}`}>{me.income - me.expenses >= 0 ? '+' : ''}{money(me.income - me.expenses)}</span></b><span>Казна / день</span></div>
          <div class="res" title="ВВП"><b>{money(me.gdp)}<span class={`d ${me.gdpGrowth >= 0 ? 'ok' : 'danger'}`}>{me.gdpGrowth >= 0 ? '+' : ''}{me.gdpGrowth.toFixed(1)}%</span></b><span>ВВП</span></div>
          <div class={`res${me.stability < 30 ? ' warn' : ''}`}><b>{me.stability.toFixed(0)}</b><span>Стабильн.</span></div>
          <div class="res"><b>{num(me.manpower, 0)}k</b><span>Резерв</span></div>
          <div class="res"><b>{me.rp.toFixed(1)}</b><span>Наука/д</span></div>
          {res.map(([icon, name, v, dlt]) => (
            <div class={`res${v < 5 ? ' warn' : ''}`} key={name} title={`${name}: запас ${v.toFixed(0)}, ${dlt >= 0 ? '+' : ''}${dlt.toFixed(1)}/день`}>
              <b>{icon} {v.toFixed(0)}<span class={`d ${dlt >= 0 ? 'ok' : 'danger'}`}>{dlt >= 0 ? '+' : ''}{dlt.toFixed(1)}</span></b><span>{name}</span>
            </div>
          ))}
        </div>
      )}
      {me && <WarStrip />}
      <div class="defcon" title={`Мировая напряжённость ${s.tension.toFixed(0)}`}>
        <span class="caps">DEFCON</span><b style={{ color: defcon <= 2 ? 'var(--danger)' : defcon === 3 ? 'var(--accent)' : 'var(--ok)' }}>{defcon}</b>
      </div>
      <div class="tb-time">
        <button class="btn icon sm ghost" aria-label={s.speed ? 'Пауза' : 'Продолжить'} onClick={() => c.dispatch({ t: 'speed', speed: s.speed ? 0 : 2 })}>{s.speed ? '❚❚' : '▶'}</button>
        <div class="date">{fmtDate(d)}<small>{s.speed ? fmtTime(d) : 'ПАУЗА'}</small></div>
        <div class="row" style={{ gap: 3 }} role="group" aria-label="Скорость">
          {[1, 2, 3, 4, 5].map((n) => <button key={n} class={`speed${s.speed >= n ? ' on' : ''}`} aria-label={`Скорость ${n}`} onClick={() => c.dispatch({ t: 'speed', speed: n })} />)}
        </div>
      </div>
    </header>
  );
}

/** Live war status: who is winning, by how much, and where the front is. */
function WarStrip() {
  const c = ctl;
  const sim = c.sim!, me = c.country!;
  const wars = sim.s.wars.filter((w) => sim.sideOf(w, me.id));
  if (!wars.length) {
    return (
      <div class="warstrip peace" title="Войн нет">
        <span class="ws-ico">🕊</span><span class="ws-name">Мир</span>
        <span class="tiny muted">операций: {opsPoints(sim, me)}/{OPS_CAP}</span>
      </div>
    );
  }
  const foes = [...new Set(wars.flatMap((w) => (w.attackers.includes(me.id) ? w.defenders : w.attackers)))].map((id) => sim.c(id)).filter(Boolean);
  const theirLoss = foes.reduce((a, f) => a + sim.occupationShare(f!.id, me.id), 0) / Math.max(1, foes.length);
  const myLoss = foes.reduce((a, f) => a + sim.occupationShare(me.id, f!.id), 0) / Math.max(1, foes.length);
  const balance = theirLoss - myLoss;
  const verdict = balance > 0.15 ? 'мы наступаем' : balance < -0.15 ? 'нас теснят' : 'фронт стоит';
  return (
    <div class={`warstrip ${balance > 0.15 ? 'win' : balance < -0.15 ? 'lose' : 'stale'}`} title={`Захвачено нами ${(theirLoss * 100).toFixed(0)}% · нами потеряно ${(myLoss * 100).toFixed(0)}%`}>
      <span class="ws-ico">⚔</span>
      <span class="ws-name">{foes.map((f) => f!.name).join(', ')}</span>
      <span class="ws-balance">
        <i style={{ width: `${Math.min(100, 50 + balance * 120)}%` }} />
      </span>
      <span class="tiny">{verdict}</span>
      <span class="tiny muted">⚡{opsPoints(sim, me)}</span>
    </div>
  );
}

function SidePanel() {
  const c = ctl;
  const s = c.state!;
  const units = c.selectedUnitList();
  if (units.length) {
    const mine = units.filter((u) => u.owner === c.me);
    const owner = s.countries[units[0].owner];
    return (
      <aside class="panel side-panel" aria-label="Выбранные войска">
        <div class="panel-head">
          <h2 class="panel-title">{units.length === 1 ? UNIT[units[0].type].short : `Войска · ${units.length}`}</h2>
          <span class="row small"><span class="swatch" style={{ background: owner?.color }} />{owner?.name}</span>
        </div>
        <div class="panel-body" style={{ maxHeight: '50vh' }}>
          {units.slice(0, 60).map((u) => (
            <div class="unit-row" key={u.id} onClick={() => c.focusUnit(u)}>
              <span class="unit-ico" style={{ background: s.countries[u.owner]?.color }}>{UNIT[u.type].short.slice(0, 3)}</span>
              <div class="col" style={{ gap: 3 }}>
                <span class="small">{u.name}</span>
                <div class="row" style={{ gap: 4 }}>
                  <div class="bar ok grow" title="Численность"><i style={{ width: `${u.str}%` }} /></div>
                  <div class="bar info grow" title="Организация"><i style={{ width: `${u.org}%` }} /></div>
                </div>
              </div>
              <span class="tiny muted" style={{ textAlign: 'right' }}>{u.engaged === 0 ? <span class="danger">В БОЮ</span> : u.path.length ? 'марш' : u.hold ? 'оборона' : 'готов'}</span>
            </div>
          ))}
        </div>
        {mine.length > 0 && (
          <div class="panel-body col" style={{ borderTop: '1px solid var(--line)' }}>
            <div class="small muted">ПКМ по карте — приказ на движение. Танки и пехота захватывают провинции врага.</div>
            <div class="row">
              <button class="btn sm grow" onClick={click(() => c.dispatch({ t: 'hold', units: mine.map((u) => u.id) }))}>🛡 Оборона (H)</button>
              <button class="btn sm grow" title="Мгновенно: +20 организации, +4 численности, 1 очко операций"
                onClick={click(() => c.dispatch({ t: 'supply', units: mine.map((u) => u.id) }))}>📦 Снабдить</button>
              <button class="btn sm danger" onClick={click(() => { if (confirm(`Расформировать ${mine.length} ед.?`)) { c.dispatch({ t: 'disband', units: mine.map((u) => u.id) }); c.selectedUnits.clear(); } })}>✕</button>
            </div>
          </div>
        )}
      </aside>
    );
  }
  const p = c.selectedProvince;
  if (p < 0) return null;
  const pr = c.world.provinces[p];
  const owner = s.countries[s.prov.owner[p]], ctrl = s.countries[s.prov.ctrl[p]];
  const b = s.prov.buildings[p];
  const mine = s.prov.ctrl[p] === c.me;
  const t = TERRAIN_INFO[pr.terrain];
  return (
    <aside class="panel side-panel" aria-label="Провинция">
      <div class="panel-head">
        <div><h2 class="panel-title">{pr.name}</h2><div class="tiny muted">{t.icon} {t.name}{pr.coastal ? ' · побережье' : ''}</div></div>
        <button class="btn sm ghost" aria-label="Закрыть" onClick={click(() => { c.selectedProvince = -1; c.inspectCountry = null; c.engine.globe.material.uniforms.selectedId.value = -1; c.bump(); })}>✕</button>
      </div>
      <div class="panel-body col">
        <div class="kv"><span>Владелец</span><span class="row"><span class="swatch" style={{ background: owner?.color }} />{owner?.name ?? 'Антарктида'}</span></div>
        {ctrl && owner && ctrl.id !== owner.id && <div class="kv"><span>Оккупирована</span><span class="danger">{ctrl.name}</span></div>}
        {owner && <div class="kv"><span>Население</span><span>{people(owner.pop * pr.popShare)}</span></div>}
        <div class="kv"><span>Площадь</span><span>{num(pr.area)} км²</span></div>
        <div class="kv"><span>Оборона</span><span>×{t.defense.toFixed(2)} · движение ×{t.move}</span></div>
        {s.prov.damage[p] > 0.01 && <div class="kv"><span>Разрушения</span><span class="danger">{(s.prov.damage[p] * 100).toFixed(0)}%</span></div>}
        {s.prov.capture[p] > 0 && <div class="col" style={{ gap: 4 }}><span class="small danger">Идёт захват: {s.countries[s.prov.captureBy[p] ?? '']?.name}</span><div class="bar danger"><i style={{ width: `${s.prov.capture[p] * 100}%` }} /></div></div>}
        {Object.keys(pr.resources).length > 0 && (
          <div className="row wrap">{(Object.entries(pr.resources) as [ResourceKey, number][]).map(([k, v]) => <span class="chip" key={k}>{RESOURCE_INFO[k].icon} {RESOURCE_INFO[k].name} {'★'.repeat(v)}</span>)}</div>
        )}
        <h3 class="sub" style={{ marginTop: 8 }}>Инфраструктура</h3>
        {(Object.keys(BUILDING) as BuildingType[]).map((k) => {
          const st = BUILDING[k];
          const n = b[k] ?? 0;
          const allowed = st.allowed(pr);
          if (!mine && !n) return null;
          return (
            <div class="row small" key={k} style={{ opacity: allowed || n ? 1 : 0.45 }}>
              <span class="grow" title={allowed ? st.desc : st.reason}>{st.name}</span>
              <span class="mono">{'■'.repeat(n)}<span class="dim">{'□'.repeat(Math.max(0, st.max - n))}</span></span>
              {mine && <button class="btn sm" disabled={!allowed || n >= st.max} title={allowed ? `${st.desc} · ${money(st.cost)} · ${st.days} дн.` : st.reason} onClick={click(() => c.dispatch({ t: 'buildBuilding', building: k, province: p }))}>+</button>}
            </div>
          );
        })}
        {owner && owner.id !== c.me && (
          <button class="btn" style={{ marginTop: 8 }} onClick={click(() => { c.inspectCountry = owner.id; c.panel = 'diplomacy'; c.bump(); })}>Дипломатия: {owner.name}</button>
        )}
      </div>
    </aside>
  );
}

/**
 * Bottom-left readout: what is under the cursor and what is selected.
 * Replaces squinting at the map — every number that matters is one glance away.
 */
function StatusBar() {
  const c = ctl;
  if (!c.sim || !c.me) return null;
  const s = c.state!;
  const sel = c.selectedUnitList();
  const p = c.hoverProvince >= 0 ? c.hoverProvince : c.selectedProvince;
  const pr = p >= 0 ? c.world.provinces[p] : null;
  const ctrl = pr ? s.countries[s.prov.ctrl[pr.id]] : null;
  const own = sel.filter((u) => u.owner === c.me);
  const str = own.length ? own.reduce((a, u) => a + u.str, 0) / own.length : 0;
  const org = own.length ? own.reduce((a, u) => a + u.org, 0) / own.length : 0;
  const cap = sel.length ? sel.reduce((a, u) => a + u.str * UNIT[u.type].atk * 0.01, 0) : 0;
  return (
    <div class="statusbar">
      {pr && (
        <span class="sb-cell">
          <span class="swatch" style={{ background: ctrl?.color ?? '#666' }} />
          <b>{pr.name}</b>
          <span class="muted tiny">{TERRAIN_INFO[pr.terrain].icon} {TERRAIN_INFO[pr.terrain].name}</span>
        </span>
      )}
      {pr && s.prov.capture[pr.id] > 0.02 && (
        <span class="sb-cell danger tiny">захват {(s.prov.capture[pr.id] * 100).toFixed(0)}%</span>
      )}
      {(c.hoverUnits.mine > 0 || c.hoverUnits.enemy > 0) && (
        <span class="sb-cell tiny">
          <span class="ok">{c.hoverUnits.mine} своих</span> · <span class="danger">{c.hoverUnits.enemy} врагов</span>
        </span>
      )}
      {sel.length > 0 && (
        <span class="sb-cell">
          <b>{sel.length} соед.</b>
          <span class="bar ok" style={{ width: 60 }}><i style={{ width: `${str}%` }} /></span>
          <span class="bar info" style={{ width: 60 }}><i style={{ width: `${org}%` }} /></span>
          <span class="tiny muted">сила {cap.toFixed(1)}</span>
        </span>
      )}
      {!pr && !sel.length && <span class="sb-cell tiny muted">Клик — провинция · Alt+клик — удар · двойной клик — приблизить</span>}
    </div>
  );
}

function HoverTip() {
  const c = ctl;
  if (!c.hoverPos || c.hoverProvince < 0 || c.box) return null;
  const s = c.state!;
  const p = c.hoverProvince;
  const pr = c.world.provinces[p];
  const ctrl = s.countries[s.prov.ctrl[p]];
  return (
    <div class="hover-tip" style={{ left: c.hoverPos.x + 16, top: c.hoverPos.y + 14 }}>
      <b>{pr.name}</b> <span class="muted">· {ctrl?.name ?? '—'} · {TERRAIN_INFO[pr.terrain].name}</span>
    </div>
  );
}

const HINTS = [
  'Клик по провинции — здания, ресурсы и дипломатия с её владельцем',
  'Режимы карты снизу: рельеф, экономика, ресурсы и карта угроз',
  '⚡ Командование — удары, давление и доктрина в один клик',
  '🛡 «Оборона» даёт войскам окопаться: регенерация и штраф атакующему',
  'Shift + перетаскивание — выделить армию рамкой, ПКМ — приказ',
];

/**
 * Action bar: instead of a passive hint it is a queue of one-click decisions.
 * The player never has to guess what the game is waiting for.
 */
function HintBar() {
  const c = ctl;
  const s = c.state!;
  const me = c.country;
  const [hide, setHide] = useState(false);
  if (!me || hide || c.targeting || c.box) return null;
  const sim = c.sim!;
  const list = cues(sim, me).filter((q) => q.panel !== 'ops' || true);
  if (!list.length) {
    const hint = HINTS[Math.floor(s.tick / 24 / 3) % HINTS.length];
    return (
      <div class="hintbar">
        <span>💡 {hint}</span>
        <button class="btn sm ghost" aria-label="Скрыть подсказки" onClick={() => setHide(true)}>✕</button>
      </div>
    );
  }
  const q = list[0];
  return (
    <div class="hintbar cues">
      <span class="cue-led" />
      <b class="cue-label">{q.label}</b>
      <span class="cue-hint">{q.hint}</span>
      {q.act
        ? <button class="btn sm primary" onClick={click(() => c.dispatch(q.act!.cmd()))}>{q.act.label}</button>
        : <button class="btn sm" onClick={click(() => { c.panel = q.panel as Panel; c.bump(); })}>Открыть</button>}
      {list.length > 1 && (
        <button class="btn sm ghost" title={list.slice(1).map((x) => x.label).join(' · ')} onClick={click(() => { c.panel = list[1].panel as Panel; c.bump(); })}>+{list.length - 1}</button>
      )}
      <button class="btn sm ghost" aria-label="Скрыть" onClick={() => setHide(true)}>✕</button>
    </div>
  );
}

function EventModal() {
  const c = ctl;
  const s = c.state!;
  const p = s.pending.find((x) => x.country === c.me);
  if (!p) return null;
  const e = EVENT_BY_ID.get(p.event);
  if (!e) return null;
  return (
    <div class="modal-back">
      <div class="panel event" role="dialog" aria-modal="true" aria-labelledby="ev-title">
        <div class="event-art" aria-hidden="true">{e.icon}</div>
        <div class="panel-body col" style={{ gap: 14 }}>
          <span class="caps">{fmtDate(dateOf(s.tick))} · {e.world ? 'Мировое событие' : c.country?.name}</span>
          <h2 class="event-title" id="ev-title">{e.title}</h2>
          <p class="event-text">{e.text}</p>
          <div class="col" style={{ gap: 6 }}>
            {e.options.map((o, i) => (
              <button class="opt" key={i} autoFocus={i === 0} onClick={() => { audio.ui('confirm'); if (e.world) { s.pending = s.pending.filter((x) => x.key !== p.key); c.bump(); } c.dispatch({ t: 'event', key: p.key, option: i }); }}>
                <b>{o.label}</b>{o.tip && <span>{o.tip}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Chat() {
  const c = ctl;
  const [open, setOpen] = useState(true);
  const [text, setText] = useState('');
  const [to, setTo] = useState<'all' | 'allies'>('all');
  const log = c.session!.chatLog;
  return (
    <div class="panel chat">
      <div class="panel-head" style={{ padding: '6px 12px' }}>
        <span class="caps">Связь</span>
        <div class="row">
          <button class={`btn sm${to === 'all' ? ' on' : ''}`} onClick={() => setTo('all')}>Все</button>
          <button class={`btn sm${to === 'allies' ? ' on' : ''}`} onClick={() => setTo('allies')}>Союзники</button>
          <button class="btn sm ghost" aria-label="Свернуть" onClick={() => setOpen(!open)}>{open ? '▾' : '▴'}</button>
        </div>
      </div>
      {open && <div class="chat-log">{log.slice(-40).map((m, i) => <div key={i}><b>{m.name}</b>{m.to === 'allies' ? <span class="accent"> [союз]</span> : null}: {m.text}</div>)}</div>}
      {open && (
        <form class="row" style={{ padding: '0 12px 10px' }} onSubmit={(e) => { e.preventDefault(); if (text.trim()) { c.session!.chat(text.trim(), to); setText(''); audio.ui('click'); } }}>
          <input type="text" class="grow" placeholder={to === 'all' ? 'Всем…' : 'Союзникам…'} value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
        </form>
      )}
    </div>
  );
}

export { UNIT_TYPES };
