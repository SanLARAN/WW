import type { GameState } from './types';
import type { Sim } from './sim';
import { gzipJson, gunzipJson } from '../net/peer';

/**
 * Saves live in localStorage as gzip+base64 blobs. A full 3023-province world is
 * ~250-400 KB packed, which is comfortable for a few slots. Nothing here imports
 * the renderer, so the same code runs in the headless tests.
 */

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  key?(i: number): string | null;
  readonly length?: number;
}

const memory = new Map<string, string>();
const memoryStorage: StorageLike = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
  key: (i) => [...memory.keys()][i] ?? null,
  get length() { return memory.size; },
};

let store: StorageLike = (() => {
  try { if (typeof localStorage !== 'undefined') { localStorage.getItem('ww.probe'); return localStorage; } } catch { /* private mode */ }
  return memoryStorage;
})();

/** Swap the backing store (tests, or a future IndexedDB adapter). */
export function setSaveStorage(s: StorageLike) { store = s; }

export interface SaveMeta {
  slot: string;
  country: string;
  countryName: string;
  tick: number;
  date: string;
  gdp: number;
  score: number;
  alive: boolean;
  savedAt: number;
}

export const SLOTS = ['auto', '1', '2', '3'] as const;
const key = (slot: string) => `ww.save.${slot}`;

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const START = Date.UTC(2020, 0, 1);
export function saveDate(tick: number) {
  const d = new Date(START + tick * 3600_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface SavePayload { v: number; meta: SaveMeta; state: GameState }

/** Persist the authoritative state. Returns the meta written. */
export async function writeSave(slot: string, sim: Sim, me: string | null, score: number): Promise<SaveMeta> {
  const c = me ? sim.s.countries[me] : null;
  const meta: SaveMeta = {
    slot, country: me ?? '', countryName: c?.name ?? 'Наблюдатель', tick: sim.s.tick,
    date: saveDate(sim.s.tick), gdp: c?.gdp ?? 0, score, alive: !!c?.alive, savedAt: Date.now(),
  };
  const state = sim.s;
  const z = await gzipJson(state);
  store.setItem(key(slot), JSON.stringify({ v: 1, meta, z }));
  return meta;
}

/** Read just the header of a slot without paying for decompression. */
export function readMeta(slot: string): SaveMeta | null {
  const raw = store.getItem(key(slot));
  if (!raw) return null;
  try { return (JSON.parse(raw) as { meta: SaveMeta }).meta; } catch { return null; }
}

export async function readSave(slot: string): Promise<SavePayload | null> {
  const raw = store.getItem(key(slot));
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { v: number; meta: SaveMeta; z: string };
    const state = await gunzipJson<GameState>(p.z);
    // Tolerate saves from older builds: fill in fields added since.
    return { v: p.v, meta: p.meta, state: migrate(state) };
  } catch (e) {
    console.warn('[save] read failed', slot, e);
    return null;
  }
}

export function hasSave(slot: string) { return store.getItem(key(slot)) !== null; }
export function deleteSave(slot: string) { store.removeItem(key(slot)); }

export function listSaves(): SaveMeta[] {
  return SLOTS.map((s) => readMeta(s)).filter((m): m is SaveMeta => !!m).sort((a, b) => b.savedAt - a.savedAt);
}

/** Newest playable save — what the "Продолжить" button loads. */
export function latestSave(): SaveMeta | null {
  return listSaves().find((m) => m.alive) ?? null;
}

/** Fill fields introduced by later versions so old saves keep working. */
export function migrate(s: GameState): GameState {
  for (const c of Object.values(s.countries ?? {})) {
    c.doctrine ??= '';
    c.doctrinePaid ??= 0;
    c.unlockPoints ??= 0;
    c.unlocks ??= [];
    c.modifiers ??= {};
    c.flags ??= [];
  }
  s.fired ??= [];
  s.pending ??= [];
  s.missiles ??= [];
  return s;
}

// ------------------------------------------------------------------------------- campaign stats (for the menu)
export function describeSave(m: SaveMeta): string {
  return `${m.countryName} · ${m.date} · ВВП $${m.gdp.toFixed(0)} млрд · ${m.score} оч.`;
}
