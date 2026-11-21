import * as THREE from 'three';
import type { SoldierState } from '../core/types';
import { BODY } from '../sim/weapons';
import type { Layout } from '../world/layout';

/**
 * First-person controller with deliberate, heavy camera motion.
 *
 * Nothing snaps. Yaw/pitch are damped, the eye height springs, the weapon model
 * carries inertia against the turn, sprinting widens the FOV and lowers the gun,
 * ADS tightens everything and slows you down, and every step nudges the camera
 * with a little lateral roll. That is what makes a shooter feel "realistic".
 */
export class Controller {
  yaw = 0;
  pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private eye = BODY.eye;
  private eyeVel = 0;
  private bobPhase = 0;
  private bobAmt = 0;
  private swayX = 0;
  private swayY = 0;
  private swayVelX = 0;
  private swayVelY = 0;
  private roll = 0;
  private fov = 72;
  private targetFov = 72;
  private shake = 0;
  private shakeSeed = Math.random() * 1000;
  ads = 0;
  sprinting = false;
  firing = 0;

  constructor(private layout: Layout) {}

  /** Mouse delta in pixels; sensitivity is per-radian of screen. */
  look(dx: number, dy: number, sensitivity = 0.0022, adsScale = 1) {
    this.targetYaw -= dx * sensitivity * adsScale;
    this.targetPitch -= dy * sensitivity * adsScale;
    const limit = 1.45;
    this.targetPitch = Math.max(-limit, Math.min(limit, this.targetPitch));
    // the gun lags behind the view — heavier when scoped
    this.swayVelX += dx * 0.006 * (1 - this.ads * 0.5);
    this.swayVelY += dy * 0.006 * (1 - this.ads * 0.5);
  }

  recoilKick(pitch: number, yaw: number, roll: number) {
    this.targetPitch = Math.max(-1.45, Math.min(1.45, this.targetPitch + pitch));
    this.targetYaw += yaw;
    this.roll += roll;
    this.swayVelY -= 26;
    this.swayVelX += (Math.random() - 0.5) * 14;
    this.shake = Math.min(1, this.shake + 0.22);
  }

  /** Bullet passing close by: brief camera jolt. */
  crack() {
    this.shake = Math.min(1, this.shake + 0.16);
  }

  get cameraPitch() { return this.pitch; }
  get cameraYaw() { return this.yaw; }
  get adsAmount() { return this.ads; }

  update(
    dt: number,
    input: { forward: number; strafe: number; sprint: boolean; crouch: boolean; ads: boolean; shoot: boolean },
    moveSpeed: number,
    suppressed = 0,
  ) {
    // ---- view damping: a fixed-fraction approach, frame-rate independent
    const k = 1 - Math.exp(-dt * 26);
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;

    // ---- ADS blend
    const adsTarget = input.ads && !input.sprint ? 1 : 0;
    this.ads += (adsTarget - this.ads) * (1 - Math.exp(-dt * 14));

    // ---- stance & eye height
    const moving = Math.hypot(input.forward, input.strafe) > 0.05;
    this.sprinting = input.sprint && moving && input.forward > 0.1 && !input.ads;
    const wantEye = input.crouch ? BODY.crouchEye : BODY.eye;
    // critically damped spring so crouching has weight
    const stiffness = 220, damping = 26;
    const accel = (wantEye - this.eye) * stiffness - this.eyeVel * damping;
    this.eyeVel += accel * dt;
    this.eye += this.eyeVel * dt;

    // ---- step bob: frequency follows actual ground speed
    const speed = moveSpeed;
    const freq = this.sprinting ? 9.4 : 6.6;
    if (moving && speed > 0.4) this.bobPhase += dt * freq * (speed / 4.2);
    const bobTarget = moving && speed > 0.4 ? (this.sprinting ? 1.35 : input.crouch ? 0.35 : 1) : 0;
    this.bobAmt += (bobTarget - this.bobAmt) * (1 - Math.exp(-dt * 6));

    // ---- weapon sway spring
    const swayAccel = 1200, swayDamp = 34;
    this.swayVelX += (-this.swayX * swayAccel - this.swayVelX * swayDamp) * dt;
    this.swayVelY += (-this.swayY * swayAccel - this.swayVelY * swayDamp) * dt;
    this.swayX += this.swayVelX * dt;
    this.swayY += this.swayVelY * dt;
    this.swayX = Math.max(-1, Math.min(1, this.swayX));
    this.swayY = Math.max(-1, Math.min(1, this.swayY));

    // ---- roll: slight into strafes, more while sprinting
    const rollTarget = -input.strafe * 0.035 + (this.sprinting ? 0.012 : 0) + this.roll;
    this.roll += (rollTarget - this.roll) * (1 - Math.exp(-dt * 9));
    this.shake = Math.min(1, Math.max(0, this.shake - dt * 2.4) + suppressed * dt * 0.8);

    // ---- FOV: sprint widens, ADS narrows
    this.targetFov = this.sprinting ? 82 : 72 - this.ads * 22;
    this.fov += (this.targetFov - this.fov) * (1 - Math.exp(-dt * 8));
  }

  /** Applies the finished camera transform. */
  apply(camera: THREE.PerspectiveCamera, sol: SoldierState, baseFovFix = 0, time = 0) {
    const bobY = Math.sin(this.bobPhase * 2) * 0.035 * this.bobAmt;
    const bobX = Math.cos(this.bobPhase) * 0.045 * this.bobAmt;
    const bobRoll = Math.cos(this.bobPhase) * 0.012 * this.bobAmt;

    const sh = this.shake;
    const sx = Math.sin(time * 61 + this.shakeSeed) * 0.012 * sh;
    const sy = Math.cos(time * 47 + this.shakeSeed * 1.7) * 0.012 * sh;

    camera.position.set(
      sol.x + bobX * 0.35 + sx,
      this.eye + bobY,
      sol.z,
    );
    camera.rotation.order = 'YXZ';
    camera.rotation.y = this.yaw + sx * 0.4;
    camera.rotation.x = this.pitch + sy;
    camera.rotation.z = this.roll + bobRoll + Math.sin(time * 70) * 0.006 * sh;

    const fov = this.fov + baseFovFix;
    camera.getWorldDirection(new THREE.Vector3());
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  /** Where the muzzle points, in world space (for the sim's ray). */
  aim(): { yaw: number; pitch: number } {
    return { yaw: this.yaw, pitch: this.pitch };
  }

  /** Reset to a clean state (respawn / cutscene hand-off). */
  reset(x: number, z: number, yaw: number) {
    void x; void z;
    this.yaw = this.targetYaw = yaw;
    this.pitch = this.targetPitch = 0;
    this.eyeVel = 0;
    this.bobAmt = 0;
    this.swayX = this.swayY = this.swayVelX = this.swayVelY = 0;
    this.shake = 0;
    void this.layout;
  }
}
