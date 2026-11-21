/**
 * Keyboard + mouse state, with pointer lock.
 *
 * Input is sampled, never event-driven into gameplay: the game loop asks the
 * state what is held right now. Mouse deltas accumulate between frames and are
 * drained once per frame so no movement is lost at low frame rates.
 */
export class InputState {
  keys = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private buttons = new Set<number>();
  locked = false;
  onLockChange: (locked: boolean) => void = () => {};
  onKey: (code: string, down: boolean) => void = () => {};
  onWheel: (delta: number) => void = () => {};
  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    addEventListener('keydown', (ev) => {
      const e = ev as KeyboardEvent;
      if (e.repeat) return;
      // never swallow devtools / reload shortcuts
      if (e.code === 'F5' || (e.ctrlKey && e.code !== 'KeyW')) return;
      this.keys.add(e.code);
      this.onKey(e.code, true);
      if (['Space', 'Tab', 'KeyQ', 'KeyE'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (ev) => {
      const e = ev as KeyboardEvent;
      this.keys.delete(e.code);
      this.onKey(e.code, false);
    });
    addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });
    el.addEventListener('mousedown', (ev) => {
      if (!this.locked) this.lock();
      this.buttons.add((ev as MouseEvent).button);
    });
    addEventListener('mouseup', (ev) => this.buttons.delete((ev as MouseEvent).button));
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (ev) => {
      if (!this.locked && document.pointerLockElement !== el) return;
      const e = ev as MouseEvent;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    addEventListener('wheel', (ev) => this.onWheel((ev as WheelEvent).deltaY), { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      this.onLockChange(this.locked);
    });
  }

  lock() {
    try {
      const r = this.el.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch {
      /* browsers require a fresh gesture; the canvas click handler covers that */
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Drained each frame. */
  drainMouse() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = this.mouseDY = 0;
    return d;
  }

  down(code: string) { return this.keys.has(code); }
  mouse(btn: number) { return this.buttons.has(btn); }

  /** Movement axes in local space: forward is -1 on W. */
  axes(): { forward: number; strafe: number } {
    let forward = 0, strafe = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) forward += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) forward -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) strafe += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) strafe -= 1;
    const l = Math.hypot(forward, strafe);
    if (l > 1) { forward /= l; strafe /= l; }
    return { forward, strafe };
  }
}
