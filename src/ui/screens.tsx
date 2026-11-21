import { useEffect, useMemo, useState } from 'preact/hooks';
import { ctl } from '../client/controller';
import { audio } from '../audio/audio';
import { countryDefs, ALLIANCE_INFO, type CountryDef, type Tier, tierRank } from '../data/countries';
import { createGame } from '../game/setup';
import { createSim } from '../game/game';
import type { GameSettings } from '../game/types';
import { SoloSession, HostSession, ClientSession, LobbyBrowser, type LobbyInfo } from '../net/session';
import { netMode, supabaseConfig } from '../net/bus';
import { money, people, useCtl, click } from './util';
import { SettingsBody } from './panels/settings';

const TIER_NAME: Record<Tier, string> = { S: 'Сверхдержавы', A: 'Великие державы', B: 'Региональные державы', C: 'Средние страны', D: 'Малые страны · хардкор' };

export function Loading() {
  const c = useCtl();
  return (
    <div class="screen loading">
      <h1 class="logo"><span class="ww">W</span>ORLD<span class="ww">W</span>IDE</h1>
      <p class="tagline">Геополитическая стратегия · 2020 —</p>
      <div class="load-bar" role="progressbar" aria-valuenow={Math.round(c.loading.p * 100)}><i style={{ width: `${c.loading.p * 100}%` }} /></div>
      <p class="caps">{c.loading.msg}</p>
    </div>
  );
}

export function MainMenu({ onSettings }: { onSettings: () => void }) {
  const items: [string, string, () => void][] = [
    ['Одиночная кампания', '2020 → бесконечность, реальные события', () => { ctl.screen = 'select'; ctl.inspectCountry = null; ctl.engine.controls.flyTo(45, 30, 1.9); ctl.bump(); }],
    ['Мультиплеер', netMode() === 'online' ? 'до 16 игроков онлайн' : 'P2P по интернету, до 16 игроков', () => { ctl.screen = 'lobby'; ctl.bump(); }],
    ['Настройки', 'звук, сеть, управление', onSettings],
  ];
  return (
    <div class="screen menu">
      <div class="menu-side">
        <div>
          <h1 class="logo"><span class="ww">W</span>ORLD<br /><span class="ww">W</span>IDE</h1>
          <p class="tagline" style={{ marginTop: 16 }}>Мир на пороге десятилетия потрясений</p>
        </div>
        <nav class="menu-items" aria-label="Главное меню">
          {items.map(([t, s, f], i) => (
            <button class="menu-item" onMouseEnter={() => audio.ui('hover')} onClick={click(f)} key={t}>
              <span class="idx">0{i + 1}</span><span>{t} <small>{s}</small></span>
            </button>
          ))}
        </nav>
        <div class="menu-foot">
          ЛКМ — выбор · ПКМ — приказ · Alt+клик — удар по врагу · Shift+drag — рамка · двойной клик — приблизить<br />
          Колесо — масштаб · WASD — камера · Пробел — пауза · 1–5 — скорость · O — командование · F — фокусы · R — наука
        </div>
      </div>
    </div>
  );
}

function useCountries() {
  return useMemo(() => {
    const defs = countryDefs();
    const list: CountryDef[] = [];
    for (const id of ctl.world.byCountry.keys()) { const d = defs.get(id); if (d && id !== '010') list.push(d); }
    return list.sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || b.gdp - a.gdp);
  }, []);
}

function CountryList({ selected, onPick, taken }: { selected: string | null; onPick: (id: string) => void; taken?: Map<string, string> }) {
  const all = useCountries();
  const [q, setQ] = useState('');
  const list = q ? all.filter((d) => d.name.toLowerCase().includes(q.toLowerCase())) : all;
  const tiers: Tier[] = ['S', 'A', 'B', 'C', 'D'];
  return (
    <>
      <div style={{ padding: '8px 16px' }}><input type="search" placeholder="Поиск страны…" aria-label="Поиск страны" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} style={{ width: '100%' }} /></div>
      <div class="country-list">
        {tiers.map((t) => {
          const items = list.filter((d) => d.tier === t);
          if (!items.length) return null;
          return (
            <div key={t}>
              <div class="tier-head"><span class="tier-badge">{t}</span><span class="caps">{TIER_NAME[t]}</span><span class="dim tiny" style={{ marginLeft: 'auto' }}>{items.length}</span></div>
              {items.slice(0, t === 'D' && !q ? 80 : 400).map((d) => (
                <button class={`country-row${selected === d.id ? ' sel' : ''}`} onClick={() => onPick(d.id)} key={d.id}>
                  <span class="swatch" style={{ background: d.color }} />
                  <span class="grow">{d.name}</span>
                  {taken?.get(d.id) ? <span class="taken">{taken.get(d.id)}</span> : <span class="mono dim tiny">{money(d.gdp)}</span>}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

function CountryCard({ id }: { id: string | null }) {
  if (!id) return <div class="panel-body muted">Выберите страну на глобусе или в списке.</div>;
  const d = countryDefs().get(id);
  if (!d) return null;
  const units = ['Пехота', 'Танки', 'Арта', 'ПВО', 'Дроны', 'ВВС', 'Флот', 'Спецназ'];
  const res = ['Нефть', 'Газ', 'Уран', 'Сталь', 'Редкозем.', 'Еда'];
  const diff = d.tier === 'S' ? 'Лёгкая' : d.tier === 'A' ? 'Средняя' : d.tier === 'B' ? 'Средняя' : d.tier === 'C' ? 'Сложная' : 'Хардкор';
  return (
    <div class="panel-body col" style={{ gap: 12 }}>
      <div class="row"><span class="swatch" style={{ background: d.color, width: 18, height: 18 }} /><span class="caps">Тир {d.tier} · {diff}</span></div>
      <h2 class="big-name">{d.name}</h2>
      {d.leader && <div class="muted small">Лидер: {d.leader}{d.capital ? ` · Столица: ${d.capital.name}` : ''}</div>}
      <div class="grid2">
        <div class="stat"><b>{money(d.gdp)}</b><span>ВВП 2020</span></div>
        <div class="stat"><b>{people(d.pop)}</b><span>Население</span></div>
        <div class="stat"><b>{money(d.mil)}</b><span>Военный бюджет</span></div>
        <div class="stat"><b>{d.nukes ? d.nukes.toLocaleString('ru') : '—'}</b><span>Ядерные боеголовки</span></div>
        <div class="stat"><b>{d.tech}/10</b><span>Технологии</span></div>
        <div class="stat"><b>{d.stability}</b><span>Стабильность</span></div>
      </div>
      <div>
        <h3 class="sub">Вооружённые силы</h3>
        <div class="grid3">{d.army.map((n, i) => <div class="kv small" key={i}><span>{units[i]}</span><span>{n}</span></div>)}</div>
      </div>
      <div>
        <h3 class="sub">Ресурсы</h3>
        {d.res.map((v, i) => (
          <div class="row small" key={i} style={{ marginBottom: 4 }}><span style={{ width: 80 }} class="muted">{res[i]}</span><div class="bar grow"><i style={{ width: `${v * 10}%` }} /></div></div>
        ))}
      </div>
      {d.alliances.length > 0 && <div class="row wrap">{d.alliances.map((a) => <span class="chip" key={a} style={{ borderColor: ALLIANCE_INFO[a]?.color }}>{ALLIANCE_INFO[a]?.name ?? a}</span>)}</div>}
    </div>
  );
}

function SettingsForm({ s, set, disabled }: { s: GameSettings; set: (p: Partial<GameSettings>) => void; disabled?: boolean }) {
  return (
    <div class="col">
      <h3 class="sub">Сценарий</h3>
      <div class="row">
        <button class={`btn sm${s.mode === 'campaign' ? ' on' : ''}`} disabled={disabled} onClick={() => set({ mode: 'campaign' })}>Кампания 2020+</button>
        <button class={`btn sm${s.mode === 'sandbox' ? ' on' : ''}`} disabled={disabled} onClick={() => set({ mode: 'sandbox', historical: false })}>Песочница</button>
      </div>
      <label class="row small"><input type="checkbox" checked={s.historical} disabled={disabled || s.mode === 'sandbox'} onChange={(e) => set({ historical: (e.target as HTMLInputElement).checked })} /> Исторические боты (следуют реальным событиям)</label>
      <h3 class="sub">Сложность ботов</h3>
      <div class="row wrap">
        {(['easy', 'normal', 'hard'] as const).map((d) => <button key={d} class={`btn sm${s.difficulty === d ? ' on' : ''}`} disabled={disabled} onClick={() => set({ difficulty: d })}>{{ easy: 'Лёгкая', normal: 'Средняя', hard: 'Сложная' }[d]}</button>)}
      </div>
    </div>
  );
}

export function CountrySelect() {
  const c = useCtl();
  const [settings, setSettings] = useState<GameSettings>({ mode: 'campaign', difficulty: 'normal', historical: true });
  const pick = (id: string) => {
    ctl.inspectCountry = id;
    ctl.paintPolitical(id);
    const d = countryDefs().get(id);
    if (d?.capital) ctl.engine.controls.flyTo(d.capital.lat, d.capital.lon, 1.1);
    audio.ui('select');
    ctl.bump();
  };
  const start = () => {
    const id = ctl.inspectCountry;
    if (!id) return;
    audio.unlock();
    audio.ui('confirm');
    const state = createGame(ctl.world, settings, Math.floor(Math.random() * 1e9));
    state.countries[id].player = ctl.playerId;
    state.players[ctl.playerId] = { name: ctl.playerName, country: id, color: state.countries[id].color };
    const sim = createSim(ctl.world, state);
    ctl.attach(sim, new SoloSession(sim, id), id);
    audio.startMusic();
  };
  return (
    <div class="select-wrap">
      <div class="panel">
        <div class="panel-head"><h2 class="panel-title">Выбор страны</h2><button class="btn sm ghost" onClick={click(() => { ctl.screen = 'menu'; ctl.inspectCountry = null; ctl.paintPolitical(null); ctl.bump(); })}>← Назад</button></div>
        <CountryList selected={c.inspectCountry} onPick={pick} />
      </div>
      <div class="center-hint">Кликните по стране на глобусе</div>
      <div class="panel">
        <div class="panel-head"><h2 class="panel-title">Досье</h2></div>
        <div style={{ flex: 1, overflow: 'auto' }}><CountryCard id={c.inspectCountry} /></div>
        <div class="panel-body" style={{ borderTop: '1px solid var(--line)' }}>
          <SettingsForm s={settings} set={(p) => setSettings({ ...settings, ...p })} />
          <button class="btn primary lg" style={{ width: '100%', marginTop: 16 }} disabled={!c.inspectCountry} onClick={start}>Начать — 1 января 2020</button>
        </div>
      </div>
    </div>
  );
}

// ================================================================================================ multiplayer
export function Lobby() {
  const c = useCtl();
  const [browser] = useState(() => new LobbyBrowser());
  const [, force] = useState(0);
  const [room, setRoom] = useState<HostSession | ClientSession | null>(null);
  const [name, setName] = useState(ctl.playerName);
  const [roomName, setRoomName] = useState(`Штаб ${ctl.playerName}`);
  const [joinCode, setJoinCode] = useState('');
  const [chat, setChat] = useState('');
  useEffect(() => { browser.onChange = () => force((x) => x + 1); return () => browser.close(); }, []);
  useEffect(() => {
    if (!room) return;
    const t = window.setInterval(() => { room.update(0.25); force((x) => x + 1); }, 250);
    return () => window.clearInterval(t);
  }, [room]);

  const saveName = () => { ctl.playerName = name.trim() || 'Командир'; localStorage.setItem('ww.name', ctl.playerName); };
  const begin = (sim: NonNullable<HostSession['sim']>, session: HostSession | ClientSession) => {
    ctl.attach(sim, session, session.me);
    audio.startMusic();
  };
  const host = () => {
    saveName();
    const h = new HostSession(ctl.world, ctl.playerId, ctl.playerName, roomName, { mode: 'campaign', difficulty: 'normal', historical: true }, true);
    h.onLobby = () => force((x) => x + 1);
    h.onStart = (sim) => begin(sim, h);
    h.onError = (t) => ctl.toast(t, 'error');
    setRoom(h);
    audio.ui('confirm');
  };
  const join = (code: string) => {
    saveName();
    const cl = new ClientSession(ctl.world, ctl.playerId, ctl.playerName, code, true);
    cl.onLobby = () => force((x) => x + 1);
    cl.onStart = (sim) => begin(sim, cl);
    cl.onError = (t) => ctl.toast(t, 'error');
    setRoom(cl);
    audio.ui('confirm');
  };
  const leave = () => { room?.leave(); setRoom(null); ctl.paintPolitical(null); };
  const lobby: LobbyInfo | null = room ? (room instanceof HostSession ? room.lobby : room.lobby) : null;
  const myPick = room?.me ?? null;
  const taken = new Map<string, string>((lobby?.players ?? []).filter((p) => p.country).map((p) => [p.country!, p.name]));

  if (!room) {
    const rooms = [...browser.rooms.values()].filter((r) => !r.started);
    return (
      <div class="select-wrap" style={{ gridTemplateColumns: '440px 1fr 360px' }}>
        <div class="panel">
          <div class="panel-head"><h2 class="panel-title">Мультиплеер</h2><button class="btn sm ghost" onClick={click(() => { ctl.screen = 'menu'; ctl.bump(); })}>← Назад</button></div>
          <div class="panel-body col">
            <label class="col small"><span class="caps">Позывной</span><input type="text" value={name} maxLength={20} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
            <div class="small muted">{netMode() === 'online' ? `Онлайн через Supabase · ${new URL(supabaseConfig()!.url).hostname}` : 'Онлайн: браузеры соединяются напрямую (P2P) — знакомство через публичные релеи. Хосту достаточно сообщить код комнаты.'}</div>
            <form class="row" onSubmit={(e) => { e.preventDefault(); const v = joinCode.trim().toUpperCase(); if (v.length >= 4) join(v); }}>
              <input type="text" class="grow mono" placeholder="Код комнаты" maxLength={8} value={joinCode} onInput={(e) => setJoinCode((e.target as HTMLInputElement).value.toUpperCase())} />
              <button class="btn sm" type="submit">Войти</button>
            </form>
          </div>
          <div class="panel-head" style={{ borderTop: '1px solid var(--line)' }}><h3 class="panel-title" style={{ fontSize: 13 }}>Открытые комнаты</h3><span class="mono dim tiny">{rooms.length}</span></div>
          <div class="country-list">
            {rooms.length === 0 && <div class="panel-body muted small">Комнат поблизости нет. Чтобы играть через интернет — создайте комнату и отправьте другу её код, либо введите код выше.</div>}
            {rooms.map((r) => (
              <button class="country-row" key={r.code} onClick={() => join(r.code)}>
                <span class="tier-badge" style={{ width: 'auto', padding: '0 6px' }}>{r.code}</span>
                <span class="grow">{r.name}</span>
                <span class="mono dim tiny">{r.players.length}/{r.max}</span>
              </button>
            ))}
          </div>
        </div>
        <div />
        <div class="panel">
          <div class="panel-head"><h2 class="panel-title">Создать комнату</h2></div>
          <div class="panel-body col">
            <label class="col small"><span class="caps">Название</span><input type="text" value={roomName} maxLength={32} onInput={(e) => setRoomName((e.target as HTMLInputElement).value)} /></label>
            <button class="btn primary lg" onClick={host}>Создать и стать хостом</button>
            <p class="small muted" style={{ lineHeight: 1.6 }}>Хост считает симуляцию и рассылает состояние игрокам напрямую по P2P (WebRTC). Друзья подключаются по коду комнаты из любой точки мира — сервер не нужен. До 16 игроков, остальные страны под управлением ИИ.</p>
          </div>
        </div>
      </div>
    );
  }

  const isHost = room instanceof HostSession;
  return (
    <div class="select-wrap">
      <div class="panel">
        <div class="panel-head"><h2 class="panel-title">Выбор страны</h2><span class="mono accent">{room.code}</span></div>
        <CountryList selected={myPick ?? c.inspectCountry} taken={taken} onPick={(id) => { if (taken.has(id) && id !== myPick) return; room.pick(id); ctl.inspectCountry = id; ctl.paintPolitical(id); const d = countryDefs().get(id); if (d?.capital) ctl.engine.controls.flyTo(d.capital.lat, d.capital.lon, 1.2); audio.ui('select'); }} />
      </div>
      <div class="center-hint">{lobby?.name}</div>
      <div class="panel">
        <div class="panel-head"><h2 class="panel-title">Штаб</h2><button class="btn sm ghost" onClick={click(leave)}>Выйти</button></div>
        <div class="panel-body col" style={{ flex: 1 }}>
          <h3 class="sub">Игроки · {lobby?.players.length ?? 0}/16</h3>
          {(lobby?.players ?? []).map((p) => {
            const d = p.country ? countryDefs().get(p.country) : null;
            return (
              <div class="row small" key={p.pid}>
                <span class="swatch" style={{ background: d?.color ?? '#333' }} />
                <span class="grow">{p.name}{p.host ? ' ★' : ''}</span>
                <span class={d ? '' : 'dim'}>{d?.name ?? 'выбирает…'}</span>
              </div>
            );
          })}
          {!lobby && <div class="muted small">Подключение к комнате…</div>}
          <div class="section">
            {lobby && <SettingsForm s={lobby.settings} disabled={!isHost} set={(p) => (room as HostSession).setSettings(p)} />}
          </div>
          <div class="col">
            <div class="chat-log" style={{ maxHeight: 120, padding: 0 }}>{room.chatLog.map((m, i) => <div key={i}><b>{m.name}:</b> {m.text}</div>)}</div>
            <form class="row" onSubmit={(e) => { e.preventDefault(); if (chat.trim()) { room.chat(chat.trim(), 'all'); setChat(''); } }}>
              <input type="text" class="grow" placeholder="Сообщение…" value={chat} onInput={(e) => setChat((e.target as HTMLInputElement).value)} />
            </form>
          </div>
        </div>
        <div class="panel-body" style={{ borderTop: '1px solid var(--line)' }}>
          {isHost
            ? <button class="btn primary lg" style={{ width: '100%' }} disabled={!myPick} onClick={() => { audio.unlock(); (room as HostSession).start(); }}>Начать игру</button>
            : <div class="muted small">{myPick ? 'Ожидание запуска хостом…' : 'Выберите страну'}</div>}
        </div>
      </div>
    </div>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  return (
    <div class="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="panel event" role="dialog" aria-modal="true" aria-label="Настройки">
        <div class="panel-head"><h2 class="panel-title">Настройки</h2><button class="btn sm ghost" onClick={click(onClose)} aria-label="Закрыть">✕</button></div>
        <div class="panel-body"><SettingsBody inGame={false} /></div>
      </div>
    </div>
  );
}
