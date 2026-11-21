import type { JSX } from 'preact';
import type { GameState, SoldierState } from '../core/types';
import { WEAPONS } from '../sim/weapons';

/**
 * Minimal HUD. No health bar in the shooter sense, no minimap, no names —
 * a soldier knows how badly he's hit, not a number. Ammo, stance and the wave
 * clock are all the interface you get.
 */

export interface FeedItem {
  id: number;
  text: string;
  t: number;
}

const fmtClock = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const compass = (yaw: number) => {
  const dirs = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  const deg = ((-yaw * 180) / Math.PI + 360) % 360;
  // yaw 0 looks toward +Z, which we call south on this map
  const idx = Math.round(((deg + 180) % 360) / 45) % 8;
  return dirs[idx];
};

export function Hud(props: {
  s: GameState;
  me: SoldierState | null;
  feed: FeedItem[];
  banner: { title: string; sub?: string } | null;
  hint: string | null;
  hitmark: boolean;
  ads: number;
}): JSX.Element {
  const { s, me, feed, banner, hint, hitmark } = props;
  const hp = me ? me.hp / me.maxHp : 1;
  const stam = me ? me.stamina / 100 : 1;
  const w = me ? WEAPONS[me.weapon] : null;
  const reloading = !!me && me.reloadingUntil > s.time;
  const low = !!me && me.hp < 34;
  const waveText = s.wave.active
    ? `ВОЛНА ${s.wave.index} · ОСТАЛОСЬ ${s.wave.remaining}`
    : s.phase === 'intro'
      ? 'ТИШИНА'
      : `ДО СЛЕДУЮЩЕЙ ВОЛНЫ ${Math.max(0, Math.ceil(s.wave.timer))} С`;

  const wound = me ? Math.max(0, 1 - me.hp / 45) : 0;

  return (
    <div class="hud" style={{ opacity: props.ads > 0.9 ? 0.45 : 1 }}>
      <div class={`hud-lowhp${wound > 0.1 && me?.alive ? ' on' : ''}`} style={{ opacity: Math.min(1, wound) }} />
      <div class="hud-compass">{compass(me ? -me.yaw : 0)}</div>
      <div class="hud-timer">{fmtClock(s.survived)}</div>
      <div class="hud-wave">{waveText}</div>

      <div class="hud-vitals">
        <div class="hud-label"><span>СОСТОЯНИЕ</span><span>{me ? Math.ceil(me.hp) : 0}</span></div>
        <div class={`hud-bar hp${low ? ' low' : ''}`}><i style={{ width: `${Math.max(0, hp * 100)}%` }} /></div>
        <div class="hud-label"><span>ДЫХАНИЕ</span></div>
        <div class="hud-bar stam"><i style={{ width: `${Math.max(0, stam * 100)}%` }} /></div>
      </div>

      <div class="hud-cross" style={{ opacity: 0.25 + (1 - props.ads) * 0.55 }}>
        <i /><i /><i /><i />
      </div>
      <div class={`hud-hitmark${hitmark ? ' on' : ''}`} />

      {w && me && (
        <>
          <div class={`hud-reload${reloading ? ' on' : ''}`}>ПЕРЕЗАРЯДКА</div>
          <div class="hud-ammo">
            <b class={me.ammo <= Math.ceil(w.mag * 0.25) ? 'low' : ''}>{me.ammo}</b>
            <span>/ {me.magSize}</span>
            <em>{w.name}</em>
          </div>
        </>
      )}

      <div class="hud-feed">
        {feed.slice(-5).map((f) => (
          <div key={f.id} dangerouslySetInnerHTML={{ __html: f.text }} />
        ))}
      </div>

      <div class={`hud-hint${hint ? ' on' : ''}`}>{hint ?? ''}</div>

      <div class={`hud-banner${banner ? ' on' : ''}`}>
        <h2>{banner?.title ?? ''}</h2>
        <p>{banner?.sub ?? ''}</p>
      </div>
    </div>
  );
}
