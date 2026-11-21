/**
 * Level layout. Deterministic from a seed: the host generates it and sends the
 * seed in the lobby, so every client builds the same battlefield byte-for-byte.
 * This module is the single source of truth for collision and navigation.
 */

export const MAP_SIZE = 260; // metres, square, centred on the crash site
export const HALF = MAP_SIZE / 2;

export type BlockKind = 'house' | 'shed' | 'wall' | 'bunker' | 'container' | 'wreck' | 'sandbag' | 'trench';

export interface Block {
  id: number;
  kind: BlockKind;
  /** centre XZ */
  x: number;
  z: number;
  /** half extents on X and Z before rotation */
  hx: number;
  hz: number;
  /** rotation around Y */
  rot: number;
  /** height for rendering and for shooting over */
  h: number;
}

export interface Tree { x: number; z: number; r: number; h: number; kind: 'pine' | 'birch' }

export interface Layout {
  seed: number;
  blocks: Block[];
  trees: Tree[];
  /** spawn point of the squad at the crash site */
  spawn: { x: number; z: number };
  /** helicopter crash, world position + yaw */
  crash: { x: number; z: number; rot: number };
  /** player start positions around the crash */
  starts: { x: number; z: number }[];
  /** enemy spawn gates on the map edges */
  gates: { x: number; z: number }[];
  /** supply drop zones, always inside the perimeter */
  drops: { x: number; z: number }[];
}

/** Small, fast, deterministic RNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inMap = (x: number, z: number, pad = 6) => Math.abs(x) < HALF - pad && Math.abs(z) < HALF - pad;

export function generateLayout(seed: number): Layout {
  const r = rng(seed);
  const blocks: Block[] = [];
  const trees: Tree[] = [];
  let id = 1;
  const push = (kind: BlockKind, x: number, z: number, hx: number, hz: number, rot: number, h: number) => {
    if (!inMap(x, z)) return;
    blocks.push({ id: id++, kind, x, z, hx, hz, rot, h });
  };

  // ---- the ruined settlement: two rows of Khrushchyovka blocks with yards.
  const settX = -58, settZ = 46;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const x = settX + i * 34 + (r() - 0.5) * 5;
      const z = settZ + j * 30 + (r() - 0.5) * 4;
      // The middle block of the first row is the one the squad can hold.
      push('house', x, z, 11 + r() * 3, 7, (r() - 0.5) * 0.12, 13.5 + r() * 4);
      for (let s = 0; s < 3; s++) {
        push('shed', x + 16 + r() * 6, z + (r() - 0.5) * 14, 2.6, 2.2, r() * Math.PI, 2.6);
      }
    }
  }
  // A long concrete wall cutting the settlement off from the field.
  push('wall', settX + 30, settZ - 22, 26, 0.35, 0, 2.4);
  push('wall', settX + 4, settZ - 22, 14, 0.35, 0.06, 2.4);

  // ---- treeline: a dense band along the north-west with clearings to fight in.
  for (let i = 0; i < 520; i++) {
    const x = -HALF + 12 + r() * 150;
    const z = -HALF + 12 + r() * 150;
    // keep the crash clearing and the settlement clear of trunks
    if (Math.hypot(x - 0, z - 0) < 24) continue;
    if (x > settX - 24 && x < settX + 96 && z > settZ - 44 && z < settZ + 60) continue;
    const pine = r() > 0.45;
    trees.push({ x, z, r: 0.22 + r() * 0.2, h: pine ? 11 + r() * 8 : 9 + r() * 5, kind: pine ? 'pine' : 'birch' });
  }

  // ---- fortifications around the crash site: sandbags, a trench line, a bunker.
  const ring = 17;
  for (let a = 0; a < Math.PI * 2; a += 0.42) {
    if (r() < 0.32) continue;
    push('sandbag', Math.cos(a) * ring, Math.sin(a) * ring, 1.9, 0.45, -a, 1.1);
  }
  push('bunker', 15, -13, 3.6, 3.2, 0.35, 2.2);
  push('trench', -18, 10, 7, 1.2, 0.6, 0.9);
  push('trench', 6, 20, 6, 1.2, -0.3, 0.9);

  // ---- containers and wrecks for mid-range cover in the open field.
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2, d = 34 + r() * 62;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (r() > 0.5) push('container', x, z, 3.1, 1.3, r() * Math.PI, 2.6);
    else push('wreck', x, z, 2.4, 1.1, r() * Math.PI, 1.9);
  }

  // ---- enemy gates: four roads in, one per quadrant edge.
  const gates = [
    { x: -HALF + 8, z: -HALF + 40 }, { x: HALF - 8, z: -HALF + 70 },
    { x: HALF - 30, z: HALF - 8 }, { x: -HALF + 50, z: HALF - 8 },
  ];
  // ---- drop zones: behind the sandbag ring, always reachable.
  const drops = [
    { x: -6, z: -6 }, { x: 8, z: 6 }, { x: -10, z: 9 }, { x: 4, z: -11 },
  ];

  return {
    seed, blocks, trees,
    spawn: { x: 0, z: 0 },
    crash: { x: 3.5, z: 2.5, rot: 0.7 },
    starts: [
      { x: -2.2, z: 3.4 }, { x: 2.6, z: 4.2 }, { x: -4.4, z: 1.2 },
      { x: 5.1, z: 0.6 }, { x: 0.4, z: 5.4 }, { x: -1.1, z: -3.6 },
    ],
    gates, drops,
  };
}

/** Point-in-rotated-rect test used by collision and by the player controller. */
export function insideBlock(b: Block, x: number, z: number, pad = 0): boolean {
  const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
  const dx = x - b.x, dz = z - b.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) <= b.hx + pad && Math.abs(lz) <= b.hz + pad;
}

/** True when a capsule of `radius` at x,z collides with anything solid. */
export function blocked(layout: Layout, x: number, z: number, radius = 0.34, y = 0): boolean {
  if (Math.abs(x) > HALF - 1 || Math.abs(z) > HALF - 1) return true;
  for (const b of layout.blocks) {
    // low cover can be stepped over when crouched behind it? No: everything with
    // height above 0.6 blocks movement; sandbags are waist-high but solid.
    if (b.h < 0.5) continue;
    if (y > b.h) continue; // standing on top / shooting over is handled by the shooter
    if (insideBlock(b, x, z, radius)) return true;
  }
  for (const t of layout.trees) {
    const dx = x - t.x, dz = z - t.z;
    if (dx * dx + dz * dz < (t.r + radius) * (t.r + radius)) return true;
  }
  return false;
}

/** Ray vs. the level's AABBs (rotated boxes are treated as OBBs). Returns distance or null. */
export function raycastLevel(layout: Layout, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist = 400): number | null {
  let best: number | null = null;
  // ground plane at y=0
  if (dy < -1e-5) {
    const t = -oy / dy;
    if (t > 0 && t < maxDist) best = t;
  }
  for (const b of layout.blocks) {
    const t = rayOBB(b, ox, oy, oz, dx, dy, dz);
    if (t !== null && t < maxDist && (best === null || t < best)) best = t;
  }
  for (const tr of layout.trees) {
    // cylinder approximated as a vertical box around the trunk
    const t = rayCylinder(tr.x, tr.z, tr.r, tr.h, ox, oy, oz, dx, dy, dz);
    if (t !== null && t < maxDist && (best === null || t < best)) best = t;
  }
  return best;
}

function rayOBB(b: Block, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number | null {
  // rotate the ray into the box's local space
  const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
  const px = ox - b.x, pz = oz - b.z;
  const lx = px * c - pz * s, lz = px * s + pz * c;
  const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
  let tmin = 0, tmax = Infinity;
  // X slab
  const slab = (p: number, d: number, half: number): boolean => {
    if (Math.abs(d) < 1e-6) return Math.abs(p) <= half;
    let t1 = (-half - p) / d, t2 = (half - p) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    return tmin <= tmax;
  };
  if (!slab(lx, ldx, b.hx)) return null;
  if (!slab(lz, ldz, b.hz)) return null;
  // Y slab: from ground to b.h
  if (Math.abs(dy) < 1e-6) { if (oy < 0 || oy > b.h) return null; }
  else {
    let t1 = (0 - oy) / dy, t2 = (b.h - oy) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin > 0 ? tmin : null;
}

function rayCylinder(cx: number, cz: number, r: number, h: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number | null {
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return null;
  const px = ox - cx, pz = oz - cz;
  const b = 2 * (px * dx + pz * dz);
  const cc = px * px + pz * pz - r * r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) t = (-b + sq) / (2 * a);
  if (t < 0) return null;
  const y = oy + dy * t;
  return y >= 0 && y <= h ? t : null;
}
