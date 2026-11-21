/** Shared types. This file must stay dependency-free: it is imported by the sim,
 *  the renderer, the network layer and the headless tests alike. */

export type Vec2 = { x: number; z: number };
export type Vec3 = { x: number; y: number; z: number };

export const TICK_MS = 50; // 20 Hz authoritative step
export const TICK = 1 / 20; // seconds per step

export type Team = 'player';

/** ---------- input: what a client sends, never what it believes ---------- */
export interface InputCmd {
  seq: number;
  /** desired movement in world XZ, already normalised by the sender (length <= 1) */
  mx: number;
  mz: number;
  sprint: boolean;
  crouch: boolean;
  /** true while the trigger is held */
  fire: boolean;
  /** one-shot: reload request */
  reload: boolean;
  /** one-shot: bandage / use item */
  use: boolean;
  /** aim yaw & pitch, radians. Clients own their view. */
  yaw: number;
  pitch: number;
}

export const EMPTY_INPUT: InputCmd = {
  seq: 0, mx: 0, mz: 0, sprint: false, crouch: false, fire: false, reload: false, use: false, yaw: 0, pitch: 0,
};

/** ---------- entities ---------- */
export type WeaponId = 'ak' | 'shotgun' | 'sniper' | 'lmg' | 'drone';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** rounds per magazine */
  mag: number;
  /** ms between shots */
  cadence: number;
  /** damage at point blank, falls off with range */
  dmg: number;
  /** effective range in metres where damage is halved */
  falloff: number;
  /** spread in radians at ideal stance */
  spread: number;
  recoil: number;
  auto: boolean;
  /** pellets per shot (shotguns) */
  pellets: number;
  reloadMs: number;
}

export interface SoldierState {
  id: number;
  name: string; // never rendered; used for the scoreboard-free kill feed
  bot: boolean;
  alive: boolean;
  /** seconds dead, respawn is gated by the wave clock, not by a timer */
  downedAt: number;
  x: number;
  y: number;
  z: number;
  /** world-space velocities for prediction and animation */
  vx: number;
  vz: number;
  yaw: number;
  pitch: number;
  hp: number;
  maxHp: number;
  stamina: number;
  crouch: boolean;
  sprint: boolean;
  weapon: WeaponId;
  reserve: WeaponId[];
  ammo: number;
  magSize: number;
  reloadingUntil: number; // absolute ms
  lastShot: number; // absolute ms
  /** XP and unlocks — progression is permanent per client profile */
  xp: number;
  level: number;
  kills: number;
  score: number;
  /** suppression: heavy fire nearby degrades accuracy and screen */
  suppress: number;
  /** accumulated recoil 0..1.6 — drives the spread and the camera kick */
  recoil: number;
  lastShotPrev: number;
  /** last input sequence applied (for client-side reconciliation) */
  lastSeq: number;
  /** network interpolation buffer position for remote copies */
  netX: number;
  netZ: number;
  netY: number;
}

export type EnemyKind = 'infantry' | 'drone' | 'fpv' | 'armor';

export interface EnemyState {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  /** waypoint index / behaviour timer */
  target: number;
  cooldown: number;
  yaw: number;
  alive: boolean;
  /** for drones: the soldier id they are chasing, -1 for random patrol */
  chase: number;
  /** for infantry: burst state */
  burst: number;
}

export interface SupplyBox {
  id: number;
  x: number;
  y: number;
  z: number;
  /** seconds until the parachute lands / box becomes usable */
  falling: number;
  opened: boolean;
  contents: WeaponId[];
}

export interface Tracer {
  id: number;
  from: Vec3;
  to: Vec3;
  t: number; // ms of life left
  enemy: boolean;
}

export interface Impact {
  id: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  t: number;
  kind: 'dirt' | 'blood' | 'metal';
}

export interface WaveState {
  index: number;
  name: string;
  /** seconds until the next wave begins */
  timer: number;
  active: boolean;
  /** remaining enemies in the current wave, drives the HUD counter */
  remaining: number;
}

export interface GameState {
  version: number;
  seed: number;
  tick: number; // fixed steps since start
  time: number; // ms of game time
  soldiers: SoldierState[];
  enemies: EnemyState[];
  supplies: SupplyBox[];
  tracers: Tracer[];
  impacts: Impact[];
  nextId: number;
  wave: WaveState;
  /** seconds survived — the score */
  survived: number;
  /** hostile pressure 0..1 used by audio and the sky */
  intensity: number;
  /** drop-box clock, seconds until the next supply drop */
  dropTimer: number;
  /** mission clock: the crash happens at t=0, first contact at ~90 s */
  phase: 'intro' | 'fight' | 'overrun';
  /** total kills by the squad */
  kills: number;
  /** every 5th wave the enemy throws armour at you */
  armorUnlocked: boolean;
}

export const PROFILE_KEY = 'kotel.profile.v1';
export const NAME_POOL = [
  'Барс', 'Штырь', 'Кедр', 'Гром', 'Сокол', 'Ветер', 'Камень', 'Дым', 'Клинок', 'Рубеж',
  'Тайга', 'Молот', 'Стриж', 'Пепел', 'Байкал', 'Штиль', 'Кремень', 'Топор', 'Овод', 'Вихрь',
];
