import { useEffect, useState } from 'preact/hooks';
import { ctl } from '../client/controller';
import { audio } from '../audio/audio';

/** Re-render on every controller bump (throttled by the controller to ~5 Hz). */
export function useCtl() {
  const [, set] = useState(0);
  useEffect(() => ctl.subscribe(() => set((x) => x + 1)), []);
  return ctl;
}

export const money = (bn: number) => {
  const a = Math.abs(bn), s = bn < 0 ? '−' : '';
  if (a >= 1000) return `${s}$${(a / 1000).toFixed(a >= 10000 ? 1 : 2)} трлн`;
  if (a >= 1) return `${s}$${a.toFixed(a >= 100 ? 0 : 1)} млрд`;
  return `${s}$${(a * 1000).toFixed(0)} млн`;
};
export const num = (v: number, d = 0) => v.toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d });
export const pct = (v: number, d = 0) => `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(d)}%`;
export const people = (mln: number) => (mln >= 1 ? `${num(mln, mln >= 100 ? 0 : 1)} млн` : `${num(mln * 1000, 0)} тыс.`);
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const fmtDate = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
export const fmtTime = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:00 UTC`;

export const click = (f: () => void) => () => { audio.unlock(); audio.ui('click'); f(); };
