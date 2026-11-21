import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import {
  INVENTIONS, buyInvention, nextLevelAt, ownedMod, profileLevel,
  type Profile,
} from '../core/profile';
import { PERKS } from '../sim/weapons';

export interface LobbySettings {
  seed: number;
  bots: number;
  difficulty: number;
  host: boolean;
  roomCode: string;
  sensitivity: number;
}

const randomSeed = () => Math.floor(Math.random() * 1_000_000);

export function Lobby(props: {
  profile: Profile;
  setProfile: (p: Profile) => void;
  settings: LobbySettings;
  setSettings: (s: LobbySettings) => void;
  onStart: () => void;
  onCutscene: () => void;
  onHost: () => void;
  onJoin: () => void;
  netStatus: string;
  peers: string[];
}): JSX.Element {
  const { profile, setProfile, settings, setSettings } = props;
  const [tab, setTab] = useState<'brief' | 'squad' | 'lab'>('brief');
  const lvl = profileLevel(profile);
  const next = nextLevelAt(profile);
  const need = Math.max(1, next - profile.xp);

  const buy = (id: string) => {
    const next = { ...profile, inventions: [...profile.inventions] };
    if (buyInvention(next, id)) setProfile(next);
  };

  return (
    <div class="overlay">
      <div class="menu">
        <div class="row" style={{ alignItems: 'flex-end' }}>
          <div>
            <div class="title">КОТЁЛ</div>
            <div class="subtitle">Зона ответственности · выживание малыми силами</div>
          </div>
          <div class="spacer" />
          <div style={{ textAlign: 'right', marginBottom: 8 }}>
            <div class="muted">УРОВЕНЬ {lvl}</div>
            <div class="muted">{profile.xp} / {next} ОПЫТА</div>
          </div>
        </div>

        <div class="row" style={{ gap: 0, marginBottom: 20 }}>
          {(['brief', 'squad', 'lab'] as const).map((t) => (
            <button
              class={`btn small${tab === t ? ' primary' : ''}`}
              style={{ width: 'auto', borderRight: 'none' }}
              onClick={() => setTab(t)}
            >
              {t === 'brief' ? 'Задание' : t === 'squad' ? ' squad'.replace('squad', 'Отряд') : 'Полигон'}
            </button>
          ))}
        </div>

        {tab === 'brief' && (
          <div class="grid2">
            <div>
              <p class="muted" style={{ marginBottom: 18, fontSize: 12, lineHeight: 1.9 }}>
                Борт сбит над лесополосой. Вокруг — брошенные дачи, окопы и пустые
                пятиэтажки. Снабжение прилетает редко. Держитесь, пока не подойдёт
                подкрепление, которого, скорее всего, не будет.
              </p>
              <div class="field">
                <label>Сложность</label>
                <select
                  value={settings.difficulty}
                  onChange={(e) => setSettings({ ...settings, difficulty: Number((e.target as HTMLSelectElement).value) })}
                >
                  <option value={0.75}>Разведка боем</option>
                  <option value={1}>Штурм</option>
                  <option value={1.35}>Мясорубка</option>
                </select>
              </div>
              <div class="field">
                <label>Карта · зерно</label>
                <div class="row">
                  <input
                    type="number"
                    value={settings.seed}
                    onInput={(e) => setSettings({ ...settings, seed: Number((e.target as HTMLInputElement).value) || 1 })}
                  />
                  <button class="btn small" onClick={() => setSettings({ ...settings, seed: randomSeed() })}>Случайная</button>
                </div>
              </div>
            </div>
            <div>
              <div class="field">
                <label>Сенсорность мыши</label>
                <input
                  type="number"
                  step="0.05"
                  min="0.2"
                  max="3"
                  value={settings.sensitivity}
                  onInput={(e) => setSettings({ ...settings, sensitivity: Number((e.target as HTMLInputElement).value) || 1 })}
                />
              </div>
              <div class="field">
                <label>Свой отряд</label>
                <div class="row" style={{ gap: 18 }}>
                  <label class="toggle">
                    <input
                      type="checkbox"
                      checked={settings.bots > 0}
                      onChange={(e) => setSettings({ ...settings, bots: (e.target as HTMLInputElement).checked ? 2 : 0 })}
                    />
                    <i />ИИ-бойцы в отряде
                  </label>
                </div>
                {settings.bots > 0 && (
                  <div class="row" style={{ marginTop: 10 }}>
                    {[1, 2, 3].map((n) => (
                      <button
                        class={`btn small${settings.bots === n ? ' primary' : ''}`}
                        onClick={() => setSettings({ ...settings, bots: n })}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button class="btn primary" style={{ marginTop: 6 }} onClick={props.onStart}>
                {props.netStatus.includes('открыта') ? 'Начать бой · ждём отряд' : 'Начать бой'}
              </button>
              <button class="btn" style={{ marginTop: 10 }} onClick={props.onCutscene}>Смотреть вступление</button>
            </div>
          </div>
        )}

        {tab === 'squad' && (
          <div class="grid2">
            <div>
              <div class="field">
                <label>Пригласить друзей · до 6 бойцов</label>
                <div class="row">
                  <input
                    type="text"
                    placeholder="код комнаты"
                    value={settings.roomCode}
                    onInput={(e) => setSettings({ ...settings, roomCode: (e.target as HTMLInputElement).value.toUpperCase().slice(0, 6) })}
                  />
                  <button
                    class="btn small"
                    onClick={() => {
                      const code = /^[A-Z0-9]{4,6}$/.test(settings.roomCode) ? settings.roomCode : randomCode();
                      setSettings({ ...settings, host: true, roomCode: code });
                      props.onHost();
                    }}
                  >
                    Создать
                  </button>
                  <button
                    class="btn small"
                    disabled={settings.roomCode.length < 4}
                    onClick={() => { setSettings({ ...settings, host: false }); props.onJoin(); }}
                  >
                    Войти
                  </button>
                </div>
              </div>
              <p class="muted">
                Прямое P2P-соединение. Хост считает бой, остальные получают
                состояние и отправляют только нажатия. Никакого сервера, кроме
                сигнального. {props.netStatus}
              </p>
            </div>
            <div>
              <div class="lobby-list">
                {Array.from({ length: 6 }).map((_, i) => {
                  const name = i === 0 ? (settings.host ? 'ВЫ · ХОСТ' : 'ВЫ') : props.peers[i - 1];
                  return (
                    <div class={`lobby-slot${name ? ' filled' : ''}`}>
                      <span><span class="dot" />{name ?? 'свободный слот'}</span>
                      <span class="muted">{i === 0 ? 'командир' : name ? 'на связи' : '—'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {tab === 'lab' && (
          <div>
            <div class="statline">
              <div><b>{profile.totalKills}</b><span>уничтожено</span></div>
              <div><b>{profile.runs}</b><span>боёв</span></div>
              <div><b>{profile.bestSurvived.toFixed(0)}</b><span>секунд в лучшем</span></div>
              <div><b>{lvl}</b><span>уровень</span></div>
            </div>
            <div class="field" style={{ marginTop: 22 }}>
              <label>Боевые навыки</label>
              <div class="perklist">
                {PERKS.map((p) => (
                  <span class={`chip${p.at <= lvl ? ' on' : ''}`} title={p.desc}>
                    {p.name} · {p.at}
                  </span>
                ))}
              </div>
            </div>
            <div class="field">
              <label>Изобретения · {need} опыта до следующего уровня</label>
              <div class="grid2">
                {INVENTIONS.map((inv) => {
                  const owned = profile.inventions.includes(inv.id);
                  const can = !owned && lvl >= inv.cost;
                  return (
                    <div style={{ border: '1px solid var(--line)', padding: 12 }}>
                      <div class="row">
                        <b style={{ fontWeight: 400, fontSize: 12, letterSpacing: '0.1em' }}>{inv.name}</b>
                        <div class="spacer" />
                        <span class="muted">{owned ? 'есть' : `уровень ${inv.cost}`}</span>
                      </div>
                      <p class="muted" style={{ margin: '8px 0 10px' }}>{inv.desc}</p>
                      <button class="btn small" disabled={!can} onClick={() => buy(inv.id)}>
                        {owned ? 'Установлено' : can ? 'Собрать' : 'Нужен уровень'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            <p class="muted">
              Изобретения действуют сразу: {ownedMod(profile, 'magBonus') > 0 ? `+${Math.round(ownedMod(profile, 'magBonus') * 100)}% магазин · ` : ''}
              {ownedMod(profile, 'startHp') > 0 ? `+${ownedMod(profile, 'startHp')} здоровье · ` : ''}
              {ownedMod(profile, 'regen') > 0 ? `+${ownedMod(profile, 'regen')} бинт · ` : ''}
              {profile.inventions.length === 0 ? 'пока ничего не собрано' : ''}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function randomCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => a[Math.floor(Math.random() * a.length)]).join('');
}
