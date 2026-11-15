export const W = 4096;
export const H = 2048;
/** Auxiliary imagery (satellite colour / night lights) resolution. Heights use 2x this. */
export const AUX_W = 1024;
export const AUX_H = 512;
export const NAV_W = 1024;
export const NAV_H = 512;

export enum Terrain { Plains, Forest, Hills, Mountains, Desert, Arctic }

export const TERRAIN_INFO: Record<Terrain, { name: string; move: number; defense: number; supply: number; icon: string }> = {
  [Terrain.Plains]: { name: 'Равнины', move: 1, defense: 1, supply: 1, icon: '▭' },
  [Terrain.Forest]: { name: 'Леса', move: 0.75, defense: 1.25, supply: 0.9, icon: '♣' },
  [Terrain.Hills]: { name: 'Холмы', move: 0.8, defense: 1.3, supply: 0.9, icon: '◠' },
  [Terrain.Mountains]: { name: 'Горы', move: 0.5, defense: 1.8, supply: 0.7, icon: '▲' },
  [Terrain.Desert]: { name: 'Пустыня', move: 0.9, defense: 0.9, supply: 0.6, icon: '◌' },
  [Terrain.Arctic]: { name: 'Арктика', move: 0.5, defense: 1.2, supply: 0.5, icon: '❄' },
};

export interface WorldGenInput {
  heights: Uint8Array; // (AUX_W*2) x (AUX_H*2) grey
  color: Uint8ClampedArray; // AUX_W x AUX_H RGBA
  night: Uint8Array; // AUX_W x AUX_H grey
}

export interface WorldGenOutput {
  tags: string[];
  prov: Uint16Array;
  ctry: Uint8Array;
  nav: Uint8Array;
  pLat: Float32Array;
  pLon: Float32Array;
  pArea: Float32Array;
  pCountry: Uint8Array;
  pTerrain: Uint8Array;
  pCoastal: Uint8Array;
  pElev: Float32Array;
  pLight: Float32Array;
  adjOffsets: Uint32Array;
  adjList: Uint32Array;
}
