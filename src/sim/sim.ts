import type { EnemyKind, EnemyState, GameState, InputCmd, SoldierState, WeaponId } from '../core/types';
import { TICK } from '../core/types';
import { BODY, SPEED, WEAPONS, levelOf } from './weapons';
import { blocked, raycastLevel, type Layout } from '../world/layout';
import { NavGrid } from '../world/nav';

/**
 * Authoritative simulation, 20 steps per second. No rendering, no DOM, no
 * network — which is why it runs headless in the tests. Both the host and the
 * solo player run this exact class, so single player and co-op cannot diverge.
 */

export interface SimEvent {
  type: 'shot' | 'impact' | 'kill' | 'enemyKill' | 'drop' | 'hit' | 'wave' | 'reload' | 'pinch';
  a?: unknown;
}

const WAVE_NAMES = [
  'Первая кровь', 'Разведка боем', 'Огневой вал', 'Дроны над полем', 'Мясорубка',
  'Ночь на передке', 'Артиллерийская подготовка', 'Клин в стык', 'Тучи', 'Последний рубеж',
];

export class Sim {
  s: GameState;
  layout: Layout;
  events: SimEvent[] = [];
  private rngState: number;
  /** supply drop cadence in seconds — short enough to matter, long enough to risk */
  private dropInterval = 165;

  nav: NavGrid;

  constructor(seed: number, layout: Layout) {
    this.layout = layout;
    this.nav = new NavGrid(layout);
    this.rngState = (seed ^ 0x9e3779b9) >>> 0;
    this.s = {
      version: 1, seed, tick: 0, time: 0,
      soldiers: [], enemies: [], supplies: [], tracers: [], impacts: [],
      nextId: 1,
      wave: { index: 0, name: 'Тишина', timer: 90, active: false, remaining: 0 },
      survived: 0, intensity: 0, dropTimer: this.dropInterval, phase: 'intro',
      kills: 0, armorUnlocked: false,
    };
  }

  private rand(): number {
    this.rngState = (this.rngState + 0x6D2B79F5) >>> 0;
    let t = Math.imul(this.rngState ^ (this.rngState >>> 15), 1 | this.rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ------------------------------------------------------------------ soldiers
  addSoldier(name: string, bot: boolean, slot: number, xp = 0): SoldierState {
    const st = this.layout.starts[slot % this.layout.starts.length];
    const lvl = levelOf(xp);
    const s: SoldierState = {
      id: this.s.nextId++, name, bot, alive: true, downedAt: 0,
      x: st.x, y: 0, z: st.z, vx: 0, vz: 0, yaw: 0, pitch: 0,
      hp: 100 + (lvl >= 4 ? 10 : 0), maxHp: 100 + (lvl >= 4 ? 10 : 0),
      stamina: 100, crouch: false, sprint: false,
      weapon: 'ak', reserve: ['shotgun', 'sniper', 'lmg'], ammo: WEAPONS.ak.mag, magSize: WEAPONS.ak.mag,
      reloadingUntil: 0, lastShot: -9999,
      xp, level: lvl, kills: 0, score: 0, suppress: 0, recoil: 0, lastShotPrev: -9999, lastSeq: 0,
      netX: st.x, netY: 0, netZ: st.z,
    };
    this.s.soldiers.push(s);
    return s;
  }

  removeSoldier(id: number) {
    this.s.soldiers = this.s.soldiers.filter((x) => x.id !== id);
  }

  soldier(id: number) {
    return this.s.soldiers.find((x) => x.id === id);
  }

  aliveSoldiers() {
    return this.s.soldiers.filter((x) => x.alive);
  }

  // ------------------------------------------------------------------ main step
  step(inputs: Map<number, InputCmd>) {
    this.s.tick++;
    this.s.time += TICK * 1000;
    if (this.s.phase !== 'intro') this.s.survived += TICK;

    for (const sol of this.s.soldiers) {
      if (!sol.alive) continue;
      const cmd = inputs.get(sol.id);
      if (cmd) this.applyInput(sol, cmd);
      else if (sol.bot) this.botThink(sol);
      else { sol.vx = 0; sol.vz = 0; }
      this.moveSoldier(sol, TICK);
      this.regen(sol);
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
    if (this.s.phase === 'fight' && this.s.survived > 20 && this.s.soldiers.length && this.aliveSoldiers().length === 0) {
      this.s.phase = 'overrun';
      this.s.wave.active = false;
      this.events.push({ type: 'wave', a: { overrun: true } });
    }
    this.s.intensity = Math.max(0, this.s.intensity - TICK * 0.12);
  }

  // ------------------------------------------------------------------ player movement
  private applyInput(sol: SoldierState, cmd: InputCmd) {
    sol.lastSeq = Math.max(sol.lastSeq, cmd.seq);
    sol.yaw = cmd.yaw;
    sol.pitch = Math.max(-1.45, Math.min(1.45, cmd.pitch));
    sol.crouch = cmd.crouch;
    const wantSprint = cmd.sprint && !cmd.crouch && sol.stamina > 2 && (cmd.mx !== 0 || cmd.mz !== 0);
    sol.sprint = wantSprint;
    const speed = cmd.crouch ? SPEED.crouch : wantSprint ? SPEED.sprint : SPEED.walk;
    const mag = Math.hypot(cmd.mx, cmd.mz);
    const norm = mag > 1 ? 1 : mag;
    sol.vx = norm > 0 ? (cmd.mx / (mag || 1)) * speed * norm : 0;
    sol.vz = norm > 0 ? (cmd.mz / (mag || 1)) * speed * norm : 0;
    // stamina
    if (wantSprint && mag > 0.1) sol.stamina = Math.max(0, sol.stamina - TICK * 12);
    else sol.stamina = Math.min(100, sol.stamina + TICK * (cmd.crouch ? 12 : 7));

    if (cmd.reload) this.startReload(sol);
    if (cmd.use) this.useBandage(sol);
    if (cmd.fire) this.tryFire(sol);
  }

  private moveSoldier(sol: SoldierState, dt: number) {
    if (sol.vx === 0 && sol.vz === 0) return;
    const nx = sol.x + sol.vx * dt;
    const nz = sol.z + sol.vz * dt;
    const r = BODY.radius;
    // slide along walls instead of sticking to them
    if (!blocked(this.layout, nx, sol.z, r)) sol.x = nx;
    if (!blocked(this.layout, sol.x, nz, r)) sol.z = nz;
    sol.netX = sol.x; sol.netZ = sol.z;
  }

  private regen(sol: SoldierState) {
    sol.suppress = Math.max(0, sol.suppress - TICK * 22);
    // Recoil settles quickly; that slow tap-fire is the difference between a
    // marksman and a panic spray.
    sol.recoil = Math.max(0, (sol.recoil ?? 0) - TICK * 2.1);
    if (sol.hp < sol.maxHp && sol.suppress < 5) sol.hp = Math.min(sol.maxHp, sol.hp + TICK * 0.7);
  }

  /** Bots use the same primitives as players, so behaviour is fair and testable. */
  private botThink(sol: SoldierState) {
    if (sol.hp < 34) {
      // pull back toward the crash site and keep low
      const dx = this.layout.spawn.x - sol.x, dz = this.layout.spawn.z - sol.z;
      const d = Math.hypot(dx, dz) || 1;
      sol.crouch = true;
      sol.vx = (dx / d) * SPEED.walk * (d > 6 ? 1 : 0);
      sol.vz = (dz / d) * SPEED.walk * (d > 6 ? 1 : 0);
      sol.yaw = Math.atan2(-dx, -dz);
      return;
    }
    const target = this.nearestEnemy(sol, 190);
    if (target) {
      const dx = target.x - sol.x, dz = target.z - sol.z;
      sol.yaw = Math.atan2(dx, dz);
      const d = Math.hypot(dx, dz);
      sol.crouch = d < 45;
      // Aim at the target's chest — without this every bot shot hits the dirt.
      const eye = sol.crouch ? BODY.crouchEye : BODY.eye;
      sol.pitch = Math.atan2(1.15 - eye, Math.max(1, d));
      // Line of sight decides everything: no shot through a wall, and if the
      // view is blocked the bot flanks sideways instead of shooting concrete.
      const cp = Math.cos(sol.pitch);
      const fx = Math.sin(sol.yaw) * cp, fy = Math.sin(sol.pitch), fz = Math.cos(sol.yaw) * cp;
      const wall = raycastLevel(this.layout, sol.x, eye, sol.z, fx, fy, fz, d + 2);
      const los = wall === null || wall > d - 1.2;
      // hold position when the enemy is in range, otherwise close in a little
      const want = !los ? 0.15 : d > 60 ? 1 : d > 30 ? 0.35 : -0.2;
      sol.vx = (dx / (d || 1)) * SPEED.walk * want;
      sol.vz = (dz / (d || 1)) * SPEED.walk * want;
      if (!los) {
        // sidestep to find the angle
        const side = (Math.floor(sol.x + sol.z) % 2 === 0 ? 1 : -1);
        sol.vx = (-dz / (d || 1)) * SPEED.walk * side;
        sol.vz = (dx / (d || 1)) * SPEED.walk * side;
      }
      // Fire discipline: tap at range, burst up close, and use the long gun when far.
      if (d > 90 && sol.weapon === 'ak' && sol.reserve.includes('sniper')) this.swapWeapon(sol, 'sniper');
      else if (d < 45 && (sol.weapon === 'sniper' || sol.weapon === 'lmg') && sol.reserve.includes('ak')) this.swapWeapon(sol, 'ak');
      if (los && d < 190 && (d < 60 || this.s.tick % 4 === 0 || sol.weapon === 'sniper')) this.tryFire(sol);
      else if (!los && sol.ammo === 0) this.startReload(sol);
    } else {
      // patrol toward the crash site
      const dx = this.layout.spawn.x - sol.x, dz = this.layout.spawn.z - sol.z;
      const d = Math.hypot(dx, dz);
      sol.vx = d > 4 ? (dx / d) * SPEED.walk * 0.6 : 0;
      sol.vz = d > 4 ? (dz / d) * SPEED.walk * 0.6 : 0;
      sol.yaw = Math.atan2(sol.vx, sol.vz);
    }
  }

  // ------------------------------------------------------------------ shooting
  private tryFire(sol: SoldierState) {
    const w = WEAPONS[sol.weapon];
    if (this.s.time < sol.reloadingUntil) return;
    if (this.s.time - sol.lastShot < w.cadence) return;
    if (sol.ammo <= 0) { this.startReload(sol); return; }
    const sincePrev = this.s.time - (sol.lastShotPrev ?? -9999);
    sol.lastShot = this.s.time;
    sol.ammo--;
    // Recoil climbs while you keep the trigger down; it bleeds off when you pause.
    sol.recoil = Math.min(1.6, (sol.recoil ?? 0) + (sincePrev < w.cadence * 2.2 ? w.recoil * 0.09 : 0));
    sol.lastShotPrev = this.s.time;
    const spread = this.spreadOf(sol, w.spread) * (1 + (sol.recoil ?? 0) * 0.55);
    const dirs = w.pellets;
    let hitSomething = false;
    for (let i = 0; i < dirs; i++) {
      const yaw = sol.yaw + (this.rand() - 0.5) * spread * 2;
      const pitch = sol.pitch + (this.rand() - 0.5) * spread * 2;
      const dx = Math.sin(yaw) * Math.cos(pitch);
      const dy = Math.sin(pitch);
      const dz = Math.cos(yaw) * Math.cos(pitch);
      const eye = sol.crouch ? BODY.crouchEye : BODY.eye;
      const wall = raycastLevel(this.layout, sol.x, eye, sol.z, dx, dy, dz, 400) ?? 400;
      const enemyHit = this.raycastEnemies(sol.x, eye, sol.z, dx, dy, dz, Math.min(wall, 400));
      if (enemyHit) {
        hitSomething = true;
        const { e, t } = enemyHit;
        const dmg = w.dmg * damageFalloff(t, w.falloff);
        e.hp -= dmg;
        this.s.intensity = Math.min(1, this.s.intensity + 0.08);
        this.events.push({ type: 'hit', a: { x: sol.x + dx * t, y: eye + dy * t, z: sol.z + dz * t } });
        if (e.hp <= 0 && e.alive) this.killEnemy(e, sol);
      }
      this.s.tracers.push({
        id: this.s.nextId++, from: { x: sol.x, y: eye, z: sol.z },
        to: { x: sol.x + dx * Math.min(wall, 400), y: eye + dy * Math.min(wall, 400), z: sol.z + dz * Math.min(wall, 400) },
        t: 90, enemy: false,
      });
    }
    if (!hitSomething) {
      const d = 90;
      const endX = sol.x + Math.sin(sol.yaw) * d, endZ = sol.z + Math.cos(sol.yaw) * d;
      this.s.impacts.push({ id: this.s.nextId++, x: endX, y: 0.05, z: endZ, nx: 0, ny: 1, nz: 0, t: 1200, kind: 'dirt' });
    }
    if (w.id === 'drone') {
      // the drone is a single-use weapon: discard and fall back to the rifle
      sol.reserve = sol.reserve.filter((r) => r !== 'drone');
      this.swapWeapon(sol, sol.weapon === 'ak' ? 'shotgun' : sol.weapon);
    }
    this.events.push({ type: 'shot', a: { weapon: w.id, x: sol.x, z: sol.z } });
  }

  private spreadOf(sol: SoldierState, base: number): number {
    let sp = base;
    if (sol.sprint) sp *= 2.4;
    else if (Math.abs(sol.vx) + Math.abs(sol.vz) > 0.5) sp *= 1.5;
    if (sol.crouch) sp *= 0.7;
    sp *= 1 + sol.suppress / 60;
    return sp;
  }

  startReload(sol: SoldierState) {
    const w = WEAPONS[sol.weapon];
    if (sol.ammo >= w.mag || this.s.time < sol.reloadingUntil) return;
    const fast = sol.level >= 8 ? 0.85 : 1;
    sol.reloadingUntil = this.s.time + w.reloadMs * fast;
    sol.ammo = w.mag;
    this.events.push({ type: 'reload', a: { id: sol.id } });
  }

  private useBandage(sol: SoldierState) {
    const heal = sol.level >= 20 ? 37 : 30;
    if (sol.hp >= sol.maxHp) return;
    sol.hp = Math.min(sol.maxHp, sol.hp + heal);
  }

  swapWeapon(sol: SoldierState, id: WeaponId) {
    if (!WEAPONS[id]) return;
    if (sol.reserve.includes(id)) sol.reserve = sol.reserve.filter((r) => r !== id);
    sol.reserve.unshift(sol.weapon);
    sol.weapon = id;
    sol.magSize = WEAPONS[id].mag;
    sol.ammo = WEAPONS[id].mag;
    sol.reloadingUntil = 0;
  }

  // ------------------------------------------------------------------ enemies
  private updateWave(dt: number) {
    const w = this.s.wave;
    if (this.s.phase === 'intro') {
      w.timer -= dt;
      if (w.timer <= 0) {
        this.s.phase = 'fight';
        this.startWave();
      }
      return;
    }
    if (w.active) {
      const alive = this.s.enemies.filter((e) => e.alive).length;
      if (alive === 0 && w.remaining === 0 && w.timer > 0) { w.timer -= dt; if (w.timer <= 0) { this.startWave(); } return; }
      w.remaining = alive;
      if (alive === 0) {
        w.active = false;
        w.timer = Math.max(22, 42 - w.index * 1.2);
        w.name = 'Передышка';
        this.events.push({ type: 'wave', a: { done: true, index: w.index } });
        // small breather reward: patch up the squad
        for (const sol of this.s.soldiers) if (sol.alive) sol.hp = Math.min(sol.maxHp, sol.hp + 12);
      }
    } else {
      w.timer -= dt;
      if (w.timer <= 0) this.startWave();
    }
  }

  private startWave() {
    const w = this.s.wave;
    w.index++;
    w.active = true;
    w.name = WAVE_NAMES[(w.index - 1) % WAVE_NAMES.length] + (w.index > WAVE_NAMES.length ? ` · ${Math.ceil(w.index / WAVE_NAMES.length)}` : '');
    if (w.index >= 5) this.s.armorUnlocked = true;
    const count = Math.min(26, 3 + Math.round(w.index * 1.7));
    for (let i = 0; i < count; i++) {
      const drone = this.rand() < Math.min(0.42, 0.06 + w.index * 0.035);
      const kind: EnemyKind = drone ? (this.rand() < 0.55 ? 'fpv' : 'drone') : 'infantry';
      this.spawnEnemy(kind);
    }
    if (this.s.armorUnlocked && w.index % 4 === 0) this.spawnEnemy('armor');
    this.events.push({ type: 'wave', a: { index: w.index, name: w.name } });
  }

  spawnEnemy(kind: EnemyKind, at?: { x: number; z: number }) {
    const gate = at ?? this.layout.gates[Math.floor(this.rand() * this.layout.gates.length)];
    const jitter = kind === 'infantry' ? 10 : 4;
    const hp = kind === 'armor' ? 620 : kind === 'infantry' ? 100 : kind === 'fpv' ? 40 : 55;
    const e: EnemyState = {
      id: this.s.nextId++, kind, x: gate.x + (this.rand() - 0.5) * jitter, z: gate.z + (this.rand() - 0.5) * jitter,
      y: kind === 'drone' || kind === 'fpv' ? 22 + this.rand() * 14 : 0,
      hp, maxHp: hp, target: 0, cooldown: 1 + this.rand() * 2, yaw: 0, alive: true, chase: -1, burst: 0,
    };
    this.s.enemies.push(e);
    return e;
  }

  private updateEnemies(dt: number) {
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
        case 'infantry': {
          // advance to ~35 m, then hold and fire in bursts
          const speed = 3.1;
          if (dist > 34) this.walkEnemy(e, (dx / (dist || 1)) * speed * dt, (dz / (dist || 1)) * speed * dt);
          if (e.cooldown <= 0 && dist < 130) {
            e.burst = 3 + Math.floor(this.rand() * 3);
            e.cooldown = 1.7 + this.rand() * 1.5;
            this.enemyShoot(e, prey, 0.03 + dist / 7000, 8);
          }
          break;
        }
        case 'drone':
        case 'fpv': {
          // drones hunt a specific soldier and dive at them
          const target = e.chase >= 0 ? this.soldier(e.chase) : null;
          const tx = target?.alive ? target.x : prey.x, tz = target?.alive ? target.z : prey.z;
          const ddx = tx - e.x, ddz = tz - e.z, dd = Math.hypot(ddx, ddz) || 1;
          const sp = e.kind === 'fpv' ? 11 : 7;
          this.walkEnemy(e, (ddx / dd) * sp * dt, (ddz / dd) * sp * dt);
          e.y = Math.max(4, e.y - dt * (e.kind === 'fpv' ? 3.2 : 1.2));
          if (e.kind === 'fpv' && dd < 7 && e.cooldown <= 0) {
            this.damageSoldier(prey, 58, e);
            e.hp = 0;
            this.explode(e.x, e.z);
          } else if (e.kind === 'drone' && e.cooldown <= 0 && dd < 40) {
            e.cooldown = 2.2;
            this.enemyShoot(e, prey, 0.03);
          }
          break;
        }
        case 'armor': {
          if (dist > 60) this.walkEnemy(e, (dx / (dist || 1)) * 1.4 * dt, (dz / (dist || 1)) * 1.4 * dt);
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
  private walkEnemy(e: EnemyState, mx: number, mz: number) {
    if (e.kind === 'drone' || e.kind === 'fpv') { e.x += mx; e.z += mz; return; }
    const r = 0.55;
    const len = Math.hypot(mx, mz);
    if (len < 1e-6) return;
    let heading = Math.atan2(mx, mz);
    // e.target: 0 = follow the flow field, >0 = a wall-hugging detour heading
    if (e.target <= 0) {
      const gx = this.layout.spawn.x, gz = this.layout.spawn.z;
      const flow = this.nav.heading(e.x, e.z);
      if (flow !== null) heading = flow;
      else if (Math.hypot(gx - e.x, gz - e.z) > 3) {
        // inside a cell the BFS could not reach: aim straight at the goal
        heading = Math.atan2(gx - e.x, gz - e.z);
      }
    } else {
      heading = e.target;
      if (Math.abs(((heading - Math.atan2(mx, mz) + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.6) e.target = 0;
    }
    const sx = Math.sin(heading) * len, sz = Math.cos(heading) * len;
    if (!blocked(this.layout, e.x + sx, e.z, r)) e.x += sx;
    if (!blocked(this.layout, e.x, e.z + sz, r)) e.z += sz;
    // shove sideways when the direct step is refused, so nobody welds to a wall
    if (blocked(this.layout, e.x + sx, e.z + sz, r)) {
      const side = Math.sin(e.id) >= 0 ? 1 : -1;
      const ax = Math.sin(heading + side * 1.2) * len, az = Math.cos(heading + side * 1.2) * len;
      if (!blocked(this.layout, e.x + ax, e.z + az, r)) { e.x += ax; e.z += az; }
      else e.target = heading + side * Math.PI * 0.5;
    }
  }

  private enemyShoot(e: EnemyState, target: SoldierState, spread: number, dmg = 12) {
    const eyeY = target.crouch ? BODY.crouchEye : BODY.eye;
    const ox = e.x, oy = e.y + 1.2, oz = e.z;
    const dx0 = target.x - ox, dy0 = eyeY - oy, dz0 = target.z - oz;
    const len = Math.hypot(dx0, dy0, dz0) || 1;
    const dx = dx0 / len + (this.rand() - 0.5) * spread * 4;
    const dy = dy0 / len + (this.rand() - 0.5) * spread * 3;
    const dz = dz0 / len + (this.rand() - 0.5) * spread * 4;
    const wall = raycastLevel(this.layout, ox, oy, oz, dx, dy, dz, 400) ?? 400;
    this.s.tracers.push({
      id: this.s.nextId++, from: { x: ox, y: oy, z: oz },
      to: { x: ox + dx * Math.min(wall, 300), y: oy + dy * Math.min(wall, 300), z: oz + dz * Math.min(wall, 300) },
      t: 90, enemy: true,
    });
    if (len < wall) {
      this.damageSoldier(target, dmg, e);
    } else {
      target.suppress = Math.min(100, target.suppress + 14);
      this.s.impacts.push({ id: this.s.nextId++, x: ox + dx * wall, y: oy + dy * wall, z: oz + dz * wall, nx: -dx, ny: -dy, nz: -dz, t: 900, kind: 'dirt' });
    }
    this.s.intensity = Math.min(1, this.s.intensity + 0.05);
  }

  damageSoldier(sol: SoldierState, dmg: number, from: EnemyState | null) {
    if (!sol.alive) return;
    // Cover and posture matter: crouching behind something is a real advantage.
    if (sol.crouch) dmg *= 0.72;
    sol.hp -= dmg;
    sol.suppress = Math.min(100, sol.suppress + 18);
    if (sol.hp <= 0) {
      sol.alive = false;
      sol.hp = 0;
      sol.downedAt = this.s.time;
      this.events.push({ type: 'kill', a: { id: sol.id, by: from?.kind ?? 'enemy' } });
    }
  }

  private explode(x: number, z: number) {
    this.s.intensity = Math.min(1, this.s.intensity + 0.5);
    for (const sol of this.aliveSoldiers()) {
      const d = Math.hypot(sol.x - x, sol.z - z);
      if (d < 9) this.damageSoldier(sol, 50 * (1 - d / 9), null);
    }
  }

  private killEnemy(e: EnemyState, by: SoldierState | null) {
    e.alive = false;
    e.hp = 0;
    this.s.kills++;
    if (by) {
      by.kills++;
      const xp = e.kind === 'armor' ? 260 : e.kind === 'infantry' ? 60 : 40;
      const prevLevel = by.level;
      by.xp += xp;
      by.score += xp;
      by.level = levelOf(by.xp);
      if (by.level > prevLevel) this.events.push({ type: 'wave', a: { levelUp: by.level, id: by.id } });
    }
    this.events.push({ type: 'enemyKill', a: { kind: e.kind, x: e.x, z: e.z } });
    if (e.kind === 'infantry' && this.rand() < 0.18) {
      this.s.supplies.push({
        id: this.s.nextId++, x: e.x, y: 0.2, z: e.z, falling: 0, opened: false,
        contents: [this.rand() < 0.5 ? 'ak' : 'shotgun'],
      });
    }
  }

  // ------------------------------------------------------------------ supply drops
  private updateSupply(dt: number) {
    for (const b of this.s.supplies) {
      if (b.falling > 0) {
        b.falling = Math.max(0, b.falling - dt);
        b.y = 40 * (b.falling / 6);
      }
    }
    this.s.dropTimer -= dt;
    if (this.s.dropTimer <= 0 && this.s.phase === 'fight') {
      this.s.dropTimer = this.dropInterval;
      const zone = this.layout.drops[Math.floor(this.rand() * this.layout.drops.length)];
      const roll = this.rand();
      const contents: WeaponId[] = [roll < 0.35 ? 'lmg' : roll < 0.7 ? 'sniper' : 'drone'];
      if (this.rand() < 0.35) contents.push('shotgun');
      this.s.supplies.push({ id: this.s.nextId++, x: zone.x, y: 40, z: zone.z, falling: 6, opened: false, contents });
      this.events.push({ type: 'drop', a: { x: zone.x, z: zone.z } });
    }
  }

  openSupply(id: number, soldierId: number): boolean {
    const box = this.s.supplies.find((b) => b.id === id);
    const sol = this.soldier(soldierId);
    if (!box || box.opened || box.falling > 0 || !sol?.alive) return false;
    if (Math.hypot(sol.x - box.x, sol.z - box.z) > 3.2) return false;
    box.opened = true;
    for (const w of box.contents) if (!sol.reserve.includes(w) && sol.weapon !== w) sol.reserve.push(w);
    sol.ammo = WEAPONS[sol.weapon].mag;
    sol.hp = Math.min(sol.maxHp, sol.hp + 15);
    return true;
  }

  // ------------------------------------------------------------------ helpers
  private cullEffects(dt: number) {
    const ms = dt * 1000;
    if (this.s.tracers.length) this.s.tracers = this.s.tracers.filter((t) => (t.t -= ms) > 0);
    if (this.s.impacts.length) this.s.impacts = this.s.impacts.filter((t) => (t.t -= ms) > 0);
    // dead enemies are removed from the list after a moment so the renderer can fade them
    if (this.s.enemies.length > 60) this.s.enemies = this.s.enemies.filter((e) => e.alive);
  }

  nearestEnemy(sol: SoldierState, maxDist: number): EnemyState | null {
    let best: EnemyState | null = null, bd = maxDist;
    for (const e of this.s.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - sol.x, e.z - sol.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  private nearestSoldier(e: EnemyState, squad: SoldierState[]): SoldierState {
    let best = squad[0], bd = Infinity;
    for (const s of squad) {
      const d = Math.hypot(s.x - e.x, s.z - e.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  private raycastEnemies(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): { e: EnemyState; t: number } | null {
    let best: { e: EnemyState; t: number } | null = null;
    for (const e of this.s.enemies) {
      if (!e.alive) continue;
      const r = e.kind === 'armor' ? 2.4 : e.kind === 'infantry' ? 0.55 : 0.6;
      const h = e.kind === 'armor' ? 2.6 : e.kind === 'infantry' ? 1.75 : 0.5;
      const baseY = e.kind === 'drone' || e.kind === 'fpv' ? e.y - 0.4 : e.y;
      const t = rayCapsule(ox, oy, oz, dx, dy, dz, e.x, baseY, e.z, r, h);
      if (t !== null && t < maxDist && (!best || t < best.t)) best = { e, t };
    }
    return best;
  }

  /** Serialisable snapshot for the network and for saves. */
  snapshot(): GameState {
    return this.s;
  }
}

function damageFalloff(dist: number, falloff: number): number {
  if (dist <= falloff * 0.35) return 1;
  const k = 1 - (dist - falloff * 0.35) / (falloff * 0.9);
  return Math.max(0.28, k);
}

/** Vertical capsule test: cheap approximation (cylinder + height band). */
function rayCapsule(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, baseY: number, cz: number, r: number, h: number): number | null {
  const a = dx * dx + dz * dz;
  if (a < 1e-9) {
    const d2 = (ox - cx) ** 2 + (oz - cz) ** 2;
    return d2 <= r * r && oy >= baseY && oy <= baseY + h ? 0 : null;
  }
  const px = ox - cx, pz = oz - cz;
  const b = 2 * (px * dx + pz * dz);
  const c = px * px + pz * pz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) t = (-b + sq) / (2 * a);
  if (t < 0) return null;
  const y = oy + dy * t;
  return y >= baseY && y <= baseY + h ? t : null;
}
