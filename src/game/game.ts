import { EMPTY_INPUT, TICK_MS, type GameState, type InputCmd, type SoldierState } from '../core/types';
import { Sim } from '../sim/sim';
import { generateLayout } from '../world/layout';
import { Engine } from '../render/engine';
import { buildSurfaces } from '../render/textures';
import { buildWorld } from '../render/world';
import { EntityView } from '../render/entities';
import { ViewModel } from '../render/viewmodel';
import { Weather } from '../render/particles';
import { Controller } from './controller';
import { InputState } from './input';
import { AudioEngine } from './audio';
import type { Profile } from '../core/profile';
import { ownedMod, saveProfile } from '../core/profile';
import { levelOf, WEAPONS, type Perk } from '../sim/weapons';
import { perksOf } from '../sim/weapons';
import type { Net } from '../net/net';

/**
 * The match loop.
 *
 * Two clocks: the simulation runs on a fixed 20 Hz accumulator (host-authoritative
 * in co-op), while rendering runs free at the display rate and interpolates the
 * camera from the freshest state. Input is sampled per frame and applied to the
 * next sim step, so a 144 Hz display doesn't fire 144 times a second.
 */

export interface MatchConfig {
  seed: number;
  bots: number;
  difficulty: number;
  playerName: string;
  profile: Profile;
  net: Net | null;
  host: boolean;
}

export interface MatchHooks {
  onState: (s: GameState) => void;
  onKill: (text: string) => void;
  onBanner: (title: string, sub?: string, ms?: number) => void;
  onOver: (result: { survived: number; kills: number; xp: number; level: number }) => void;
  onHint: (text: string | null) => void;
  onHitmark: () => void;
  onPause: (paused?: boolean) => void;
}

export class Match {
  readonly engine: Engine;
  readonly sim: Sim;
  readonly layout = generateLayout(0);
  readonly input: InputState;
  readonly view: ViewModel;
  readonly entities: EntityView;
  readonly weather: Weather;
  readonly audio = new AudioEngine();
  readonly controller: Controller;
  private cfg: MatchConfig;
  private hooks: MatchHooks;
  me: SoldierState | null = null;
  private acc = 0;
  private last = performance.now();
  private frames = 0;
  private fpsTimer = 0;
  fps = 60;
  paused = false;
  over = false;
  private seq = 0;
  private shotCooldown = 0;
  private hurtFlash = 0;
  private prevHp = 100;
  private bannerTimer = 0;
  private heartTimer = 0;
  private shellTimer = 40;
  private lastEventIdx = 0;
  private sensitivity = 1;
  private disposal: Array<() => void> = [];
  private perks: Perk[] = [];
  /** host: player soldier id by peer id */
  private remoteIds = new Map<string, number>();
  private remoteInput = new Map<string, InputCmd>();
  private lastTracerCount = 0;
  private lastPublish = 0;

  constructor(canvas: HTMLCanvasElement, cfg: MatchConfig, hooks: MatchHooks) {
    this.cfg = cfg;
    this.hooks = hooks;
    this.layout = generateLayout(cfg.seed);
    this.engine = new Engine(canvas);
    const surfaces = buildSurfaces();
    const world = buildWorld(this.layout, surfaces);
    this.engine.scene.add(world.root);
    this.entities = new EntityView();
    this.engine.scene.add(this.entities.root);
    this.weather = new Weather(this.layout);
    this.engine.scene.add(this.weather.root);
    this.sim = new Sim(cfg.seed, this.layout);

    // the view model lives in its own camera so the world never clips it
    this.view = new ViewModel();
    this.engine.camera.add(this.view.root);
    this.engine.scene.add(this.engine.camera);

    const start = this.layout.starts[0];
    this.controller = new Controller(this.layout);
    this.controller.reset(start.x, start.z, Math.PI);

    // squad
    this.me = this.sim.addSoldier(cfg.playerName || 'Боец', false, 0, cfg.profile.xp);
    this.me.hp = this.me.maxHp = 100 + Math.round(ownedMod(cfg.profile, 'startHp'));
    // invention: a bigger pouch means a bigger magazine, applied on top of the table
    const magBonus = ownedMod(cfg.profile, 'magBonus');
    if (magBonus > 0) {
      this.me.magSize = Math.round(this.me.magSize * (1 + magBonus));
      this.me.ammo = this.me.magSize;
    }
    // invention: FPV pack — one extra loitering munition, carried in the squad bag
    const extraDrones = 1 + Math.round(ownedMod(cfg.profile, 'droneCharges'));
    this.sim.droneStock = extraDrones;
    if (!this.cfg.net || this.cfg.host) {
      for (let i = 0; i < cfg.bots; i++) this.sim.addSoldier(`ИИ-${i + 1}`, true, i + 2, Math.round(cfg.profile.xp * 0.4));
    }
    this.perks = perksOf(this.me.level);

    // crouch-start: the cutscene leaves you on the ground
    this.input = new InputState(canvas);
    this.input.onWheel = (d) => this.cycleWeapon(d > 0 ? 1 : -1);
    this.input.onKey = (code, down) => {
      if (!down) return;
      if (code === 'KeyR') this.reload();
      if (code === 'KeyF') this.interact();
      if (code === 'Digit1') this.pickWeapon('ak');
      if (code === 'Digit2') this.pickWeapon('shotgun');
      if (code === 'Digit3') this.pickWeapon('sniper');
      if (code === 'Digit4') this.pickWeapon('lmg');
      if (code === 'KeyG') this.launchDrone();
      if (code === 'KeyQ') this.cycleWeapon(-1);
      if (code === 'KeyE') this.cycleWeapon(1);
    };
    // Losing the pointer lock is the pause signal (Esc, alt-tab, clicking away).
    // It is a one-way notification: resuming always happens from the menu.
    this.input.onLockChange = (locked) => {
      if (!locked && !this.over) this.hooks.onPause(true);
    };

    if (cfg.net && cfg.host) this.wireHost(cfg.net);
    this.engine.focusShadows(start.x, start.z);
    this.hooks.onBanner('ПЕРВЫЙ РУБЕЖ', 'окопайтесь. поддержка не прилетит', 5200);
    setTimeout(() => this.input.lock(), 300);
  }

  /** Host side of co-op: peers get a soldier, their inputs drive it. */
  private wireHost(net: Net) {
    net.cbRef.current.onPeerJoined = (_peer, name, slot) => {
      if (this.remoteIds.has(_peer)) return;
      const sol = this.sim.addSoldier(name || 'Боец', false, slot + 1);
      this.remoteIds.set(_peer, sol.id);
      net.sendTo(_peer, { t: 'youAre', soldier: sol.id });
      this.hooks.onKill(`<b>${name.toUpperCase()}</b> на связи`);
    };
    net.cbRef.current.onRemoteInput = (peer, cmd) => {
      if (!this.remoteIds.has(peer)) this.remoteIds.set(peer, 0);
      this.remoteInput.set(peer, cmd);
    };
    net.cbRef.current.onYouAre = () => {};
    net.cbRef.current.onEvent = (kind, data) => {
      if (kind === 'peer-left' && typeof data === 'string') {
        const id = this.remoteIds.get(data);
        if (id) {
          const sol = this.sim.soldier(id);
          if (sol) sol.alive = false;
        }
        this.remoteIds.delete(data);
      }
    };
  }

  /** Host → clients: the feedback they cannot derive from snapshots. */
  private broadcastEvent(kind: string, data?: unknown) {
    if (this.cfg.net && this.cfg.host) this.cfg.net.broadcast({ t: 'event', kind, data });
  }

  /** Client: a host event arrived. */
  remoteEvent(kind: string, data?: unknown) {
    const a = data as Record<string, unknown> | undefined;
    if (kind === 'hit') this.hooks.onHitmark();
    if (kind === 'enemyKill' && a) {
      const label = a.kind === 'armor' ? 'БРОНЕМАШИНА' : a.kind === 'drone' ? 'ДРОН' : a.kind === 'fpv' ? 'FPV-ДРОН' : 'ПЕХОТА';
      this.hooks.onKill(`<b>${label}</b> уничтожен`);
    }
    if (kind === 'wave' && a && 'name' in a) this.hooks.onBanner(String(a.name), `волна ${a.index}`, 4200);
    if (kind === 'wave' && a && 'revive' in a && a.revive === this.me?.id) this.hooks.onBanner('НА СВЯЗИ', 'свои вытащили', 2600);
    if (kind === 'drop') this.hooks.onBanner('СБРОС', 'ящик снабжения в квадрате', 4200);
  }

  /** Client: take the host's world, keep our own predicted pose. */
  adopt(s: GameState) {
    if (this.cfg.host) return;
    const myId = this.cfg.net?.myId || this.me?.id || -1;
    // Until the host has assigned us a slot, keep our local soldier in the world
    // so the HUD and the camera always have somebody to follow.
    if (myId > 0 && !s.soldiers.some((x) => x.id === myId) && this.me) {
      const me = this.me;
      me.id = myId;
      s.soldiers = [...s.soldiers, me];
      this.cfg.net!.myId = myId;
    }
    const before = this.lastTracerCount;
    this.lastTracerCount = s.tracers.length;
    if (s.tracers.length > before) {
      // someone fired; the pan follows the tracer's origin relative to us
      const t = s.tracers[s.tracers.length - 1];
      const dx = t.from.x - (this.me?.x ?? 0);
      const dz = t.from.z - (this.me?.z ?? 0);
      const d = Math.hypot(dx, dz);
      if (d > 3) this.audio.shot('ak', d, Math.max(-1, Math.min(1, dx / Math.max(6, d) * 0.6)));
    }
    this.sim.adoptSnapshot(s, myId);
    const mine = this.sim.soldier(myId);
    if (mine) this.me = mine;
  }

  setSensitivity(v: number) { this.sensitivity = v; }

  private reload() {
    if (!this.me) return;
    this.seq++;
    this.sim.startReload(this.me);
    this.audio.ui('click');
  }

  private interact() {
    if (!this.me) return;
    const box = this.sim.s.supplies.find((b) => !b.opened && b.falling <= 0 && Math.hypot(b.x - this.me!.x, b.z - this.me!.z) < 3.2);
    if (box) {
      if (this.sim.openSupply(box.id, this.me.id)) {
        this.audio.ui('open');
        this.hooks.onKill('<b>СНАБЖЕНИЕ</b> получено');
      }
    }
  }

  private pickWeapon(id: 'ak' | 'shotgun' | 'sniper' | 'lmg') {
    if (!this.me) return;
    if (this.me.weapon === id) return;
    if (!this.me.reserve.includes(id)) return;
    this.sim.swapWeapon(this.me, id);
    this.audio.ui('click');
  }

  /** FPV drone: launches from the bag if the squad has stock left. */
  private launchDrone() {
    if (!this.me) return;
    if (this.sim.droneStock <= 0) {
      this.hooks.onHint('дронов нет — ищите ящик');
      return;
    }
    if (this.me.weapon === 'drone') return;
    this.sim.swapWeapon(this.me, 'drone');
    this.audio.ui('open');
  }

  private cycleWeapon(dir: number) {
    if (!this.me) return;
    const list: Array<'ak' | 'shotgun' | 'sniper' | 'lmg'> = ['ak', 'shotgun', 'sniper', 'lmg'];
    const pool = [this.me.weapon, ...this.me.reserve].filter((w) => w !== 'drone' && w !== 'ak') as typeof list;
    const all = ['ak', ...pool.filter((w, i, a) => a.indexOf(w) === i)] as typeof list;
    const idx = all.indexOf(this.me.weapon as typeof list[number]);
    const next = all[(idx + dir + all.length) % all.length];
    this.pickWeapon(next);
  }

  /** One fixed simulation step. */
  private step() {
    this.seq++;
    const cmd: InputCmd = { ...EMPTY_INPUT, seq: this.seq };
    const axes = this.input.axes();
    const yaw = this.controller.cameraYaw;
    // camera-relative movement: forward is where you look
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const mx = axes.strafe * cos + axes.forward * sin;
    const mz = axes.strafe * -sin + axes.forward * cos;
    cmd.mx = mx;
    cmd.mz = mz;
    cmd.sprint = this.input.down('ShiftLeft') || this.input.down('ShiftRight');
    cmd.crouch = this.input.down('ControlLeft') || this.input.down('KeyC');
    cmd.ads = this.input.mouse(2);
    cmd.fire = this.input.mouse(0);
    cmd.yaw = yaw;
    cmd.pitch = this.controller.cameraPitch;

    const inputs = new Map<number, InputCmd>();
    inputs.set(this.me!.id, cmd);
    for (const [peer, remoteCmd] of this.remoteInput) {
      const id = this.remoteIds.get(peer);
      if (id) inputs.set(id, remoteCmd);
    }

    if (this.cfg.net && !this.cfg.host) {
      // client: the host owns the world. The local soldier is predicted by
      // applyInput alone (movement is deterministic and collision is static), so
      // walking never waits on a round trip.
      this.cfg.net.sendInput(cmd);
      if (this.me) this.sim.applyInputForClient(this.me, cmd);
      return;
    }

    // stash per-enemy/box ids we care about for hit detection feedback
    const enemiesBefore = this.sim.s.enemies.filter((e) => e.alive).length;
    this.sim.step(inputs);
    this.processEvents(enemiesBefore);
    if (this.sim.s.phase === 'overrun' && !this.over) this.finish();
  }

  private processEvents(enemiesBefore: number) {
    const events = this.sim.events;
    const newEvents = events.slice(this.lastEventIdx);
    this.lastEventIdx = events.length;
    for (const ev of newEvents) {
      const a = ev.a as Record<string, unknown> | undefined;
      if (ev.type === 'shot' && a) {
        // Shot events are global (bots, peers, host) — only play the ones that
        // are not mine, otherwise the local trigger doubles every round.
        if (a.id !== this.me?.id) {
          const dx = (a.x as number) - this.me!.x;
          const dz = (a.z as number) - this.me!.z;
          const dist = Math.hypot(dx, dz);
          const pan = Math.max(-1, Math.min(1, dx / Math.max(6, dist) * 0.6));
          this.audio.shot((a.weapon as 'ak') ?? 'ak', dist, pan);
        }
      }
      if (ev.type === 'hit') {
        this.broadcastEvent('hit');
        this.hooks.onHitmark();
        this.audio.impact(0.2);
      }
      if (ev.type === 'enemyKill') {
        this.broadcastEvent('enemyKill', a);
        const kind = a?.kind as string;
        const label = kind === 'armor' ? 'БРОНЕМАШИНА' : kind === 'drone' ? 'ДРОН' : kind === 'fpv' ? 'FPV-ДРОН' : 'ПЕХОТА';
        this.hooks.onKill(`<b>${label}</b> уничтожен`);
      }
      if (ev.type === 'kill') {
        this.audio.explosion(4);
      }
      if (ev.type === 'wave' && a) {
        this.broadcastEvent('wave', a);
        if ('name' in a) this.hooks.onBanner(String(a.name), `волна ${a.index}`, 4200);
        if ('levelUp' in a && a.id === this.me?.id) {
          this.hooks.onBanner(`УРОВЕНЬ ${a.levelUp}`, 'навык закреплён', 3200);
          this.perks = perksOf(Number(a.levelUp));
          this.audio.ui('open');
        }
        if ('overrun' in a) this.finish();
      }
      if (ev.type === 'wave' && a && 'revive' in a) {
        if (a.revive === this.me?.id) this.hooks.onBanner('НА СВЯЗИ', 'свои вытащили', 2600);
        this.audio.ui('open');
      }
      if (ev.type === 'drop') {
        this.broadcastEvent('drop');
        this.hooks.onBanner('СБРОС', 'ящик снабжения в квадрате', 4200);
      }
    }
    void enemiesBefore;
  }

  /** Fractional frames for smooth everything. */
  frame(now: number) {
    const dtRaw = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.frames++;
    this.fpsTimer += dtRaw;
    if (this.fpsTimer > 0.5) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
    }
    if (this.paused || this.over) {
      this.engine.render(now / 1000);
      return;
    }
    const dt = this.paused ? 0 : dtRaw;

    // ---- view: mouse look
    const m = this.input.drainMouse();
    const adsScale = 1 - this.controller.adsAmount * 0.45;
    this.controller.look(m.x, m.y, 0.0022 * this.sensitivity, adsScale);

    // ---- fixed-step sim
    this.acc += dt;
    let steps = 0;
    while (this.acc >= TICK_MS / 1000 && steps < 4) {
      this.acc -= TICK_MS / 1000;
      this.step();
      steps++;
    }

    const s = this.sim.s;
    const sol = this.me!;
    const perk = (id: string) => this.perks.some((p) => p.id === id);

    // ---- perk effects that live outside the sim: stamina drain and bandage
    if (perk('stamina')) sol.stamina = Math.min(100, sol.stamina + dt * 6);
    if (perk('suppress')) sol.suppress = Math.max(0, sol.suppress - dt * 14);

    // ---- controller + camera
    const moving = Math.hypot(sol.vx, sol.vz);
    this.controller.update(
      dt,
      {
        forward: this.input.axes().forward,
        strafe: this.input.axes().strafe,
        sprint: this.input.down('ShiftLeft') || this.input.down('ShiftRight'),
        crouch: this.input.down('ControlLeft') || this.input.down('KeyC'),
        ads: this.input.mouse(2),
        shoot: this.input.mouse(0),
      },
      moving,
      sol.suppress / 100,
    );
    this.controller.apply(this.engine.camera, sol, 0, now / 1000);
    this.engine.setFov(this.engine.camera.fov);
    this.engine.focusShadows(sol.x, sol.z);

    // ---- weapon model & recoil
    // the drone is a launcher, not a rifle: show the rifle while it is out
    this.view.setWeapon(sol.weapon);
    const w = WEAPONS[sol.weapon];
    const wantShot = this.input.mouse(0) && !this.paused && sol.alive;
    this.shotCooldown -= dt * 1000;
    if (wantShot && this.shotCooldown <= 0 && sol.ammo > 0 && s.time >= sol.reloadingUntil) {
      this.shotCooldown = w.cadence;
      this.view.kick(this.controller.adsAmount > 0.5 ? 0.55 : 1);
      const kick = w.recoil * 0.0042 * (1 - this.controller.adsAmount * 0.35) * (perk('recoil') ? 0.88 : 1);
      this.controller.recoilKick(kick, (Math.random() - 0.5) * kick * 0.5, (Math.random() - 0.5) * kick * 0.8);
      this.audio.shot(w.id === 'drone' ? 'ak' : (w.id as 'ak'), 0, 0);

    }
    this.view.update(dt, this.controller, now / 1000);

    // ---- world state → visuals
    this.entities.update(s, dt, now / 1000);
    this.weather.root.position.set(0, 0, 0);
    this.weather.update(dt, this.engine.camera.position.x, this.engine.camera.position.z);

    // ---- audio bed
    this.audio.setPressure(s.intensity);
    this.shellTimer -= dt;
    if (this.shellTimer <= 0) {
      this.shellTimer = 25 + Math.random() * 55;
      this.audio.distantShell();
    }
    if (sol.hp < 40 && sol.alive) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        this.heartTimer = 0.85;
        this.audio.heartbeat(1 - sol.hp / 40);
      }
    }

    // ---- feedback
    if (sol.hp < this.prevHp) {
      this.hurtFlash = Math.min(1, this.hurtFlash + (this.prevHp - sol.hp) / 45);
      for (let i = 0; i < 3; i++) this.audio.whiz((Math.random() - 0.5) * 1.6);
    }
    this.prevHp = sol.hp;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 0.9);

    // ---- supply proximity hint
    const near = s.supplies.find((b) => !b.opened && b.falling <= 0 && Math.hypot(b.x - sol.x, b.z - sol.z) < 3.2);
    if (near) this.hooks.onHint('F — вскрыть ящик');
    else if (sol.weapon === 'drone') this.hooks.onHint('ЛКМ — запустить дрон');
    else this.hooks.onHint(null);

    // ---- post params
    const post = this.engine.post();
    post.uDamage.value = Math.max(this.hurtFlash, 1 - sol.hp / sol.maxHp) * (sol.alive ? 1 : 0.6);
    post.uSuppress.value = Math.min(1, sol.suppress / 100);
    post.uDesat.value = sol.alive ? 0 : 0.85;
    this.engine.camera.fov = this.engine.camera.fov;

    // Preact bails out on identical references, and the sim mutates in place:
    // publish a shallow copy, no more than 20 times a second.
    if (now - this.lastPublish > 50) {
      this.lastPublish = now;
      this.hooks.onState({ ...s });
    }

    // ---- network
    if (this.cfg.net && this.cfg.host) this.cfg.net.sendSnapshot(s, now);

    this.engine.render(now / 1000);

    if (this.bannerTimer > 0) this.bannerTimer -= dt;
  }

  private finish() {
    if (this.over) return;
    this.over = true;
    this.input.unlock();
    const s = this.sim.s;
    const survivedXp = Math.round(s.survived * 0.9 + s.kills * 12);
    const gain = Math.round(survivedXp * (1 + ownedMod(this.cfg.profile, 'xpGain')) * this.cfg.difficulty);
    this.cfg.profile.xp += gain;
    this.cfg.profile.runs++;
    this.cfg.profile.totalKills += this.me?.kills ?? 0;
    this.cfg.profile.bestSurvived = Math.max(this.cfg.profile.bestSurvived, s.survived);
    saveProfile(this.cfg.profile);
    this.hooks.onOver({
      survived: s.survived,
      kills: this.me?.kills ?? 0,
      xp: gain,
      level: levelOf(this.cfg.profile.xp),
    });
  }

  dispose() {
    for (const d of this.disposal) d();
    this.disposal = [];
    this.input.unlock();
    this.engine.dispose();
    this.audio.stopAll();
  }
}
