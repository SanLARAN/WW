import * as THREE from 'three';

/**
 * Procedural PBR materials.
 *
 * The sandbox can't reach Poly Haven / ambientCG, so every surface is painted
 * on a canvas at load time: albedo, roughness and a Sobel-derived normal map.
 * Everything is seeded, so the same map looks the same on every client.
 */

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

function canvas(size: number): { c: HTMLCanvasElement; g: Ctx } {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, g: c.getContext('2d')! };
}

/** Tileable value noise: a lattice of random values, sampled with wrapping. */
function noiseGrid(cells: number, rand: () => number) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  return (u: number, v: number) => {
    const x = u * cells, y = v * cells;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const s = (t: number) => t * t * (3 - 2 * t);
    const at = (i: number, j: number) => g[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)];
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    const sx = s(fx), sy = s(fy);
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  };
}

function fbm(seed: number, baseCells = 4, octaves = 4) {
  const rand = mulberry(seed);
  const layers = Array.from({ length: octaves }, (_, i) => noiseGrid(baseCells << i, rand));
  return (u: number, v: number, gain = 0.55) => {
    let n = 0, amp = 1, norm = 0;
    for (const l of layers) { n += l(u, v) * amp; norm += amp; amp *= gain; }
    return n / norm;
  };
}

function heightToNormal(height: HTMLCanvasElement, strength = 2.2): THREE.CanvasTexture {
  const size = height.width;
  const src = height.getContext('2d')!.getImageData(0, 0, size, size).data;
  const { c, g } = canvas(size);
  const out = g.createImageData(size, size);
  const h = (x: number, y: number) => src[((((y + size) % size) * size) + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function tex(c: HTMLCanvasElement, repeat = 1, srgb = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface Surfaces {
  ground: THREE.MeshStandardMaterial;
  dirt: THREE.MeshStandardMaterial;
  asphalt: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  brick: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  sandbag: THREE.MeshStandardMaterial;
  bark: THREE.MeshStandardMaterial;
  leaves: THREE.MeshStandardMaterial;
  rubble: THREE.MeshStandardMaterial;
  tarp: THREE.MeshStandardMaterial;
}

const S = 256;

/* ------------------------------------------------------------------ surfaces */

function dirtSurface(seed: number, tint: [number, number, number]) {
  const rand = mulberry(seed);
  const n = fbm(seed, 3, 5);
  const fine = fbm(seed + 7, 32, 2);
  const { c, g } = canvas(S);
  const img = g.createImageData(S, S);
  const hgt = canvas(S);
  const hImg = hgt.g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const big = n(u, v);
      const det = fine(u, v);
      const grain = rand() * 0.12;
      const shade = 0.72 + big * 0.34 + det * 0.16 + grain;
      const i = (y * S + x) * 4;
      img.data[i] = Math.min(255, tint[0] * shade);
      img.data[i + 1] = Math.min(255, tint[1] * shade);
      img.data[i + 2] = Math.min(255, tint[2] * shade);
      img.data[i + 3] = 255;
      const h = (big * 0.55 + det * 0.45 + grain * 0.5) * 255;
      hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = h;
      hImg.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  hgt.g.putImageData(hImg, 0, 0);
  return { map: tex(c, 1, true), normalMap: heightToNormal(hgt.c, 1.4) };
}

/** Mud, grass tufts, scattered stones and shell holes. */
function groundSurface() {
  const rand = mulberry(4242);
  const n = fbm(11, 3, 5);
  const patch = fbm(29, 6, 4);
  const { c, g } = canvas(S);
  const hgt = canvas(S);
  const hImg = hgt.g.createImageData(S, S);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const big = n(u, v);
      const grass = Math.max(0, (patch(u, v) - 0.5) * 2.4);
      const grit = rand() * 0.16;
      const mudMix = Math.min(1, grass * 0.85);
      // wet dark earth -> muddy olive with dry grass
      const r = 62 + big * 26 + grass * 44 + grit * 40;
      const gg = 56 + big * 26 + grass * 62 + grit * 40;
      const b = 44 + big * 20 + grass * 30 + grit * 36;
      const i = (y * S + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = gg;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
      const h = (big * 0.5 + grit * 0.8 + mudMix * 0.4) * 255;
      hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = h;
      hImg.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  hgt.g.putImageData(hImg, 0, 0);
  // dry grass strokes
  g.lineWidth = 1;
  for (let i = 0; i < 2400; i++) {
    const x = rand() * S, y = rand() * S;
    g.strokeStyle = `rgba(${110 + rand() * 40 | 0},${105 + rand() * 35 | 0},${64 + rand() * 25 | 0},${0.14 + rand() * 0.3})`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rand() - 0.5) * 5, y - 3 - rand() * 7);
    g.stroke();
  }
  // puddles
  for (let i = 0; i < 14; i++) {
    const x = rand() * S, y = rand() * S, r = 8 + rand() * 26;
    const grd = g.createRadialGradient(x, y, 1, x, y, r);
    grd.addColorStop(0, 'rgba(38,42,40,0.55)');
    grd.addColorStop(1, 'rgba(38,42,40,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return { map: tex(c, 34, true), normalMap: heightToNormal(hgt.c, 1.1) };
}

function brickSurface() {
  const rand = mulberry(77);
  const n = fbm(5, 8, 3);
  const { c, g } = canvas(S);
  const hgt = canvas(S);
  const hg = hgt.g;
  g.fillStyle = '#6b6257';
  g.fillRect(0, 0, S, S);
  hg.fillStyle = '#404040';
  hg.fillRect(0, 0, S, S);
  const rows = 20, bh = S / rows;
  for (let r = 0; r < rows; r++) {
    const cols = r % 2 ? 8 : 9;
    const bw = S / cols;
    for (let i = -1; i < cols + 1; i++) {
      const x = i * bw + (r % 2 ? bw / 2 : 0);
      const y = r * bh;
      const tone = 0.62 + rand() * 0.35;
      const dirt = n(x / S, y / S) * 0.35;
      g.fillStyle = `rgb(${(126 * tone * (1 - dirt) + 40) | 0},${(74 * tone * (1 - dirt) + 34) | 0},${(58 * tone * (1 - dirt) + 30) | 0})`;
      g.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
      hg.fillStyle = '#b8b8b8';
      hg.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
    }
  }
  // weathering streaks + soot
  for (let i = 0; i < 90; i++) {
    const x = rand() * S;
    g.fillStyle = `rgba(30,26,22,${0.03 + rand() * 0.07})`;
    g.fillRect(x, 0, 2 + rand() * 10, S);
  }
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${rand() * 40 | 0},${rand() * 40 | 0},${rand() * 30 | 0},0.25)`;
    g.fillRect(rand() * S, rand() * S, 2, 2);
  }
  return { map: tex(c, 1, true), normalMap: heightToNormal(hgt.c, 3.4) };
}

/** Cast concrete panels of a Khrushchyovka with seams and stains. */
function panelSurface() {
  const rand = mulberry(313);
  const n = fbm(9, 4, 5);
  const { c, g } = canvas(S);
  const hgt = canvas(S);
  const hg = hgt.g;
  const img = g.createImageData(S, S);
  const hImg = hg.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const stain = Math.pow(n(u, v), 2.1);
      const grit = rand() * 0.07;
      const base = 148 - stain * 66 + grit * 90;
      const i = (y * S + x) * 4;
      img.data[i] = base * 0.99;
      img.data[i + 1] = base * 0.975;
      img.data[i + 2] = base * 0.93;
      img.data[i + 3] = 255;
      const h = 120 + (n(u * 3, v * 3) - 0.5) * 40;
      hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = h;
      hImg.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  hg.putImageData(hImg, 0, 0);
  // panel seams
  g.strokeStyle = 'rgba(48,44,40,0.55)';
  hg.strokeStyle = '#1a1a1a';
  g.lineWidth = 3; hg.lineWidth = 6;
  for (let i = 1; i < 4; i++) {
    const p = (i * S) / 4;
    g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
    hg.beginPath(); hg.moveTo(0, p); hg.lineTo(S, p); hg.stroke();
  }
  g.lineWidth = 2; hg.lineWidth = 4;
  g.beginPath(); g.moveTo(S * 0.5, 0); g.lineTo(S * 0.5, S); g.stroke();
  hg.beginPath(); hg.moveTo(S * 0.5, 0); hg.lineTo(S * 0.5, S); hg.stroke();
  // rust/rain streaks
  for (let i = 0; i < 40; i++) {
    const x = rand() * S, w = 2 + rand() * 7;
    const grd = g.createLinearGradient(0, 0, 0, S);
    grd.addColorStop(0, `rgba(70,58,44,${0.12 + rand() * 0.2})`);
    grd.addColorStop(1, 'rgba(70,58,44,0)');
    g.fillStyle = grd;
    g.fillRect(x, rand() * S * 0.5, w, S);
  }
  return { map: tex(c, 1, true), normalMap: heightToNormal(hgt.c, 2.0) };
}

function metalSurface(seed: number, base: [number, number, number], rust = 0.5) {
  const rand = mulberry(seed);
  const n = fbm(seed + 3, 5, 4);
  const { c, g } = canvas(S);
  const hgt = canvas(S);
  const img = g.createImageData(S, S);
  const hImg = hgt.g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const noise = n(u, v);
      const rustAmt = Math.max(0, noise - (1 - rust)) * 3.2;
      const grit = rand() * 0.06;
      const i = (y * S + x) * 4;
      const rr = base[0] * (1 - rustAmt) + 108 * rustAmt;
      const gg = base[1] * (1 - rustAmt) + 58 * rustAmt;
      const bb = base[2] * (1 - rustAmt) + 34 * rustAmt;
      img.data[i] = Math.min(255, (rr + grit * 120));
      img.data[i + 1] = Math.min(255, (gg + grit * 120));
      img.data[i + 2] = Math.min(255, (bb + grit * 110));
      img.data[i + 3] = 255;
      const h = (rustAmt * 0.7 + noise * 0.3) * 255;
      hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = h;
      hImg.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  hgt.g.putImageData(hImg, 0, 0);
  // scratches and dents
  for (let i = 0; i < 120; i++) {
    g.strokeStyle = `rgba(${180 + rand() * 60 | 0},${175 + rand() * 50 | 0},${165 + rand() * 40 | 0},${0.05 + rand() * 0.12})`;
    g.lineWidth = 1;
    g.beginPath();
    const x = rand() * S, y = rand() * S;
    g.moveTo(x, y);
    g.lineTo(x + (rand() - 0.5) * 60, y + (rand() - 0.5) * 12);
    g.stroke();
  }
  return { map: tex(c, 1, true), normalMap: heightToNormal(hgt.c, 1.6) };
}

function barkSurface() {
  const rand = mulberry(91);
  const n = fbm(17, 6, 4);
  const { c, g } = canvas(256);
  const hgt = canvas(256);
  const img = g.createImageData(256, 256);
  const hImg = hgt.g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const u = x / 256, v = y / 256;
      const ridge = Math.abs(Math.sin((u * 22 + n(u, v) * 4) * Math.PI)) * 0.6 + n(u * 4, v) * 0.4;
      const i = (y * 256 + x) * 4;
      img.data[i] = 62 + ridge * 62;
      img.data[i + 1] = 52 + ridge * 52;
      img.data[i + 2] = 42 + ridge * 40;
      img.data[i + 3] = 255;
      hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = ridge * 255;
      hImg.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  hgt.g.putImageData(hImg, 0, 0);
  void rand;
  return { map: tex(c, 2, true), normalMap: heightToNormal(hgt.c, 3) };
}

function leafSurface() {
  const rand = mulberry(51);
  const n = fbm(23, 8, 3);
  const { c, g } = canvas(256);
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const u = x / 256, v = y / 256;
      const m = n(u, v);
      const i = (y * 256 + x) * 4;
      // late-autumn olive / ochre, still greasy with damp
      img.data[i] = 52 + m * 74 + rand() * 12;
      img.data[i + 1] = 58 + m * 62 + rand() * 12;
      img.data[i + 2] = 32 + m * 34 + rand() * 10;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = `rgba(${90 + rand() * 70 | 0},${86 + rand() * 60 | 0},${34 + rand() * 30 | 0},0.5)`;
    const x = rand() * 256, y = rand() * 256;
    g.beginPath(); g.ellipse(x, y, 1 + rand() * 2.4, 1 + rand() * 3.2, rand() * 3, 0, Math.PI * 2); g.fill();
  }
  return { map: tex(c, 1, true) };
}

function sandbagSurface() {
  const rand = mulberry(613);
  const n = fbm(31, 10, 3);
  const { c, g } = canvas(256);
  const hgt = canvas(256);
  const img = g.createImageData(256, 256);
  const hImg = hgt.g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const u = x / 256, v = y / 256;
      const weave = (Math.sin(u * 256 * Math.PI * 1.6) * 0.5 + 0.5) * 0.2;
      const m = n(u, v);
      const i = (y * 256 + x) * 4;
      img.data[i] = 112 + m * 44 + weave * 60 + rand() * 10;
      img.data[i + 1] = 104 + m * 40 + weave * 56 + rand() * 10;
      img.data[i + 2] = 78 + m * 30 + weave * 40 + rand() * 8;
      img.data[i + 3] = 255;
      hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = (weave + m * 0.4) * 255;
      hImg.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  hgt.g.putImageData(hImg, 0, 0);
  return { map: tex(c, 1, true), normalMap: heightToNormal(hgt.c, 1.5) };
}

let cached: Surfaces | null = null;

/** Built once per page: the procedural paint is the most expensive thing at load. */
export function buildSurfaces(): Surfaces {
  if (cached) return cached;
  const ground = groundSurface();
  const dirt = dirtSurface(1201, [96, 84, 66]);
  const asphalt = dirtSurface(1707, [72, 74, 76]);
  const brick = brickSurface();
  const panel = panelSurface();
  const metalGreen = metalSurface(501, [62, 68, 58], 0.45);
  const metalRust = metalSurface(733, [96, 92, 84], 0.75);
  const bark = barkSurface();
  const leaves = leafSurface();
  const sand = sandbagSurface();

  cached = {
    ground: new THREE.MeshStandardMaterial({ ...ground, roughness: 0.97, metalness: 0.02 }),
    dirt: new THREE.MeshStandardMaterial({ ...dirt, roughness: 0.96, metalness: 0.02, normalScale: new THREE.Vector2(0.9, 0.9) }),
    asphalt: new THREE.MeshStandardMaterial({ ...asphalt, roughness: 0.88, metalness: 0.03 }),
    concrete: new THREE.MeshStandardMaterial({ ...panel, roughness: 0.82, metalness: 0.03 }),
    brick: new THREE.MeshStandardMaterial({ ...brick, roughness: 0.9, metalness: 0.02 }),
    panel: new THREE.MeshStandardMaterial({ ...panel, roughness: 0.78, metalness: 0.02, color: 0xd8d4cc }),
    metal: new THREE.MeshStandardMaterial({ ...metalGreen, roughness: 0.62, metalness: 0.55 }),
    sandbag: new THREE.MeshStandardMaterial({ ...sand, roughness: 0.95, metalness: 0 }),
    bark: new THREE.MeshStandardMaterial({ ...bark, roughness: 0.95, metalness: 0 }),
    leaves: new THREE.MeshStandardMaterial({ ...leaves, roughness: 0.72, metalness: 0, side: THREE.DoubleSide }),
    rubble: new THREE.MeshStandardMaterial({ ...metalRust, roughness: 0.9, metalness: 0.4 }),
    tarp: new THREE.MeshStandardMaterial({ color: 0x3a3d33, roughness: 0.85, metalness: 0.05 }),
  };
  return cached;
}

export { groundSurface };
