// Headless harness: real Natural Earth borders + synthetic imagery, so the full
// simulation can be driven without a browser. Used by test/simcheck.ts.
import { AUX_W, AUX_H, type WorldGenInput } from '../src/world/worldTypes';
import { World } from '../src/world/world';
import { generate } from '../src/world/worldgen';

/** Synthetic earth imagery: land-ish colours + elevation + night lights. Deterministic. */
function syntheticInput(): WorldGenInput {
  const color = new Uint8ClampedArray(AUX_W * AUX_H * 4);
  const night = new Uint8Array(AUX_W * AUX_H);
  const heights = new Uint8Array(AUX_W * 2 * AUX_H * 2);
  const rnd = (x: number, y: number) => {
    let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 7, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  for (let y = 0; y < AUX_H; y++) {
    for (let x = 0; x < AUX_W; x++) {
      const i = y * AUX_W + x;
      const n = rnd(x, y);
      color[i * 4] = 70 + n * 50;
      color[i * 4 + 1] = 60 + n * 70;
      color[i * 4 + 2] = 50 + n * 30;
      color[i * 4 + 3] = 255;
      night[i] = n > 0.9 ? 220 : n > 0.75 ? 120 : 30;
    }
  }
  for (let y = 0; y < AUX_H * 2; y++) {
    for (let x = 0; x < AUX_W * 2; x++) heights[y * AUX_W * 2 + x] = Math.floor(rnd(x >> 1, y >> 1) * 255);
  }
  return { heights, color, night };
}

/** Run the real worldgen in-process and return a World. */
export async function makeWorld(): Promise<World> {
  const out = generate(syntheticInput(), () => undefined);
  return new World(out);
}

export { W, H };
