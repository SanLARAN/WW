import { W, H, AUX_W, AUX_H, NAV_W, NAV_H, Terrain, type WorldGenOutput } from './worldTypes';
import { cities, type City } from '../data/cities';
import { HOTSPOTS, type ResourceKey } from '../data/resources';
import { NAMES } from '../data/names';
import { distKm } from '../core/geo';

export interface Province {
  id: number; // index into world.provinces
  country: string; // original owner tag (de jure)
  name: string;
  lat: number;
  lon: number;
  area: number;
  terrain: Terrain;
  coastal: boolean;
  elev: number;
  light: number;
  neighbors: number[];
  city?: City;
  resources: Partial<Record<ResourceKey, number>>;
  /** share of the country's population living here */
  popShare: number;
}

export class World {
  readonly prov: Uint16Array;
  readonly ctry: Uint8Array;
  readonly nav: Uint8Array;
  readonly tags: string[];
  readonly provinces: Province[] = [];
  readonly byCountry = new Map<string, number[]>();

  constructor(o: WorldGenOutput) {
    this.prov = o.prov; this.ctry = o.ctry; this.nav = o.nav; this.tags = o.tags;
    const n = o.pLat.length;
    for (let i = 0; i < n; i++) {
      const neighbors = Array.from(o.adjList.subarray(o.adjOffsets[i], o.adjOffsets[i + 1]));
      const country = o.tags[o.pCountry[i]];
      this.provinces.push({
        id: i, country, name: '', lat: o.pLat[i], lon: o.pLon[i], area: o.pArea[i], terrain: o.pTerrain[i] as Terrain,
        coastal: !!o.pCoastal[i], elev: o.pElev[i], light: o.pLight[i], neighbors, resources: {}, popShare: 0,
      });
      let list = this.byCountry.get(country);
      if (!list) this.byCountry.set(country, (list = []));
      list.push(i);
    }
    this.assignCities();
    this.assignResources();
    this.assignPopulation();
  }

  provinceAt(lat: number, lon: number): number {
    const x = Math.min(W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * W)));
    const y = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
    return this.prov[y * W + x] - 1;
  }

  isLand(lat: number, lon: number) { return this.provinceAt(lat, lon) >= 0; }

  private assignCities() {
    const counters = new Map<string, number>();
    const best = new Map<number, City>();
    for (const c of cities()) {
      const p = this.provinceAt(c.lat, c.lon);
      if (p < 0) continue;
      const cur = best.get(p);
      if (!cur || cur.pop < c.pop) best.set(p, c);
    }
    for (const p of this.provinces) {
      const c = best.get(p.id);
      if (c) { p.city = c; p.name = c.name; continue; }
      const k = (counters.get(p.country) ?? 0) + 1;
      counters.set(p.country, k);
      p.name = `${NAMES[p.country] ?? p.country} — округ ${k}`;
    }
  }

  private assignResources() {
    for (const [res, lat, lon, radius, rich] of HOTSPOTS) {
      for (const p of this.provinces) {
        if (Math.abs(p.lat - lat) > radius / 100) continue;
        const d = distKm(p.lat, p.lon, lat, lon);
        if (d < radius) p.resources[res] = Math.max(p.resources[res] ?? 0, Math.ceil(rich * (1 - (d / radius) * 0.5)));
      }
    }
  }

  private assignPopulation() {
    for (const ids of this.byCountry.values()) {
      let total = 0;
      const w = ids.map((i) => {
        const p = this.provinces[i];
        const v = p.area * (0.02 + p.light * p.light * 3) + (p.city ? p.city.pop * 4e5 : 0);
        total += v;
        return v;
      });
      ids.forEach((i, k) => (this.provinces[i].popShare = total > 0 ? w[k] / total : 1 / ids.length));
    }
  }

  // --- Navigation -------------------------------------------------------------------------------
  private navCell(lat: number, lon: number) {
    const x = Math.min(NAV_W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * NAV_W)));
    const y = Math.min(NAV_H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * NAV_H)));
    return y * NAV_W + x;
  }

  private cellLatLon(c: number) {
    const x = c % NAV_W, y = (c / NAV_W) | 0;
    return { lat: 90 - ((y + 0.5) / NAV_H) * 180, lon: ((x + 0.5) / NAV_W) * 360 - 180 };
  }

  /** Province index at nav-cell centre, or -1 for water/uninhabited. */
  private cellProv(c: number): number {
    const x = c % NAV_W, y = (c / NAV_W) | 0;
    return this.prov[Math.min(H - 1, y * 4 + 2) * W + Math.min(W - 1, x * 4 + 2)] - 1;
  }

  /** A* on the nav grid. mask: 1 = land units, 2 = naval units. `ok` optionally vetoes cells by province (-1 = water). */
  findPath(lat1: number, lon1: number, lat2: number, lon2: number, mask: number, maxNodes = 60000, ok?: (p: number) => boolean): { lat: number; lon: number }[] | null {
    const start = this.navCell(lat1, lon1), goal = this.navCell(lat2, lon2);
    if (!(this.nav[goal] & mask)) return null;
    if (ok && !ok(this.cellProv(goal))) return null;
    if (start === goal) return [{ lat: lat2, lon: lon2 }];
    if (this.lineClear(lat1, lon1, lat2, lon2, mask, ok)) return [{ lat: lat2, lon: lon2 }];
    const g = new Map<number, number>(), came = new Map<number, number>();
    const heap = new MinHeap();
    const gy = (goal / NAV_W) | 0, gx = goal % NAV_W;
    const h = (c: number) => {
      const y = (c / NAV_W) | 0, x = c % NAV_W;
      let dx = Math.abs(x - gx); dx = Math.min(dx, NAV_W - dx);
      const cl = Math.cos(((90 - ((y + 0.5) / NAV_H) * 180) * Math.PI) / 180);
      return Math.hypot(dx * Math.max(cl, 0.2), y - gy);
    };
    g.set(start, 0); heap.push(start, h(start));
    let expanded = 0;
    while (heap.size) {
      const c = heap.pop();
      if (c === goal) break;
      if (++expanded > maxNodes) return null;
      const y = (c / NAV_W) | 0, x = c % NAV_W;
      const cl = Math.max(0.2, Math.cos(((90 - ((y + 0.5) / NAV_H) * 180) * Math.PI) / 180));
      const gc = g.get(c)!;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const ny = y + dy;
        if (ny < 0 || ny >= NAV_H) continue;
        const nx = (x + dx + NAV_W) % NAV_W, n = ny * NAV_W + nx;
        if (!(this.nav[n] & mask)) continue;
        if (ok && !ok(this.cellProv(n))) continue;
        const ng = gc + Math.hypot(dx * cl, dy);
        if (ng < (g.get(n) ?? Infinity)) { g.set(n, ng); came.set(n, c); heap.push(n, ng + h(n)); }
      }
    }
    if (!came.has(goal)) return null;
    const cells: number[] = [];
    for (let c = goal; c !== start; c = came.get(c)!) cells.push(c);
    cells.reverse();
    // String-pull: keep only waypoints needed for line-of-sight.
    const pts = cells.map((c) => this.cellLatLon(c));
    pts[pts.length - 1] = { lat: lat2, lon: lon2 };
    const out: { lat: number; lon: number }[] = [];
    let cur = { lat: lat1, lon: lon1 }, i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.lineClear(cur.lat, cur.lon, pts[j].lat, pts[j].lon, mask, ok)) j = Math.max(i, j - Math.max(1, ((j - i) / 4) | 0));
      out.push(pts[j]); cur = pts[j]; i = j + 1;
    }
    return out;
  }

  lineClear(lat1: number, lon1: number, lat2: number, lon2: number, mask: number, ok?: (p: number) => boolean): boolean {
    const d = distKm(lat1, lon1, lat2, lon2);
    const steps = Math.max(2, Math.ceil(d / 15));
    let dLon = lon2 - lon1;
    if (dLon > 180) dLon -= 360; else if (dLon < -180) dLon += 360;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const cell = this.navCell(lat1 + (lat2 - lat1) * t, lon1 + dLon * t);
      if (!(this.nav[cell] & mask)) return false;
      if (ok && !ok(this.cellProv(cell))) return false;
    }
    return true;
  }
}

class MinHeap {
  private k: number[] = []; private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, pri: number) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(pri);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= v[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p;
    }
  }
  pop(): number {
    const k = this.k, v = this.v, top = k[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < k.length && v[l] < v[m]) m = l;
        if (r < k.length && v[r] < v[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m;
      }
    }
    return top;
  }
}

// --- Loading ---------------------------------------------------------------------------------------
export const TEXTURES = {
  day: 'textures/earth-blue-marble.jpg',
  night: 'textures/earth-night.jpg',
  topo: 'textures/earth-topology.png',
  clouds: 'textures/clouds.png',
};

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Не удалось загрузить ' + src));
    img.src = src;
  });
}

function pixels(img: HTMLImageElement, w: number, h: number): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

function grey(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3;
  return out;
}

export interface LoadedWorld { world: World; images: { day: HTMLImageElement; night: HTMLImageElement; topo: HTMLImageElement } }

export async function loadWorld(onProgress: (msg: string, p: number) => void): Promise<LoadedWorld> {
  onProgress('Загрузка спутниковых снимков', 0);
  const [day, night, topo] = await Promise.all([loadImage(TEXTURES.day), loadImage(TEXTURES.night), loadImage(TEXTURES.topo)]);
  const input = {
    color: pixels(day, AUX_W, AUX_H),
    night: grey(pixels(night, AUX_W, AUX_H)),
    heights: grey(pixels(topo, AUX_W * 2, AUX_H * 2)),
  };
  const worker = new Worker(new URL('./worldgen.worker.ts', import.meta.url), { type: 'module' });
  const out = await new Promise<WorldGenOutput>((resolve, reject) => {
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') onProgress(e.data.msg, 0.1 + e.data.p * 0.85);
      else if (e.data.type === 'done') resolve(e.data.out);
    };
    worker.onerror = (e) => reject(new Error(e.message));
    worker.postMessage(input, [input.night.buffer, input.heights.buffer]);
  });
  worker.terminate();
  return { world: new World(out), images: { day, night, topo } };
}
