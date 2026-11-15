import type { EconType, Tier } from '../data/countries';
import type { ResourceKey } from '../data/resources';

export type UnitType = 'infantry' | 'armor' | 'artillery' | 'airdef' | 'drones' | 'air' | 'navy' | 'special';
export type MissileType = 'ballistic' | 'cruise' | 'hypersonic' | 'shahed' | 'icbm';
export type BuildingType = 'factory' | 'milfactory' | 'refinery' | 'mine' | 'shipyard' | 'airbase' | 'lab' | 'npp' | 'bunker' | 'farm';

export interface LL { lat: number; lon: number }

export interface Unit {
  id: number;
  type: UnitType;
  owner: string;
  name: string;
  lat: number;
  lon: number;
  str: number; // 0..100
  org: number; // 0..100
  xp: number; // 0..1
  path: LL[];
  ammo: number; // interceptors (air defence), sorties (air)
  engaged: number; // hours since last combat; 0 = in combat right now
  hold: boolean;
}

export interface Production { kind: 'unit' | 'missile' | 'building'; item: string; province?: number; progress: number; days: number; count: number }

export interface CountryState {
  id: string;
  name: string;
  color: string;
  tier: Tier;
  alive: boolean;
  player: string | null; // player id controlling the country
  leader: string;
  capital: number; // province id
  // Economy
  gdp: number; // $bn
  gdpGrowth: number; // annual %
  budget: number; // $bn treasury
  debt: number; // $bn
  tax: number; // 0.1 .. 0.6
  milShare: number; // share of GDP allotted to defence (informational / upkeep cap)
  researchShare: number; // 0..0.05 of GDP
  inflation: number; // annual %
  printing: boolean;
  econ: EconType;
  income: number; // $bn/day (last computed)
  expenses: number;
  pop: number; // millions
  manpower: number; // thousands available for mobilisation
  mobilisation: number; // 0..1
  stock: Record<ResourceKey, number>;
  prod: Record<ResourceKey, number>;
  use: Record<ResourceKey, number>;
  missiles: Record<MissileType, number>;
  nukes: number;
  queue: Production[];
  // Science
  tech: number;
  researched: string[];
  research: { id: string; progress: number } | null;
  rp: number; // research points per day
  focusDone: string[];
  focus: { id: string; progress: number } | null;
  // Politics
  stability: number;
  approval: number;
  corruption: number;
  nationalism: number;
  pressFreedom: number;
  living: number;
  warExhaustion: number;
  ideology: [number, number, number, number];
  factions: Record<string, number>;
  alliances: string[];
  sanctions: string[]; // countries this country sanctions
  guarantees: string[];
  opinion: number; // world opinion -100..100
  aggression: number;
  modifiers: Record<string, number>; // temporary effects: key -> value
  flags: string[];
  quarantine: 'none' | 'soft' | 'hard';
}

export interface War {
  id: number;
  name: string;
  attackers: string[];
  defenders: string[];
  start: number; // tick
  cb: string;
}

export interface Missile {
  id: number;
  type: MissileType;
  owner: string;
  from: LL;
  to: LL;
  nuclear: boolean;
  /** real-time seconds */
  dur: number;
  elapsed: number;
  /** if set, interception happens at this fraction of flight by AD unit */
  interceptAt: number | null;
  interceptBy: number | null;
  targetUnit: number | null;
}

export interface LogEntry { t: number; text: string; kind: 'info' | 'war' | 'diplo' | 'econ' | 'event' | 'alert' | 'chat'; country?: string }

export interface PendingEvent { key: number; event: string; country: string; deadline: number; vars?: Record<string, string> }

export interface ProvinceState {
  owner: string[];
  ctrl: string[];
  capture: number[]; // 0..1 progress
  captureBy: (string | null)[];
  damage: number[]; // 0..1
  buildings: Partial<Record<BuildingType, number>>[];
}

export interface GameSettings {
  mode: 'campaign' | 'sandbox';
  difficulty: 'easy' | 'normal' | 'hard' | 'historical';
  historical: boolean;
}

export interface GameState {
  version: number;
  seed: number;
  tick: number; // game hours since 2020-01-01
  speed: number; // 0 = pause, 1..5
  settings: GameSettings;
  countries: Record<string, CountryState>;
  prov: ProvinceState;
  units: Unit[];
  nextId: number;
  relations: Record<string, number>; // "a|b" sorted
  wars: War[];
  missiles: Missile[];
  log: LogEntry[];
  pending: PendingEvent[];
  fired: string[]; // fired one-shot events
  tension: number; // world tension 0..100
  oilPrice: number;
  players: Record<string, { name: string; country: string; color: string }>;
}

export const START_DATE = Date.UTC(2020, 0, 1, 0);
export const dateOf = (tick: number) => new Date(START_DATE + tick * 3600_000);
