// src/world/layout.ts
var MAP_SIZE = 260;
var HALF = MAP_SIZE / 2;
function rng(seed) {
  let a2 = seed >>> 0;
  return () => {
    a2 = a2 + 1831565813 >>> 0;
    let t = Math.imul(a2 ^ a2 >>> 15, 1 | a2);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var inMap = (x, z, pad = 6) => Math.abs(x) < HALF - pad && Math.abs(z) < HALF - pad;
function generateLayout(seed) {
  const r = rng(seed);
  const blocks = [];
  const trees = [];
  let id = 1;
  const push = (kind, x, z, hx, hz, rot, h) => {
    if (!inMap(x, z)) return;
    blocks.push({ id: id++, kind, x, z, hx, hz, rot, h });
  };
  const settX = -58, settZ = 46;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const x = settX + i * 34 + (r() - 0.5) * 5;
      const z = settZ + j * 30 + (r() - 0.5) * 4;
      push("house", x, z, 11 + r() * 3, 7, (r() - 0.5) * 0.12, 13.5 + r() * 4);
      for (let s = 0; s < 3; s++) {
        push("shed", x + 16 + r() * 6, z + (r() - 0.5) * 14, 2.6, 2.2, r() * Math.PI, 2.6);
      }
    }
  }
  push("wall", settX + 30, settZ - 22, 26, 0.35, 0, 2.4);
  push("wall", settX + 4, settZ - 22, 14, 0.35, 0.06, 2.4);
  for (let i = 0; i < 520; i++) {
    const x = -HALF + 12 + r() * 150;
    const z = -HALF + 12 + r() * 150;
    if (Math.hypot(x - 0, z - 0) < 24) continue;
    if (x > settX - 24 && x < settX + 96 && z > settZ - 44 && z < settZ + 60) continue;
    const pine = r() > 0.45;
    trees.push({ x, z, r: 0.22 + r() * 0.2, h: pine ? 11 + r() * 8 : 9 + r() * 5, kind: pine ? "pine" : "birch" });
  }
  const ring = 17;
  for (let a2 = 0; a2 < Math.PI * 2; a2 += 0.42) {
    if (r() < 0.32) continue;
    push("sandbag", Math.cos(a2) * ring, Math.sin(a2) * ring, 1.9, 0.45, -a2, 1.1);
  }
  push("bunker", 15, -13, 3.6, 3.2, 0.35, 2.2);
  push("trench", -18, 10, 7, 1.2, 0.6, 0.9);
  push("trench", 6, 20, 6, 1.2, -0.3, 0.9);
  for (let i = 0; i < 9; i++) {
    const a2 = r() * Math.PI * 2, d = 34 + r() * 62;
    const x = Math.cos(a2) * d, z = Math.sin(a2) * d;
    if (r() > 0.5) push("container", x, z, 3.1, 1.3, r() * Math.PI, 2.6);
    else push("wreck", x, z, 2.4, 1.1, r() * Math.PI, 1.9);
  }
  const gates = [
    { x: -HALF + 8, z: -HALF + 40 },
    { x: HALF - 8, z: -HALF + 70 },
    { x: HALF - 30, z: HALF - 8 },
    { x: -HALF + 50, z: HALF - 8 }
  ];
  const drops = [
    { x: -6, z: -6 },
    { x: 8, z: 6 },
    { x: -10, z: 9 },
    { x: 4, z: -11 }
  ];
  return {
    seed,
    blocks,
    trees,
    spawn: { x: 0, z: 0 },
    crash: { x: 3.5, z: 2.5, rot: 0.7 },
    starts: [
      { x: -2.2, z: 3.4 },
      { x: 2.6, z: 4.2 },
      { x: -4.4, z: 1.2 },
      { x: 5.1, z: 0.6 },
      { x: 0.4, z: 5.4 },
      { x: -1.1, z: -3.6 }
    ],
    gates,
    drops
  };
}
function insideBlock(b2, x, z, pad = 0) {
  const c2 = Math.cos(-b2.rot), s = Math.sin(-b2.rot);
  const dx = x - b2.x, dz = z - b2.z;
  const lx = dx * c2 - dz * s, lz = dx * s + dz * c2;
  return Math.abs(lx) <= b2.hx + pad && Math.abs(lz) <= b2.hz + pad;
}
function blocked(layout, x, z, radius = 0.34, y = 0) {
  if (Math.abs(x) > HALF - 1 || Math.abs(z) > HALF - 1) return true;
  for (const b2 of layout.blocks) {
    if (b2.h < 0.5) continue;
    if (y > b2.h) continue;
    if (insideBlock(b2, x, z, radius)) return true;
  }
  for (const t of layout.trees) {
    const dx = x - t.x, dz = z - t.z;
    if (dx * dx + dz * dz < (t.r + radius) * (t.r + radius)) return true;
  }
  return false;
}
function raycastLevel(layout, ox, oy, oz, dx, dy, dz, maxDist = 400) {
  let best = null;
  if (dy < -1e-5) {
    const t = -oy / dy;
    if (t > 0 && t < maxDist) best = t;
  }
  for (const b2 of layout.blocks) {
    const t = rayOBB(b2, ox, oy, oz, dx, dy, dz);
    if (t !== null && t < maxDist && (best === null || t < best)) best = t;
  }
  for (const tr of layout.trees) {
    const t = rayCylinder(tr.x, tr.z, tr.r, tr.h, ox, oy, oz, dx, dy, dz);
    if (t !== null && t < maxDist && (best === null || t < best)) best = t;
  }
  return best;
}
function rayOBB(b2, ox, oy, oz, dx, dy, dz) {
  const c2 = Math.cos(-b2.rot), s = Math.sin(-b2.rot);
  const px = ox - b2.x, pz = oz - b2.z;
  const lx = px * c2 - pz * s, lz = px * s + pz * c2;
  const ldx = dx * c2 - dz * s, ldz = dx * s + dz * c2;
  let tmin = 0, tmax = Infinity;
  const slab = (p, d, half) => {
    if (Math.abs(d) < 1e-6) return Math.abs(p) <= half;
    let t1 = (-half - p) / d, t2 = (half - p) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    return tmin <= tmax;
  };
  if (!slab(lx, ldx, b2.hx)) return null;
  if (!slab(lz, ldz, b2.hz)) return null;
  if (Math.abs(dy) < 1e-6) {
    if (oy < 0 || oy > b2.h) return null;
  } else {
    let t1 = (0 - oy) / dy, t2 = (b2.h - oy) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin > 0 ? tmin : null;
}
function rayCylinder(cx, cz, r, h, ox, oy, oz, dx, dy, dz) {
  const a2 = dx * dx + dz * dz;
  if (a2 < 1e-9) return null;
  const px = ox - cx, pz = oz - cz;
  const b2 = 2 * (px * dx + pz * dz);
  const cc = px * px + pz * pz - r * r;
  const disc = b2 * b2 - 4 * a2 * cc;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b2 - sq) / (2 * a2);
  if (t < 0) t = (-b2 + sq) / (2 * a2);
  if (t < 0) return null;
  const y = oy + dy * t;
  return y >= 0 && y <= h ? t : null;
}

// src/core/types.ts
var TICK = 1 / 20;
var EMPTY_INPUT = {
  seq: 0,
  mx: 0,
  mz: 0,
  sprint: false,
  crouch: false,
  fire: false,
  reload: false,
  use: false,
  yaw: 0,
  pitch: 0
};

// src/sim/weapons.ts
var WEAPONS = {
  ak: {
    id: "ak",
    name: "\u0410\u041A-74\u041C",
    mag: 30,
    cadence: 105,
    dmg: 31,
    falloff: 260,
    spread: 0.0125,
    recoil: 0.9,
    auto: true,
    pellets: 1,
    reloadMs: 2300
  },
  shotgun: {
    id: "shotgun",
    name: "\u0421\u0430\u0439\u0433\u0430-12",
    mag: 8,
    cadence: 380,
    dmg: 19,
    falloff: 45,
    spread: 0.075,
    recoil: 2.4,
    auto: false,
    pellets: 7,
    reloadMs: 2900
  },
  sniper: {
    id: "sniper",
    name: "\u0421\u0412\u0414",
    mag: 10,
    cadence: 900,
    dmg: 92,
    falloff: 900,
    spread: 22e-4,
    recoil: 3.1,
    auto: false,
    pellets: 1,
    reloadMs: 3100
  },
  lmg: {
    id: "lmg",
    name: "\u041F\u041A\u041C",
    mag: 80,
    cadence: 92,
    dmg: 34,
    falloff: 320,
    spread: 0.019,
    recoil: 1.4,
    auto: true,
    pellets: 1,
    reloadMs: 4200
  },
  /** A quadcopter you throw away: kamikaze FPV with a shaped charge. */
  drone: {
    id: "drone",
    name: "FPV-\u0434\u0440\u043E\u043D",
    mag: 1,
    cadence: 1400,
    dmg: 160,
    falloff: 120,
    spread: 0.01,
    recoil: 0,
    auto: false,
    pellets: 1,
    reloadMs: 0
  }
};
var BODY = { radius: 0.34, eye: 1.68, crouchEye: 1.08, height: 1.8 };
var SPEED = { walk: 2.7, sprint: 5.1, crouch: 1.35, strafeMod: 0.82 };
function levelOf(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 120)) + 1;
}
var PERKS = [
  { id: "recoil", name: "\u041D\u0430\u0431\u0438\u0442\u0430\u044F \u0440\u0443\u043A\u0430", desc: "\u221212% \u043E\u0442\u0434\u0430\u0447\u0438", at: 2 },
  { id: "hp", name: "\u0417\u0430\u043A\u0430\u043B\u043A\u0430", desc: "+10 \u043A \u0437\u0430\u043F\u0430\u0441\u0443 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F", at: 4 },
  { id: "stamina", name: "\u0412\u044B\u043D\u043E\u0441\u043B\u0438\u0432\u043E\u0441\u0442\u044C", desc: "\u0411\u0435\u0433 \u0434\u043E\u043B\u044C\u0448\u0435 \u043D\u0430 40%", at: 6 },
  { id: "reload", name: "\u0411\u044B\u0441\u0442\u0440\u044B\u0435 \u0440\u0443\u043A\u0438", desc: "\u041F\u0435\u0440\u0435\u0437\u0430\u0440\u044F\u0434\u043A\u0430 \u0431\u044B\u0441\u0442\u0440\u0435\u0435 \u043D\u0430 15%", at: 8 },
  { id: "suppress", name: "\u0425\u043B\u0430\u0434\u043D\u043E\u043A\u0440\u043E\u0432\u0438\u0435", desc: "\u041F\u043E\u0434\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0443\u0435\u0442 \u043D\u0430 35% \u0441\u043B\u0430\u0431\u0435\u0435", at: 10 },
  { id: "scavenge", name: "\u041C\u0430\u0440\u043E\u0434\u0451\u0440", desc: "\u0418\u0437 \u044F\u0449\u0438\u043A\u043E\u0432 \u043F\u0430\u0434\u0430\u0435\u0442 \u0431\u043E\u043B\u044C\u0448\u0435 \u043F\u0430\u0442\u0440\u043E\u043D\u043E\u0432", at: 13 },
  { id: "swift", name: "\u041B\u0451\u0433\u043A\u0430\u044F \u043F\u043E\u0445\u043E\u0434\u043A\u0430", desc: "+6% \u0441\u043A\u043E\u0440\u043E\u0441\u0442\u0438 \u043F\u0435\u0440\u0435\u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F", at: 16 },
  { id: "medic", name: "\u0421\u0430\u043D\u0438\u043D\u0441\u0442\u0440\u0443\u043A\u0442\u043E\u0440", desc: "\u0411\u0438\u043D\u0442\u044B \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u0430\u0432\u043B\u0438\u0432\u0430\u044E\u0442 \u043D\u0430 25% \u0431\u043E\u043B\u044C\u0448\u0435", at: 20 }
];
function perksOf(level) {
  return PERKS.filter((p) => level >= p.at);
}

// src/world/nav.ts
var CELL = 2;
var GRID = Math.ceil(MAP_SIZE / CELL);
var HALF2 = MAP_SIZE / 2;
var DIRS = [
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1]
];
var NavGrid = class {
  solid = new Uint8Array(GRID * GRID);
  /** heading (radians, atan2(x, z) convention) toward the goal, -1 = unknown */
  dir = new Float32Array(GRID * GRID).fill(-1);
  queue = new Int32Array(GRID * GRID);
  goalCell = -1;
  constructor(layout) {
    for (let iz = 0; iz < GRID; iz++) {
      for (let ix = 0; ix < GRID; ix++) {
        const x = -HALF2 + (ix + 0.5) * CELL;
        const z = -HALF2 + (iz + 0.5) * CELL;
        this.solid[iz * GRID + ix] = blocked(layout, x, z, 0.7) ? 1 : 0;
      }
    }
  }
  cellOf(x, z) {
    const ix = Math.max(0, Math.min(GRID - 1, Math.floor((x + HALF2) / CELL)));
    const iz = Math.max(0, Math.min(GRID - 1, Math.floor((z + HALF2) / CELL)));
    return iz * GRID + ix;
  }
  isSolid(x, z) {
    return this.solid[this.cellOf(x, z)] === 1;
  }
  /**
   * Recompute the flow field toward (gx, gz). Only runs the BFS when the goal
   * has drifted into another cell, so this is ~free when the squad holds still.
   */
  update(gx, gz) {
    const goal = this.cellOf(gx, gz);
    if (goal === this.goalCell) return;
    this.goalCell = goal;
    this.dir.fill(-1);
    const q = this.queue;
    let head = 0, tail = 0;
    this.dir[goal] = -2;
    q[tail++] = goal;
    while (head < tail) {
      const c2 = q[head++];
      const cx = c2 % GRID, cz = c2 / GRID | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DIRS[d][0], nz = cz + DIRS[d][1];
        if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
        const n = nz * GRID + nx;
        if (this.dir[n] !== -1 || this.solid[n]) continue;
        if (DIRS[d][0] !== 0 && DIRS[d][1] !== 0) {
          if (this.solid[cz * GRID + nx] || this.solid[nz * GRID + cx]) continue;
        }
        this.dir[n] = Math.atan2((cx - nx) * CELL, (cz - nz) * CELL);
        q[tail++] = n;
      }
    }
  }
  /** Flow heading at a world position, or null when unreachable. */
  heading(x, z) {
    const a2 = this.dir[this.cellOf(x, z)];
    return a2 === -1 || a2 === -2 ? null : a2;
  }
};

// src/sim/sim.ts
var WAVE_NAMES = [
  "\u041F\u0435\u0440\u0432\u0430\u044F \u043A\u0440\u043E\u0432\u044C",
  "\u0420\u0430\u0437\u0432\u0435\u0434\u043A\u0430 \u0431\u043E\u0435\u043C",
  "\u041E\u0433\u043D\u0435\u0432\u043E\u0439 \u0432\u0430\u043B",
  "\u0414\u0440\u043E\u043D\u044B \u043D\u0430\u0434 \u043F\u043E\u043B\u0435\u043C",
  "\u041C\u044F\u0441\u043E\u0440\u0443\u0431\u043A\u0430",
  "\u041D\u043E\u0447\u044C \u043D\u0430 \u043F\u0435\u0440\u0435\u0434\u043A\u0435",
  "\u0410\u0440\u0442\u0438\u043B\u043B\u0435\u0440\u0438\u0439\u0441\u043A\u0430\u044F \u043F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u043A\u0430",
  "\u041A\u043B\u0438\u043D \u0432 \u0441\u0442\u044B\u043A",
  "\u0422\u0443\u0447\u0438",
  "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u0440\u0443\u0431\u0435\u0436"
];
var Sim = class {
  s;
  layout;
  events = [];
  rngState;
  /** supply drop cadence in seconds — short enough to matter, long enough to risk */
  dropInterval = 165;
  nav;
  constructor(seed, layout) {
    this.layout = layout;
    this.nav = new NavGrid(layout);
    this.rngState = (seed ^ 2654435769) >>> 0;
    this.s = {
      version: 1,
      seed,
      tick: 0,
      time: 0,
      soldiers: [],
      enemies: [],
      supplies: [],
      tracers: [],
      impacts: [],
      nextId: 1,
      wave: { index: 0, name: "\u0422\u0438\u0448\u0438\u043D\u0430", timer: 90, active: false, remaining: 0 },
      survived: 0,
      intensity: 0,
      dropTimer: this.dropInterval,
      phase: "intro",
      kills: 0,
      armorUnlocked: false
    };
  }
  rand() {
    this.rngState = this.rngState + 1831565813 >>> 0;
    let t = Math.imul(this.rngState ^ this.rngState >>> 15, 1 | this.rngState);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  // ------------------------------------------------------------------ soldiers
  addSoldier(name, bot, slot, xp = 0) {
    const st = this.layout.starts[slot % this.layout.starts.length];
    const lvl = levelOf(xp);
    const s = {
      id: this.s.nextId++,
      name,
      bot,
      alive: true,
      downedAt: 0,
      x: st.x,
      y: 0,
      z: st.z,
      vx: 0,
      vz: 0,
      yaw: 0,
      pitch: 0,
      hp: 100 + (lvl >= 4 ? 10 : 0),
      maxHp: 100 + (lvl >= 4 ? 10 : 0),
      stamina: 100,
      crouch: false,
      sprint: false,
      weapon: "ak",
      reserve: ["shotgun", "sniper", "lmg"],
      ammo: WEAPONS.ak.mag,
      magSize: WEAPONS.ak.mag,
      reloadingUntil: 0,
      lastShot: -9999,
      xp,
      level: lvl,
      kills: 0,
      score: 0,
      suppress: 0,
      recoil: 0,
      lastShotPrev: -9999,
      lastSeq: 0,
      netX: st.x,
      netY: 0,
      netZ: st.z
    };
    this.s.soldiers.push(s);
    return s;
  }
  removeSoldier(id) {
    this.s.soldiers = this.s.soldiers.filter((x) => x.id !== id);
  }
  soldier(id) {
    return this.s.soldiers.find((x) => x.id === id);
  }
  aliveSoldiers() {
    return this.s.soldiers.filter((x) => x.alive);
  }
  // ------------------------------------------------------------------ main step
  step(inputs2) {
    this.s.tick++;
    this.s.time += TICK * 1e3;
    if (this.s.phase !== "intro") this.s.survived += TICK;
    for (const sol2 of this.s.soldiers) {
      if (!sol2.alive) continue;
      const cmd = inputs2.get(sol2.id);
      if (cmd) this.applyInput(sol2, cmd);
      else if (sol2.bot) this.botThink(sol2);
      else {
        sol2.vx = 0;
        sol2.vz = 0;
      }
      this.moveSoldier(sol2, TICK);
      this.regen(sol2);
    }
    this.updateWave(TICK);
    if (this.s.tick % 20 === 0) {
      const squad = this.aliveSoldiers();
      if (squad.length) {
        const ax = squad.reduce((n, m) => n + m.x, 0) / squad.length;
        const az = squad.reduce((n, m) => n + m.z, 0) / squad.length;
        this.nav.update(ax, az);
      }
    }
    this.updateEnemies(TICK);
    this.updateSupply(TICK);
    this.cullEffects(TICK);
    if (this.s.phase === "fight" && this.s.survived > 20 && this.s.soldiers.length && this.aliveSoldiers().length === 0) {
      this.s.phase = "overrun";
      this.s.wave.active = false;
      this.events.push({ type: "wave", a: { overrun: true } });
    }
    this.s.intensity = Math.max(0, this.s.intensity - TICK * 0.12);
  }
  // ------------------------------------------------------------------ player movement
  applyInput(sol2, cmd) {
    sol2.lastSeq = Math.max(sol2.lastSeq, cmd.seq);
    sol2.yaw = cmd.yaw;
    sol2.pitch = Math.max(-1.45, Math.min(1.45, cmd.pitch));
    sol2.crouch = cmd.crouch;
    const wantSprint = cmd.sprint && !cmd.crouch && sol2.stamina > 2 && (cmd.mx !== 0 || cmd.mz !== 0);
    sol2.sprint = wantSprint;
    const speed = cmd.crouch ? SPEED.crouch : wantSprint ? SPEED.sprint : SPEED.walk;
    const mag = Math.hypot(cmd.mx, cmd.mz);
    const norm = mag > 1 ? 1 : mag;
    sol2.vx = norm > 0 ? cmd.mx / (mag || 1) * speed * norm : 0;
    sol2.vz = norm > 0 ? cmd.mz / (mag || 1) * speed * norm : 0;
    if (wantSprint && mag > 0.1) sol2.stamina = Math.max(0, sol2.stamina - TICK * 12);
    else sol2.stamina = Math.min(100, sol2.stamina + TICK * (cmd.crouch ? 12 : 7));
    if (cmd.reload) this.startReload(sol2);
    if (cmd.use) this.useBandage(sol2);
    if (cmd.fire) this.tryFire(sol2);
  }
  moveSoldier(sol2, dt) {
    if (sol2.vx === 0 && sol2.vz === 0) return;
    const nx = sol2.x + sol2.vx * dt;
    const nz = sol2.z + sol2.vz * dt;
    const r = BODY.radius;
    if (!blocked(this.layout, nx, sol2.z, r)) sol2.x = nx;
    if (!blocked(this.layout, sol2.x, nz, r)) sol2.z = nz;
    sol2.netX = sol2.x;
    sol2.netZ = sol2.z;
  }
  regen(sol2) {
    sol2.suppress = Math.max(0, sol2.suppress - TICK * 22);
    sol2.recoil = Math.max(0, (sol2.recoil ?? 0) - TICK * 2.1);
    if (sol2.hp < sol2.maxHp && sol2.suppress < 5) sol2.hp = Math.min(sol2.maxHp, sol2.hp + TICK * 0.7);
  }
  /** Bots use the same primitives as players, so behaviour is fair and testable. */
  botThink(sol2) {
    if (sol2.hp < 34) {
      const dx = this.layout.spawn.x - sol2.x, dz = this.layout.spawn.z - sol2.z;
      const d = Math.hypot(dx, dz) || 1;
      sol2.crouch = true;
      sol2.vx = dx / d * SPEED.walk * (d > 6 ? 1 : 0);
      sol2.vz = dz / d * SPEED.walk * (d > 6 ? 1 : 0);
      sol2.yaw = Math.atan2(-dx, -dz);
      return;
    }
    const target2 = this.nearestEnemy(sol2, 190);
    if (target2) {
      const dx = target2.x - sol2.x, dz = target2.z - sol2.z;
      sol2.yaw = Math.atan2(dx, dz);
      const d = Math.hypot(dx, dz);
      sol2.crouch = d < 45;
      const eye = sol2.crouch ? BODY.crouchEye : BODY.eye;
      sol2.pitch = Math.atan2(1.15 - eye, Math.max(1, d));
      const cp = Math.cos(sol2.pitch);
      const fx = Math.sin(sol2.yaw) * cp, fy = Math.sin(sol2.pitch), fz = Math.cos(sol2.yaw) * cp;
      const wall2 = raycastLevel(this.layout, sol2.x, eye, sol2.z, fx, fy, fz, d + 2);
      const los = wall2 === null || wall2 > d - 1.2;
      const want = !los ? 0.15 : d > 60 ? 1 : d > 30 ? 0.35 : -0.2;
      sol2.vx = dx / (d || 1) * SPEED.walk * want;
      sol2.vz = dz / (d || 1) * SPEED.walk * want;
      if (!los) {
        const side = Math.floor(sol2.x + sol2.z) % 2 === 0 ? 1 : -1;
        sol2.vx = -dz / (d || 1) * SPEED.walk * side;
        sol2.vz = dx / (d || 1) * SPEED.walk * side;
      }
      if (d > 90 && sol2.weapon === "ak" && sol2.reserve.includes("sniper")) this.swapWeapon(sol2, "sniper");
      else if (d < 45 && (sol2.weapon === "sniper" || sol2.weapon === "lmg") && sol2.reserve.includes("ak")) this.swapWeapon(sol2, "ak");
      if (los && d < 190 && (d < 60 || this.s.tick % 4 === 0 || sol2.weapon === "sniper")) this.tryFire(sol2);
      else if (!los && sol2.ammo === 0) this.startReload(sol2);
    } else {
      const dx = this.layout.spawn.x - sol2.x, dz = this.layout.spawn.z - sol2.z;
      const d = Math.hypot(dx, dz);
      sol2.vx = d > 4 ? dx / d * SPEED.walk * 0.6 : 0;
      sol2.vz = d > 4 ? dz / d * SPEED.walk * 0.6 : 0;
      sol2.yaw = Math.atan2(sol2.vx, sol2.vz);
    }
  }
  // ------------------------------------------------------------------ shooting
  tryFire(sol2) {
    const w = WEAPONS[sol2.weapon];
    if (this.s.time < sol2.reloadingUntil) return;
    if (this.s.time - sol2.lastShot < w.cadence) return;
    if (sol2.ammo <= 0) {
      this.startReload(sol2);
      return;
    }
    const sincePrev = this.s.time - (sol2.lastShotPrev ?? -9999);
    sol2.lastShot = this.s.time;
    sol2.ammo--;
    sol2.recoil = Math.min(1.6, (sol2.recoil ?? 0) + (sincePrev < w.cadence * 2.2 ? w.recoil * 0.09 : 0));
    sol2.lastShotPrev = this.s.time;
    const spread = this.spreadOf(sol2, w.spread) * (1 + (sol2.recoil ?? 0) * 0.55);
    const dirs = w.pellets;
    let hitSomething = false;
    for (let i = 0; i < dirs; i++) {
      const yaw = sol2.yaw + (this.rand() - 0.5) * spread * 2;
      const pitch = sol2.pitch + (this.rand() - 0.5) * spread * 2;
      const dx = Math.sin(yaw) * Math.cos(pitch);
      const dy = Math.sin(pitch);
      const dz = Math.cos(yaw) * Math.cos(pitch);
      const eye = sol2.crouch ? BODY.crouchEye : BODY.eye;
      const wall2 = raycastLevel(this.layout, sol2.x, eye, sol2.z, dx, dy, dz, 400) ?? 400;
      const enemyHit = this.raycastEnemies(sol2.x, eye, sol2.z, dx, dy, dz, Math.min(wall2, 400));
      if (enemyHit) {
        hitSomething = true;
        const { e, t } = enemyHit;
        const dmg = w.dmg * damageFalloff(t, w.falloff);
        e.hp -= dmg;
        this.s.intensity = Math.min(1, this.s.intensity + 0.08);
        this.events.push({ type: "hit", a: { x: sol2.x + dx * t, y: eye + dy * t, z: sol2.z + dz * t } });
        if (e.hp <= 0 && e.alive) this.killEnemy(e, sol2);
      }
      this.s.tracers.push({
        id: this.s.nextId++,
        from: { x: sol2.x, y: eye, z: sol2.z },
        to: { x: sol2.x + dx * Math.min(wall2, 400), y: eye + dy * Math.min(wall2, 400), z: sol2.z + dz * Math.min(wall2, 400) },
        t: 90,
        enemy: false
      });
    }
    if (!hitSomething) {
      const d = 90;
      const endX = sol2.x + Math.sin(sol2.yaw) * d, endZ = sol2.z + Math.cos(sol2.yaw) * d;
      this.s.impacts.push({ id: this.s.nextId++, x: endX, y: 0.05, z: endZ, nx: 0, ny: 1, nz: 0, t: 1200, kind: "dirt" });
    }
    if (w.id === "drone") {
      sol2.reserve = sol2.reserve.filter((r) => r !== "drone");
      this.swapWeapon(sol2, sol2.weapon === "ak" ? "shotgun" : sol2.weapon);
    }
    this.events.push({ type: "shot", a: { weapon: w.id, x: sol2.x, z: sol2.z } });
  }
  spreadOf(sol2, base) {
    let sp = base;
    if (sol2.sprint) sp *= 2.4;
    else if (Math.abs(sol2.vx) + Math.abs(sol2.vz) > 0.5) sp *= 1.5;
    if (sol2.crouch) sp *= 0.7;
    sp *= 1 + sol2.suppress / 60;
    return sp;
  }
  startReload(sol2) {
    const w = WEAPONS[sol2.weapon];
    if (sol2.ammo >= w.mag || this.s.time < sol2.reloadingUntil) return;
    const fast = sol2.level >= 8 ? 0.85 : 1;
    sol2.reloadingUntil = this.s.time + w.reloadMs * fast;
    sol2.ammo = w.mag;
    this.events.push({ type: "reload", a: { id: sol2.id } });
  }
  useBandage(sol2) {
    const heal = sol2.level >= 20 ? 37 : 30;
    if (sol2.hp >= sol2.maxHp) return;
    sol2.hp = Math.min(sol2.maxHp, sol2.hp + heal);
  }
  swapWeapon(sol2, id) {
    if (!WEAPONS[id]) return;
    if (sol2.reserve.includes(id)) sol2.reserve = sol2.reserve.filter((r) => r !== id);
    sol2.reserve.unshift(sol2.weapon);
    sol2.weapon = id;
    sol2.magSize = WEAPONS[id].mag;
    sol2.ammo = WEAPONS[id].mag;
    sol2.reloadingUntil = 0;
  }
  // ------------------------------------------------------------------ enemies
  updateWave(dt) {
    const w = this.s.wave;
    if (this.s.phase === "intro") {
      w.timer -= dt;
      if (w.timer <= 0) {
        this.s.phase = "fight";
        this.startWave();
      }
      return;
    }
    if (w.active) {
      const alive = this.s.enemies.filter((e) => e.alive).length;
      if (alive === 0 && w.remaining === 0 && w.timer > 0) {
        w.timer -= dt;
        if (w.timer <= 0) {
          this.startWave();
        }
        return;
      }
      w.remaining = alive;
      if (alive === 0) {
        w.active = false;
        w.timer = Math.max(22, 42 - w.index * 1.2);
        w.name = "\u041F\u0435\u0440\u0435\u0434\u044B\u0448\u043A\u0430";
        this.events.push({ type: "wave", a: { done: true, index: w.index } });
        for (const sol2 of this.s.soldiers) if (sol2.alive) sol2.hp = Math.min(sol2.maxHp, sol2.hp + 12);
      }
    } else {
      w.timer -= dt;
      if (w.timer <= 0) this.startWave();
    }
  }
  startWave() {
    const w = this.s.wave;
    w.index++;
    w.active = true;
    w.name = WAVE_NAMES[(w.index - 1) % WAVE_NAMES.length] + (w.index > WAVE_NAMES.length ? ` \xB7 ${Math.ceil(w.index / WAVE_NAMES.length)}` : "");
    if (w.index >= 5) this.s.armorUnlocked = true;
    const count = Math.min(26, 3 + Math.round(w.index * 1.7));
    for (let i = 0; i < count; i++) {
      const drone = this.rand() < Math.min(0.42, 0.06 + w.index * 0.035);
      const kind = drone ? this.rand() < 0.55 ? "fpv" : "drone" : "infantry";
      this.spawnEnemy(kind);
    }
    if (this.s.armorUnlocked && w.index % 4 === 0) this.spawnEnemy("armor");
    this.events.push({ type: "wave", a: { index: w.index, name: w.name } });
  }
  spawnEnemy(kind, at) {
    const gate = at ?? this.layout.gates[Math.floor(this.rand() * this.layout.gates.length)];
    const jitter = kind === "infantry" ? 10 : 4;
    const hp = kind === "armor" ? 620 : kind === "infantry" ? 100 : kind === "fpv" ? 40 : 55;
    const e = {
      id: this.s.nextId++,
      kind,
      x: gate.x + (this.rand() - 0.5) * jitter,
      z: gate.z + (this.rand() - 0.5) * jitter,
      y: kind === "drone" || kind === "fpv" ? 22 + this.rand() * 14 : 0,
      hp,
      maxHp: hp,
      target: 0,
      cooldown: 1 + this.rand() * 2,
      yaw: 0,
      alive: true,
      chase: -1,
      burst: 0
    };
    this.s.enemies.push(e);
    return e;
  }
  updateEnemies(dt) {
    const squad = this.aliveSoldiers();
    for (const e of this.s.enemies) {
      if (!e.alive) continue;
      if (!squad.length) continue;
      const prey = this.nearestSoldier(e, squad);
      e.cooldown -= dt;
      const dx = prey.x - e.x, dz = prey.z - e.z;
      const dist = Math.hypot(dx, dz);
      e.yaw = Math.atan2(dx, dz);
      switch (e.kind) {
        case "infantry": {
          const speed = 3.1;
          if (dist > 34) this.walkEnemy(e, dx / (dist || 1) * speed * dt, dz / (dist || 1) * speed * dt);
          if (e.cooldown <= 0 && dist < 130) {
            e.burst = 3 + Math.floor(this.rand() * 3);
            e.cooldown = 1.7 + this.rand() * 1.5;
            this.enemyShoot(e, prey, 0.03 + dist / 7e3, 8);
          }
          break;
        }
        case "drone":
        case "fpv": {
          const target2 = e.chase >= 0 ? this.soldier(e.chase) : null;
          const tx = target2?.alive ? target2.x : prey.x, tz = target2?.alive ? target2.z : prey.z;
          const ddx = tx - e.x, ddz = tz - e.z, dd = Math.hypot(ddx, ddz) || 1;
          const sp = e.kind === "fpv" ? 11 : 7;
          this.walkEnemy(e, ddx / dd * sp * dt, ddz / dd * sp * dt);
          e.y = Math.max(4, e.y - dt * (e.kind === "fpv" ? 3.2 : 1.2));
          if (e.kind === "fpv" && dd < 7 && e.cooldown <= 0) {
            this.damageSoldier(prey, 58, e);
            e.hp = 0;
            this.explode(e.x, e.z);
          } else if (e.kind === "drone" && e.cooldown <= 0 && dd < 40) {
            e.cooldown = 2.2;
            this.enemyShoot(e, prey, 0.03);
          }
          break;
        }
        case "armor": {
          if (dist > 60) this.walkEnemy(e, dx / (dist || 1) * 1.4 * dt, dz / (dist || 1) * 1.4 * dt);
          if (e.cooldown <= 0 && dist < 220) {
            e.cooldown = 3.4;
            this.enemyShoot(e, prey, 0.05, 34);
            this.s.intensity = Math.min(1, this.s.intensity + 0.2);
          }
          break;
        }
      }
      if (e.hp <= 0 && e.alive) this.killEnemy(e, null);
    }
  }
  /** Ground enemies follow the nav flow field; drones fly over everything. */
  walkEnemy(e, mx, mz) {
    if (e.kind === "drone" || e.kind === "fpv") {
      e.x += mx;
      e.z += mz;
      return;
    }
    const r = 0.55;
    const len = Math.hypot(mx, mz);
    if (len < 1e-6) return;
    let heading = Math.atan2(mx, mz);
    if (e.target <= 0) {
      const gx = this.layout.spawn.x, gz = this.layout.spawn.z;
      const flow = this.nav.heading(e.x, e.z);
      if (flow !== null) heading = flow;
      else if (Math.hypot(gx - e.x, gz - e.z) > 3) {
        heading = Math.atan2(gx - e.x, gz - e.z);
      }
    } else {
      heading = e.target;
      if (Math.abs((heading - Math.atan2(mx, mz) + Math.PI * 3) % (Math.PI * 2) - Math.PI) < 0.6) e.target = 0;
    }
    const sx = Math.sin(heading) * len, sz = Math.cos(heading) * len;
    if (!blocked(this.layout, e.x + sx, e.z, r)) e.x += sx;
    if (!blocked(this.layout, e.x, e.z + sz, r)) e.z += sz;
    if (blocked(this.layout, e.x + sx, e.z + sz, r)) {
      const side = Math.sin(e.id) >= 0 ? 1 : -1;
      const ax = Math.sin(heading + side * 1.2) * len, az = Math.cos(heading + side * 1.2) * len;
      if (!blocked(this.layout, e.x + ax, e.z + az, r)) {
        e.x += ax;
        e.z += az;
      } else e.target = heading + side * Math.PI * 0.5;
    }
  }
  enemyShoot(e, target2, spread, dmg = 12) {
    const eyeY = target2.crouch ? BODY.crouchEye : BODY.eye;
    const ox = e.x, oy = e.y + 1.2, oz = e.z;
    const dx0 = target2.x - ox, dy0 = eyeY - oy, dz0 = target2.z - oz;
    const len = Math.hypot(dx0, dy0, dz0) || 1;
    const dx = dx0 / len + (this.rand() - 0.5) * spread * 4;
    const dy = dy0 / len + (this.rand() - 0.5) * spread * 3;
    const dz = dz0 / len + (this.rand() - 0.5) * spread * 4;
    const wall2 = raycastLevel(this.layout, ox, oy, oz, dx, dy, dz, 400) ?? 400;
    this.s.tracers.push({
      id: this.s.nextId++,
      from: { x: ox, y: oy, z: oz },
      to: { x: ox + dx * Math.min(wall2, 300), y: oy + dy * Math.min(wall2, 300), z: oz + dz * Math.min(wall2, 300) },
      t: 90,
      enemy: true
    });
    if (len < wall2) {
      this.damageSoldier(target2, dmg, e);
    } else {
      target2.suppress = Math.min(100, target2.suppress + 14);
      this.s.impacts.push({ id: this.s.nextId++, x: ox + dx * wall2, y: oy + dy * wall2, z: oz + dz * wall2, nx: -dx, ny: -dy, nz: -dz, t: 900, kind: "dirt" });
    }
    this.s.intensity = Math.min(1, this.s.intensity + 0.05);
  }
  damageSoldier(sol2, dmg, from) {
    if (!sol2.alive) return;
    if (sol2.crouch) dmg *= 0.72;
    sol2.hp -= dmg;
    sol2.suppress = Math.min(100, sol2.suppress + 18);
    if (sol2.hp <= 0) {
      sol2.alive = false;
      sol2.hp = 0;
      sol2.downedAt = this.s.time;
      this.events.push({ type: "kill", a: { id: sol2.id, by: from?.kind ?? "enemy" } });
    }
  }
  explode(x, z) {
    this.s.intensity = Math.min(1, this.s.intensity + 0.5);
    for (const sol2 of this.aliveSoldiers()) {
      const d = Math.hypot(sol2.x - x, sol2.z - z);
      if (d < 9) this.damageSoldier(sol2, 50 * (1 - d / 9), null);
    }
  }
  killEnemy(e, by) {
    e.alive = false;
    e.hp = 0;
    this.s.kills++;
    if (by) {
      by.kills++;
      const xp = e.kind === "armor" ? 260 : e.kind === "infantry" ? 60 : 40;
      const prevLevel = by.level;
      by.xp += xp;
      by.score += xp;
      by.level = levelOf(by.xp);
      if (by.level > prevLevel) this.events.push({ type: "wave", a: { levelUp: by.level, id: by.id } });
    }
    this.events.push({ type: "enemyKill", a: { kind: e.kind, x: e.x, z: e.z } });
    if (e.kind === "infantry" && this.rand() < 0.18) {
      this.s.supplies.push({
        id: this.s.nextId++,
        x: e.x,
        y: 0.2,
        z: e.z,
        falling: 0,
        opened: false,
        contents: [this.rand() < 0.5 ? "ak" : "shotgun"]
      });
    }
  }
  // ------------------------------------------------------------------ supply drops
  updateSupply(dt) {
    for (const b2 of this.s.supplies) {
      if (b2.falling > 0) {
        b2.falling = Math.max(0, b2.falling - dt);
        b2.y = 40 * (b2.falling / 6);
      }
    }
    this.s.dropTimer -= dt;
    if (this.s.dropTimer <= 0 && this.s.phase === "fight") {
      this.s.dropTimer = this.dropInterval;
      const zone = this.layout.drops[Math.floor(this.rand() * this.layout.drops.length)];
      const roll = this.rand();
      const contents = [roll < 0.35 ? "lmg" : roll < 0.7 ? "sniper" : "drone"];
      if (this.rand() < 0.35) contents.push("shotgun");
      this.s.supplies.push({ id: this.s.nextId++, x: zone.x, y: 40, z: zone.z, falling: 6, opened: false, contents });
      this.events.push({ type: "drop", a: { x: zone.x, z: zone.z } });
    }
  }
  openSupply(id, soldierId) {
    const box = this.s.supplies.find((b2) => b2.id === id);
    const sol2 = this.soldier(soldierId);
    if (!box || box.opened || box.falling > 0 || !sol2?.alive) return false;
    if (Math.hypot(sol2.x - box.x, sol2.z - box.z) > 3.2) return false;
    box.opened = true;
    for (const w of box.contents) if (!sol2.reserve.includes(w) && sol2.weapon !== w) sol2.reserve.push(w);
    sol2.ammo = WEAPONS[sol2.weapon].mag;
    sol2.hp = Math.min(sol2.maxHp, sol2.hp + 15);
    return true;
  }
  // ------------------------------------------------------------------ helpers
  cullEffects(dt) {
    const ms = dt * 1e3;
    if (this.s.tracers.length) this.s.tracers = this.s.tracers.filter((t) => (t.t -= ms) > 0);
    if (this.s.impacts.length) this.s.impacts = this.s.impacts.filter((t) => (t.t -= ms) > 0);
    if (this.s.enemies.length > 60) this.s.enemies = this.s.enemies.filter((e) => e.alive);
  }
  nearestEnemy(sol2, maxDist) {
    let best = null, bd = maxDist;
    for (const e of this.s.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - sol2.x, e.z - sol2.z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }
  nearestSoldier(e, squad) {
    let best = squad[0], bd = Infinity;
    for (const s of squad) {
      const d = Math.hypot(s.x - e.x, s.z - e.z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }
  raycastEnemies(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = null;
    for (const e of this.s.enemies) {
      if (!e.alive) continue;
      const r = e.kind === "armor" ? 2.4 : e.kind === "infantry" ? 0.55 : 0.6;
      const h = e.kind === "armor" ? 2.6 : e.kind === "infantry" ? 1.75 : 0.5;
      const baseY = e.kind === "drone" || e.kind === "fpv" ? e.y - 0.4 : e.y;
      const t = rayCapsule(ox, oy, oz, dx, dy, dz, e.x, baseY, e.z, r, h);
      if (t !== null && t < maxDist && (!best || t < best.t)) best = { e, t };
    }
    return best;
  }
  /** Serialisable snapshot for the network and for saves. */
  snapshot() {
    return this.s;
  }
};
function damageFalloff(dist, falloff) {
  if (dist <= falloff * 0.35) return 1;
  const k = 1 - (dist - falloff * 0.35) / (falloff * 0.9);
  return Math.max(0.28, k);
}
function rayCapsule(ox, oy, oz, dx, dy, dz, cx, baseY, cz, r, h) {
  const a2 = dx * dx + dz * dz;
  if (a2 < 1e-9) {
    const d2 = (ox - cx) ** 2 + (oz - cz) ** 2;
    return d2 <= r * r && oy >= baseY && oy <= baseY + h ? 0 : null;
  }
  const px = ox - cx, pz = oz - cz;
  const b2 = 2 * (px * dx + pz * dz);
  const c2 = px * px + pz * pz - r * r;
  const disc = b2 * b2 - 4 * a2 * c2;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b2 - sq) / (2 * a2);
  if (t < 0) t = (-b2 + sq) / (2 * a2);
  if (t < 0) return null;
  const y = oy + dy * t;
  return y >= baseY && y <= baseY + h ? t : null;
}

// test/sim.test.ts
var pass = 0;
var fail = 0;
var T = (name, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " " + extra : ""}`);
};
var a = generateLayout(1337);
var b = generateLayout(1337);
var c = generateLayout(1338);
T("layout deterministic", JSON.stringify(a.blocks) === JSON.stringify(b.blocks) && a.trees.length === b.trees.length);
T("different seeds differ", JSON.stringify(a.blocks) !== JSON.stringify(c.blocks));
T("map populated", a.blocks.length > 30 && a.trees.length > 200, `blocks=${a.blocks.length} trees=${a.trees.length}`);
T("spawn is clear", !blocked(a, a.spawn.x, a.spawn.z));
T("map edge blocks", blocked(a, MAP_SIZE / 2 + 4, 0) && blocked(a, 0, -MAP_SIZE / 2 - 4));
var down = raycastLevel(a, 0, 1.7, 0, 0, -1, 0, 100);
var up = raycastLevel(a, 0, 1.7, 0, 0, 0.9, 0.3, 100);
T("ray hits ground", down !== null && Math.abs(down - 1.7) < 0.2, `t=${down?.toFixed(2)}`);
T("ray misses sky", up === null);
var sim = new Sim(7, a);
var sol = sim.addSoldier("\u0422\u0435\u0441\u0442", false, 0);
var walk = (cmd, steps2, target2 = sol) => {
  for (let i = 0; i < steps2; i++) {
    const input = { ...EMPTY_INPUT, seq: i + 1, ...cmd };
    sim.step(/* @__PURE__ */ new Map([[target2.id, input]]));
  }
};
var x0 = sol.x;
var z0 = sol.z;
walk({ mx: 1, mz: 0 }, 20);
T("player moves", Math.hypot(sol.x - x0, sol.z - z0) > 1.5, `d=${Math.hypot(sol.x - x0, sol.z - z0).toFixed(2)}`);
var walked = Math.hypot(sol.x - x0, sol.z - z0);
sol.x = x0;
sol.z = z0;
sol.stamina = 100;
walk({ mx: 1, mz: 0, sprint: true }, 20);
T("sprint is faster", Math.hypot(sol.x - x0, sol.z - z0) > walked, `sprint=${Math.hypot(sol.x - x0, sol.z - z0).toFixed(2)}`);
sol.stamina = 0;
walk({ mx: 1, mz: 0, sprint: true }, 4);
T("no stamina means no sprint", !sol.sprint);
var wall = a.blocks.find((bl) => bl.kind === "house" || bl.kind === "container");
sol.x = wall.x - wall.hx - 3;
sol.z = wall.z;
sol.vx = 0;
sol.vz = 0;
for (let i = 0; i < 90; i++) {
  const input = { ...EMPTY_INPUT, seq: 1e3 + i, mx: 1, mz: 0, yaw: Math.PI / 2 };
  sim.step(/* @__PURE__ */ new Map([[sol.id, { ...input, mx: 1, mz: 0 }]]));
}
T("walls stop the player", sol.x < wall.x - wall.hx + 0.1, `x=${sol.x.toFixed(2)} wall=${(wall.x - wall.hx).toFixed(2)}`);
var s2 = new Sim(11, a);
var shooter = s2.addSoldier("\u0421\u0442\u0440\u0435\u043B\u043E\u043A", false, 0);
var target = s2.spawnEnemy("infantry", { x: shooter.x + 12, z: shooter.z });
shooter.yaw = Math.atan2(target.x - shooter.x, target.z - shooter.z);
var hp0 = target.hp;
for (let i = 0; i < 60; i++) {
  s2.step(/* @__PURE__ */ new Map([[shooter.id, { ...EMPTY_INPUT, seq: i + 1, fire: true, yaw: shooter.yaw }]]));
  if (!target.alive) break;
}
T("bullets kill infantry", target.hp < hp0, `hp ${hp0} -> ${target.hp.toFixed(0)}`);
T("ammo is consumed", shooter.ammo < WEAPONS.ak.mag, `ammo=${shooter.ammo}`);
T("kills award xp", shooter.xp > 0, `xp=${shooter.xp}`);
var s3 = new Sim(13, a);
var gunner = s3.addSoldier("\u041F\u0443\u043B\u0435\u043C\u0451\u0442\u0447\u0438\u043A", false, 0);
var house = a.blocks.find((bl) => bl.kind === "house");
gunner.x = house.x - house.hx - 4;
gunner.z = house.z;
var hidden = s3.spawnEnemy("infantry", { x: house.x + house.hx + 4, z: house.z });
gunner.yaw = Math.atan2(hidden.x - gunner.x, hidden.z - gunner.z);
for (let i = 0; i < 40; i++) s3.step(/* @__PURE__ */ new Map([[gunner.id, { ...EMPTY_INPUT, seq: i + 1, fire: true, yaw: gunner.yaw }]]));
T("buildings block bullets", hidden.hp === hidden.maxHp, `hp=${hidden.hp}`);
var s4 = new Sim(17, a);
var marines = [0, 1, 2].map((i) => s4.addSoldier(`\u0411${i}`, true, i));
var steps = 0;
while (s4.s.phase === "intro" && steps < 20 * 120) {
  s4.step(/* @__PURE__ */ new Map());
  steps++;
}
T("intro ends in first contact", s4.s.phase === "fight", `steps=${steps}`);
for (let i = 0; i < 20 * 90; i++) s4.step(/* @__PURE__ */ new Map());
T("enemies spawn in waves", s4.s.enemies.length > 0, `enemies=${s4.s.enemies.length} wave=${s4.s.wave.index}`);
T("bots engage", s4.s.kills > 0, `kills=${s4.s.kills}`);
T("squad can die", marines.some((m) => m.hp < m.maxHp), `hp=${marines.map((m) => m.hp.toFixed(0)).join(",")}`);
T("supply drops happen", (() => {
  for (let i = 0; i < 20 * 180; i++) s4.step(/* @__PURE__ */ new Map());
  return s4.s.supplies.length > 0;
})(), `drops=${s4.s.supplies.length}`);
T("survival clock runs", s4.s.survived > 60, `t=${s4.s.survived.toFixed(0)}s`);
var s5 = new Sim(19, a);
var idle = s5.addSoldier("\u0421\u0442\u043E\u044F\u0449\u0438\u0439", false, 0);
s5.s.phase = "fight";
s5.spawnEnemy("infantry", { x: idle.x + 25, z: idle.z });
var hitAt = -1;
for (let i = 0; i < 20 * 40 && idle.alive; i++) {
  s5.step(/* @__PURE__ */ new Map([[idle.id, { ...EMPTY_INPUT, seq: i + 1 }]]));
  if (hitAt < 0 && idle.hp < idle.maxHp) hitAt = s5.s.survived;
}
T("standing still gets you shot", idle.hp < idle.maxHp, `hp=${idle.hp.toFixed(0)} at t=${hitAt.toFixed(1)}`);
T("levels grow", levelOf(0) === 1 && levelOf(900) > levelOf(400) && levelOf(4e4) > levelOf(900));
T("perks unlock with level", perksOf(1).length === 0 && perksOf(10).length >= 4 && perksOf(20).length === perksOf(30).length);
var runA = new Sim(23, generateLayout(5));
var runB = new Sim(23, generateLayout(5));
for (const r of [runA, runB]) {
  r.addSoldier("A", false, 0);
  r.s.phase = "fight";
}
var inputs = /* @__PURE__ */ new Map([[1, { ...EMPTY_INPUT, seq: 1, mx: 0.7, mz: 0.3, fire: true }]]);
for (let i = 0; i < 400; i++) {
  runA.step(inputs);
  runB.step(inputs);
}
T("sim is deterministic", runA.s.kills === runB.s.kills && runA.s.enemies.length === runB.s.enemies.length);
T("tick rate sane", TICK === 0.05);
console.log(`
${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
