import { useState } from 'preact/hooks';
import { audio, type AudioSettings } from '../../audio/audio';
import { ctl } from '../../client/controller';
import { netMode } from '../../net/bus';
import { click } from '../util';

export function SettingsBody({ inGame }: { inGame: boolean }) {
  const [s, setS] = useState({ ...audio.settings });
  const [url, setUrl] = useState(localStorage.getItem('ww.sb.url') ?? '');
  const [key, setKey] = useState(localStorage.getItem('ww.sb.key') ?? '');
  const upd = (p: Partial<AudioSettings>) => { const n = { ...s, ...p }; setS(n); Object.assign(audio.settings, n); audio.unlock(); audio.apply(); };
  const vol: [keyof AudioSettings, string][] = [['master', 'Общая громкость'], ['music', 'Музыка'], ['sfx', 'Эффекты и взрывы'], ['ambient', 'Радиоэфир'], ['ui', 'Интерфейс']];
  return (
    <div class="col" style={{ gap: 0 }}>
      <div class="section col">
        <h3 class="sub">Звук</h3>
        {vol.map(([k, n]) => (
          <label class="col small" key={k} style={{ gap: 2 }}>
            <span class="row between"><span>{n}</span><span class="mono">{Math.round((s[k] as number) * 100)}</span></span>
            <input class="slider" type="range" min={0} max={100} value={(s[k] as number) * 100} onInput={(e) => upd({ [k]: +(e.target as HTMLInputElement).value / 100 })} />
          </label>
        ))}
        <label class="row small"><input type="checkbox" checked={s.muted} onChange={(e) => upd({ muted: (e.target as HTMLInputElement).checked })} /> Без звука</label>
      </div>
      <div class="section col">
        <h3 class="sub">Сеть · Supabase</h3>
        <span class="small muted">Режим: {netMode() === 'online' ? 'онлайн' : 'локальный (только вкладки этого браузера)'}. Ключи из сборки GitHub Pages подставляются автоматически; здесь можно задать свои.</span>
        <input type="text" placeholder="https://xxxx.supabase.co" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} aria-label="Supabase URL" />
        <input type="text" placeholder="anon public key" value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value)} aria-label="Supabase anon key" />
        <div class="row">
          <button class="btn sm" onClick={click(() => { localStorage.setItem('ww.sb.url', url.trim()); localStorage.setItem('ww.sb.key', key.trim()); location.reload(); })}>Сохранить и перезапустить</button>
          <button class="btn sm ghost" onClick={click(() => { localStorage.removeItem('ww.sb.url'); localStorage.removeItem('ww.sb.key'); location.reload(); })}>Сбросить</button>
        </div>
      </div>
      <div class="section col small">
        <h3 class="sub">Управление</h3>
        {[['ЛКМ', 'выбор провинции / войск'], ['Shift + перетаскивание', 'выделение рамкой'], ['Ctrl + ЛКМ', 'добавить к выделению'], ['ПКМ', 'приказ на движение / отмена наведения'], ['Колесо, Q/E', 'масштаб'], ['WASD / стрелки', 'камера'], ['Пробел', 'пауза'], ['1–5', 'скорость времени'], ['H', 'оборона'], ['Ctrl+A', 'выделить все войска'], ['Esc', 'сброс']].map(([k, v]) => (
          <div class="kv" key={k}><span>{k}</span><span>{v}</span></div>
        ))}
      </div>
      {inGame && (
        <div class="section"><button class="btn danger" onClick={click(() => { if (confirm('Выйти в главное меню? Прогресс одиночной игры будет потерян.')) { ctl.session?.leave(); location.reload(); } })}>Выйти в главное меню</button></div>
      )}
    </div>
  );
}
