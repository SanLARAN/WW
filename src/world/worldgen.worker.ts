/// <reference lib="webworker" />
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import topoJson from 'world-atlas/countries-50m.json';
import { OWNER_OF, SYNTHETIC_IDS } from '../data/names';
import { mulberry32 } from '../core/rng';
import { W, H, AUX_W, NAV_W, NAV_H, Terrain, type WorldGenInput, type WorldGenOutput } from './worldTypes';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const PIXEL_KM2 = (40030 / W) * (20015 / H);

ctx.onmessage = (e: MessageEvent<WorldGenInput>) => {
  const out = generate(e.data, (msg, p) => ctx.postMessage({ type: 'progress', msg, p }));
  const transfer = [
    out.prov.buffer, out.ctry.buffer, out.nav.buffer, out.pLat.buffer, out.pLon.buffer, out.pArea.buffer,
    out.pCountry.buffer, out.pTerrain.buffer, out.pCoastal.buffer, out.pElev.buffer, out.pLight.buffer,
    out.adjOffsets.buffer, out.adjList.buffer,
  ] as ArrayBuffer[];
  ctx.postMessage({ type: 'done', out }, transfer);
};

interface Poly { country: number; rings: number[][][]; pixels: number; seeds: number[] }

function generate(input: WorldGenInput, progress: (m: string, p: number) => void): WorldGenOutput {
  progress('Загрузка границ', 0.05);
  const topo = topoJson as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  const fc = feature(topo, topo.objects.countries) as unknown as { features: Feature<Polygon | MultiPolygon, { name: string }>[] };

  const tags: string[] = [''];
  const tagIndex = new Map<string, number>();
  const polys: Poly[] = [];
  for (const f of fc.features) {
    const raw = (f.id as string | undefined) ?? SYNTHETIC_IDS[f.properties.name] ?? f.properties.name;
    const owner = OWNER_OF[raw] ?? raw;
    let ci = tagIndex.get(owner);
    if (ci === undefined) { ci = tags.length; tags.push(owner); tagIndex.set(owner, ci); }
    const g = f.geometry;
    if (!g) continue;
    const list = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const rings of list) polys.push({ country: ci, rings: rings as number[][][], pixels: 0, seeds: [] });
  }

  progress('Растеризация карты', 0.12);
  const polyR = new Uint16Array(W * H);
  polys.forEach((p, i) => rasterize(p.rings, i + 1, polyR));

  const ctry = new Uint8Array(W * H);
  const cosLat = new Float32Array(H), sinLat = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const lat = (90 - ((y + 0.5) / H) * 180) * (Math.PI / 180);
    cosLat[y] = Math.cos(lat); sinLat[y] = Math.sin(lat);
  }
  const cosLon = new Float32Array(W), sinLon = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const lon = (((x + 0.5) / W) * 360 - 180) * (Math.PI / 180);
    cosLon[x] = Math.cos(lon); sinLon[x] = Math.sin(lon);
  }

  // Pixel lists per polygon (counting sort).
  const counts = new Uint32Array(polys.length + 2);
  for (let i = 0; i < polyR.length; i++) if (polyR[i]) counts[polyR[i]]++;
  const offs = new Uint32Array(polys.length + 2);
  for (let i = 1; i <= polys.length + 1; i++) offs[i] = offs[i - 1] + counts[i - 1];
  const fill = offs.slice();
  const pix = new Uint32Array(offs[polys.length + 1]);
  for (let i = 0; i < polyR.length; i++) {
    const p = polyR[i];
    if (p) { pix[fill[p]++] = i; ctry[i] = polys[p - 1].country; }
  }

  const density = (i: number) => {
    const x = i % W, y = (i / W) | 0;
    return 0.12 + input.night[((y >> 2) * AUX_W) + (x >> 2)] / 255;
  };

  // Seed allocation per polygon.
  progress('Нарезка провинций', 0.25);
  const rng = mulberry32(20200101);
  const seedPix: number[] = [];
  const seedPoly: number[] = [];
  const countryHasSeed = new Uint8Array(tags.length);
  const polyArea = polys.map((_, pi) => {
    let a = 0;
    for (let k = offs[pi + 1]; k < offs[pi + 2]; k++) a += cosLat[(pix[k] / W) | 0];
    return a * PIXEL_KM2;
  });
  const order = polys.map((_, i) => i).sort((a, b) => polyArea[b] - polyArea[a]);
  for (const pi of order) {
    const p = polys[pi], n0 = offs[pi + 1], n1 = offs[pi + 2];
    p.pixels = n1 - n0;
    if (!p.pixels) continue;
    const area = polyArea[pi];
    const isAntarctica = tags[p.country] === '010';
    let n = area >= 2500 ? Math.max(1, Math.round(Math.sqrt(area) / 42)) : 0;
    if (isAntarctica) n = area > 1e6 ? 6 : 0;
    if (!n && !countryHasSeed[p.country]) n = 1;
    n = Math.min(n, 120);
    let tries = 0;
    while (p.seeds.length < n && tries++ < n * 60) {
      const px = pix[n0 + Math.floor(rng() * p.pixels)];
      if (rng() * 1.12 > density(px)) continue;
      p.seeds.push(seedPix.length); seedPix.push(px); seedPoly.push(pi);
    }
    while (p.seeds.length < n) { const px = pix[n0 + Math.floor(rng() * p.pixels)]; p.seeds.push(seedPix.length); seedPix.push(px); seedPoly.push(pi); }
    if (p.seeds.length) countryHasSeed[p.country] = 1;
  }

  const S = seedPix.length;
  const sx = new Float32Array(S), sy = new Float32Array(S), sz = new Float32Array(S);
  const setSeed = (s: number, i: number) => {
    const x = i % W, y = (i / W) | 0;
    sx[s] = cosLat[y] * cosLon[x]; sy[s] = sinLat[y]; sz[s] = -cosLat[y] * sinLon[x];
  };
  for (let s = 0; s < S; s++) setSeed(s, seedPix[s]);

  const nearest = (i: number, seeds: number[]) => {
    const x = i % W, y = (i / W) | 0;
    const px = cosLat[y] * cosLon[x], py = sinLat[y], pz = -cosLat[y] * sinLon[x];
    let best = seeds[0], bd = -2;
    for (let k = 0; k < seeds.length; k++) {
      const s = seeds[k];
      const d = px * sx[s] + py * sy[s] + pz * sz[s];
      if (d > bd) { bd = d; best = s; }
    }
    return best;
  };

  // Weighted Lloyd relaxation keeps cells compact while preserving density (smaller provinces where people live).
  const assign = new Int32Array(W * H).fill(-1);
  const ax = new Float64Array(S), ay = new Float64Array(S), az = new Float64Array(S);
  for (let iter = 0; iter < 3; iter++) {
    progress('Нарезка провинций', 0.3 + iter * 0.12);
    ax.fill(0); ay.fill(0); az.fill(0);
    polys.forEach((p, pi) => {
      if (p.seeds.length < 2) return;
      for (let k = offs[pi + 1]; k < offs[pi + 2]; k++) {
        const i = pix[k], s = nearest(i, p.seeds);
        assign[i] = s;
        const x = i % W, y = (i / W) | 0, w = cosLat[y] * density(i);
        ax[s] += w * cosLat[y] * cosLon[x]; ay[s] += w * sinLat[y]; az[s] += -w * cosLat[y] * sinLon[x];
      }
    });
    const bestDot = new Float64Array(S).fill(-2);
    const bestPix = new Int32Array(S).fill(-1);
    polys.forEach((p, pi) => {
      if (p.seeds.length < 2) return;
      for (let k = offs[pi + 1]; k < offs[pi + 2]; k++) {
        const i = pix[k], s = assign[i];
        const x = i % W, y = (i / W) | 0;
        const d = (cosLat[y] * cosLon[x]) * ax[s] + sinLat[y] * ay[s] - cosLat[y] * sinLon[x] * az[s];
        if (d > bestDot[s]) { bestDot[s] = d; bestPix[s] = i; }
      }
    });
    for (let s = 0; s < S; s++) if (bestPix[s] >= 0) { seedPix[s] = bestPix[s]; setSeed(s, bestPix[s]); }
  }

  // Final assignment.
  progress('Формирование провинций', 0.7);
  const countrySeeds: number[][] = tags.map(() => []);
  for (let s = 0; s < S; s++) countrySeeds[polys[seedPoly[s]].country].push(s);
  const prov = new Uint16Array(W * H);
  polys.forEach((p, pi) => {
    const seeds = p.seeds.length ? p.seeds : countrySeeds[p.country];
    if (!seeds.length) return;
    for (let k = offs[pi + 1]; k < offs[pi + 2]; k++) prov[pix[k]] = nearest(pix[k], seeds) + 1;
  });

  // Province statistics.
  progress('Анализ рельефа', 0.8);
  const area = new Float64Array(S), elevSum = new Float64Array(S), elevSq = new Float64Array(S), light = new Float64Array(S);
  const cr = new Float64Array(S), cg = new Float64Array(S), cb = new Float64Array(S), coast = new Uint8Array(S);
  const adj = new Map<number, Set<number>>();
  const addAdj = (a: number, b: number) => {
    let sa = adj.get(a); if (!sa) adj.set(a, (sa = new Set())); sa.add(b);
    let sb = adj.get(b); if (!sb) adj.set(b, (sb = new Set())); sb.add(a);
  };
  for (let y = 0; y < H; y++) {
    const w = cosLat[y] * PIXEL_KM2, ay2 = (y >> 2) * AUX_W, hy = (y >> 1) * (AUX_W * 2);
    for (let x = 0; x < W; x++) {
      const i = y * W + x, p = prov[i];
      if (!p) continue;
      const s = p - 1;
      area[s] += w;
      const e = input.heights[hy + (x >> 1)] / 255;
      elevSum[s] += e * w; elevSq[s] += e * e * w;
      const a = ay2 + (x >> 2);
      light[s] += (input.night[a] / 255) * w;
      cr[s] += input.color[a * 4] * w; cg[s] += input.color[a * 4 + 1] * w; cb[s] += input.color[a * 4 + 2] * w;
      const r = prov[y * W + ((x + 1) % W)];
      const d = y + 1 < H ? prov[i + W] : p;
      if (!r || !d || (x > 0 && !prov[i - 1]) || (y > 0 && !prov[i - W])) coast[s] = 1;
      if (r && r !== p) addAdj(p, r);
      if (d && d !== p) addAdj(p, d);
    }
  }

  const pLat = new Float32Array(S), pLon = new Float32Array(S), pArea = new Float32Array(S), pCountry = new Uint8Array(S);
  const pTerrain = new Uint8Array(S), pCoastal = new Uint8Array(S), pElev = new Float32Array(S), pLight = new Float32Array(S);
  for (let s = 0; s < S; s++) {
    const i = seedPix[s], x = i % W, y = (i / W) | 0;
    pLat[s] = 90 - ((y + 0.5) / H) * 180; pLon[s] = ((x + 0.5) / W) * 360 - 180;
    pArea[s] = area[s]; pCountry[s] = polys[seedPoly[s]].country; pCoastal[s] = coast[s];
    const A = Math.max(area[s], 1e-6);
    const em = elevSum[s] / A, ev = Math.sqrt(Math.max(0, elevSq[s] / A - em * em));
    const r = cr[s] / A, g = cg[s] / A, b = cb[s] / A;
    pElev[s] = em; pLight[s] = light[s] / A;
    pTerrain[s] = classify(pLat[s], em, ev, r, g, b, tags[pCountry[s]] === '010');
  }

  const adjOffsets = new Uint32Array(S + 1);
  const flat: number[] = [];
  for (let s = 0; s < S; s++) {
    adjOffsets[s] = flat.length;
    for (const n of adj.get(s + 1) ?? []) flat.push(n - 1);
  }
  adjOffsets[S] = flat.length;

  // Navigation grid: bit0 = has land, bit1 = has water.
  progress('Навигационная сетка', 0.92);
  const nav = new Uint8Array(NAV_W * NAV_H);
  const fx = W / NAV_W, fy = H / NAV_H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = ((y / fy) | 0) * NAV_W + ((x / fx) | 0);
    nav[c] |= prov[y * W + x] ? 1 : 2;
  }

  progress('Готово', 1);
  return {
    tags, prov, ctry, nav, pLat, pLon, pArea, pCountry, pTerrain, pCoastal, pElev, pLight,
    adjOffsets, adjList: Uint32Array.from(flat),
  };
}

function classify(lat: number, elev: number, rough: number, r: number, g: number, b: number, antarctic: boolean): Terrain {
  const bright = (r + g + b) / 3;
  if (antarctic || Math.abs(lat) > 70 || (bright > 175 && b > r * 0.9)) return Terrain.Arctic;
  if (elev > 0.42 || rough > 0.11) return Terrain.Mountains;
  if (r > g * 1.08 && r > 110 && b < g * 0.92 && bright > 105) return Terrain.Desert;
  if (elev > 0.24 || rough > 0.06) return Terrain.Hills;
  if (g >= r * 0.98 && bright < 75) return Terrain.Forest;
  return Terrain.Plains;
}

/** Make ring longitudes continuous; close pole-encircling rings (Antarctica) through the pole. */
function unwrap(ring: number[][]): number[][] {
  const out: number[][] = [[ring[0][0], ring[0][1]]];
  for (let k = 1; k < ring.length; k++) {
    let lon = ring[k][0];
    const prev = out[k - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    out.push([lon, ring[k][1]]);
  }
  const drift = out[out.length - 1][0] - out[0][0];
  if (Math.abs(drift) > 180) {
    const meanLat = out.reduce((s, p) => s + p[1], 0) / out.length;
    const pole = meanLat < 0 ? -90 : 90;
    const last = out[out.length - 1][0];
    out.push([last, pole], [out[0][0], pole], [out[0][0], out[0][1]]);
  }
  return out;
}

function rasterize(rawRings: number[][][], value: number, out: Uint16Array) {
  const rings = rawRings.map(unwrap);
  let lo = Infinity, hi = -Infinity;
  for (const r of rings) for (const p of r) { lo = Math.min(lo, p[0]); hi = Math.max(hi, p[0]); }
  rasterizeShifted(rings, 0, value, out);
  if (lo < -180) rasterizeShifted(rings, 360, value, out);
  if (hi > 180) rasterizeShifted(rings, -360, value, out);
}

function rasterizeShifted(rings: number[][][], shift: number, value: number, out: Uint16Array) {
  const ex0: number[] = [], ey0: number[] = [], ex1: number[] = [], ey1: number[] = [];
  let minY = H, maxY = 0;
  for (const ring of rings) {
    for (let k = 0; k < ring.length - 1; k++) {
      const x0 = ((ring[k][0] + shift + 180) / 360) * W, y0 = ((90 - ring[k][1]) / 180) * H;
      const x1 = ((ring[k + 1][0] + shift + 180) / 360) * W, y1 = ((90 - ring[k + 1][1]) / 180) * H;
      if (y0 === y1) continue;
      ex0.push(x0); ey0.push(y0); ex1.push(x1); ey1.push(y1);
      minY = Math.min(minY, y0, y1); maxY = Math.max(maxY, y0, y1);
    }
  }
  const xs: number[] = [];
  const yStart = Math.max(0, Math.floor(minY)), yEnd = Math.min(H - 1, Math.ceil(maxY));
  for (let y = yStart; y <= yEnd; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let e = 0; e < ex0.length; e++) {
      const a = ey0[e], b = ey1[e];
      if ((a <= yc && yc < b) || (b <= yc && yc < a)) xs.push(ex0[e] + ((yc - a) * (ex1[e] - ex0[e])) / (b - a));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) out[y * W + x] = value;
    }
  }
}
