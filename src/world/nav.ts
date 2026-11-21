import { blocked, MAP_SIZE, type Layout } from './layout';

/**
 * Coarse navigation grid (2 m cells) with a BFS flow field.
 *
 * Infantry used to grind against fences because local steering only sees a few
 * metres ahead. A flow field computed from the squad's position fixes that for
 * every enemy at once, for the price of one BFS per second.
 */
export const CELL = 2;
export const GRID = Math.ceil(MAP_SIZE / CELL);
const HALF = MAP_SIZE / 2;

const DIRS: Array<[number, number]> = [
  [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1],
];

export class NavGrid {
  readonly solid = new Uint8Array(GRID * GRID);
  /** heading (radians, atan2(x, z) convention) toward the goal, -1 = unknown */
  readonly dir = new Float32Array(GRID * GRID).fill(-1);
  private queue = new Int32Array(GRID * GRID);
  private goalCell = -1;

  constructor(layout: Layout) {
    for (let iz = 0; iz < GRID; iz++) {
      for (let ix = 0; ix < GRID; ix++) {
        const x = -HALF + (ix + 0.5) * CELL;
        const z = -HALF + (iz + 0.5) * CELL;
        this.solid[iz * GRID + ix] = blocked(layout, x, z, 0.7) ? 1 : 0;
      }
    }
  }

  cellOf(x: number, z: number) {
    const ix = Math.max(0, Math.min(GRID - 1, Math.floor((x + HALF) / CELL)));
    const iz = Math.max(0, Math.min(GRID - 1, Math.floor((z + HALF) / CELL)));
    return iz * GRID + ix;
  }

  isSolid(x: number, z: number) {
    return this.solid[this.cellOf(x, z)] === 1;
  }

  /**
   * Recompute the flow field toward (gx, gz). Only runs the BFS when the goal
   * has drifted into another cell, so this is ~free when the squad holds still.
   */
  update(gx: number, gz: number): void {
    const goal = this.cellOf(gx, gz);
    if (goal === this.goalCell) return;
    this.goalCell = goal;
    this.dir.fill(-1);
    const q = this.queue;
    let head = 0, tail = 0;
    this.dir[goal] = -2; // visited marker for the source
    q[tail++] = goal;
    while (head < tail) {
      const c = q[head++];
      const cx = c % GRID, cz = (c / GRID) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DIRS[d][0], nz = cz + DIRS[d][1];
        if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
        const n = nz * GRID + nx;
        if (this.dir[n] !== -1 || this.solid[n]) continue;
        // no corner cutting diagonally through two solid cells
        if (DIRS[d][0] !== 0 && DIRS[d][1] !== 0) {
          if (this.solid[cz * GRID + nx] || this.solid[nz * GRID + cx]) continue;
        }
        // heading points from the neighbour toward its parent
        this.dir[n] = Math.atan2((cx - nx) * CELL, (cz - nz) * CELL);
        q[tail++] = n;
      }
    }
  }

  /** Flow heading at a world position, or null when unreachable. */
  heading(x: number, z: number): number | null {
    const a = this.dir[this.cellOf(x, z)];
    return a === -1 || a === -2 ? null : a;
  }
}
