import * as THREE from 'three';
import { toXYZ } from '../core/geo';
import type { LL, Missile, MissileType } from '../game/types';

// ------------------------------------------------------------------------------------------------
// Particle pool rendered as camera-facing points. Sizes are in world units.
// ------------------------------------------------------------------------------------------------
const pVert = /* glsl */ `
attribute float size;
attribute vec4 color;
attribute float spin;
varying vec4 vColor;
varying float vSpin;
uniform float uScale;
void main() {
  vColor = color; vSpin = spin;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(512.0, size * uScale / max(0.0005, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const pFragAdd = /* glsl */ `
varying vec4 vColor;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p) * 2.0;
  float a = exp(-d * d * 3.5) * (1.0 - smoothstep(0.85, 1.0, d));
  gl_FragColor = vec4(vColor.rgb * a * vColor.a, a * vColor.a);
}`;
const pFragSmoke = /* glsl */ `
varying vec4 vColor;
varying float vSpin;
float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vSpin), s = sin(vSpin);
  p = mat2(c, -s, s, c) * p;
  float d = length(p) * 2.0;
  float n = noise(p * 5.0 + vSpin * 3.0) * 0.6 + noise(p * 11.0 - vSpin) * 0.4;
  float a = smoothstep(1.0, 0.25, d + (n - 0.5) * 0.7) * vColor.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb * (0.75 + n * 0.5), a);
}`;

class Pool {
  readonly points: THREE.Points;
  private n = 0;
  readonly max: number;
  private pos: Float32Array; private vel: Float32Array; private col: Float32Array; private col0: Float32Array;
  private size: Float32Array; private grow: Float32Array; private life: Float32Array; private life0: Float32Array;
  private spin: Float32Array; private drag: Float32Array; private buoy: Float32Array; private fadeIn: Float32Array;
  private gPos: THREE.BufferAttribute; private gCol: THREE.BufferAttribute; private gSize: THREE.BufferAttribute; private gSpin: THREE.BufferAttribute;
  private mat: THREE.ShaderMaterial;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.col0 = new Float32Array(max * 4);
    this.size = new Float32Array(max); this.grow = new Float32Array(max); this.life = new Float32Array(max); this.life0 = new Float32Array(max);
    this.spin = new Float32Array(max); this.drag = new Float32Array(max); this.buoy = new Float32Array(max); this.fadeIn = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.gPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.gCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.gSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.gSpin = new THREE.BufferAttribute(this.spin, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.gPos); g.setAttribute('color', this.gCol); g.setAttribute('size', this.gSize); g.setAttribute('spin', this.gSpin);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: pVert, fragmentShader: additive ? pFragAdd : pFragSmoke, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uScale: { value: 800 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
  }

  setScale(px: number) { this.mat.uniforms.uScale.value = px; }

  emit(p: THREE.Vector3, v: THREE.Vector3, size: number, grow: number, life: number, r: number, g: number, b: number, a: number, drag = 1, buoy = 0, fadeIn = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
    this.col0.set([r, g, b, a], i * 4); this.col.set([r, g, b, 0], i * 4);
    this.size[i] = size; this.grow[i] = grow; this.life[i] = life; this.life0[i] = life;
    this.spin[i] = Math.random() * 6.28; this.drag[i] = drag; this.buoy[i] = buoy; this.fadeIn[i] = fadeIn;
  }

  update(dt: number) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); continue; }
      const t = 1 - this.life[i] / this.life0[i];
      const o = i * 3;
      const px = this.pos[o], py = this.pos[o + 1], pz = this.pos[o + 2];
      const len = Math.hypot(px, py, pz) || 1;
      const dr = Math.pow(this.drag[i], dt * 60);
      this.vel[o] = this.vel[o] * dr + (px / len) * this.buoy[i] * dt;
      this.vel[o + 1] = this.vel[o + 1] * dr + (py / len) * this.buoy[i] * dt;
      this.vel[o + 2] = this.vel[o + 2] * dr + (pz / len) * this.buoy[i] * dt;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const fi = this.fadeIn[i] > 0 ? Math.min(1, t / this.fadeIn[i]) : 1;
      const fade = fi * (1 - t * t);
      this.col[i * 4] = this.col0[i * 4]; this.col[i * 4 + 1] = this.col0[i * 4 + 1]; this.col[i * 4 + 2] = this.col0[i * 4 + 2];
      this.col[i * 4 + 3] = this.col0[i * 4 + 3] * fade;
      this.spin[i] += dt * 0.3;
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.gPos.needsUpdate = this.gCol.needsUpdate = this.gSize.needsUpdate = this.gSpin.needsUpdate = true;
  }

  /** Shift color over lifetime (fire → smoke) */
  private kill(i: number) {
    const last = --this.n;
    if (i === last) return;
    const cp = (a: Float32Array, k: number) => a.copyWithin(i * k, last * k, last * k + k);
    cp(this.pos, 3); cp(this.vel, 3); cp(this.col, 4); cp(this.col0, 4);
    for (const a of [this.size, this.grow, this.life, this.life0, this.spin, this.drag, this.buoy, this.fadeIn]) a[i] = a[last];
  }
}

// ------------------------------------------------------------------------------------------------
// Surface rings (shockwaves, capture pulses, scorch marks)
// ------------------------------------------------------------------------------------------------
const ringVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const ringFrag = `uniform vec3 color; uniform float t; uniform float width; uniform float mode; varying vec2 vUv;
void main(){ float r = length(vUv - 0.5) * 2.0;
  float a;
  if (mode < 0.5) { a = smoothstep(width, 0.0, abs(r - 0.9)) * (1.0 - t); }
  else if (mode < 1.5) { a = smoothstep(1.0, 0.2, r) * 0.75 * (1.0 - t * t); }
  else { a = smoothstep(1.0, 0.0, r) * (1.0 - t); }
  if (a < 0.003) discard; gl_FragColor = vec4(color * (mode > 1.5 ? 1.0 : 1.0), a); }`;

interface Ring { mesh: THREE.Mesh; t: number; dur: number; from: number; to: number; mat: THREE.ShaderMaterial }

// ------------------------------------------------------------------------------------------------
interface Flight {
  m: Missile; a: THREE.Vector3; b: THREE.Vector3; peak: number; omega: number; t: number; dur: number;
  head: THREE.Vector3; last: THREE.Vector3; interceptor?: { from: THREE.Vector3; start: number; done: boolean }; done: boolean; age: number;
}

interface Shot { a: THREE.Vector3; b: THREE.Vector3; t: number; dur: number; kind: string; arc: number }

export type SoundHook = (kind: 'launch' | 'boom' | 'nuke' | 'intercept' | 'shot' | 'siren' | 'flyby', at: THREE.Vector3, power: number, missile?: MissileType) => void;

export class FxLayer {
  readonly group = new THREE.Group();
  private add = new Pool(14000, true);
  private smoke = new Pool(9000, false);
  private flights = new Map<number, Flight>();
  private shots: Shot[] = [];
  private rings: Ring[] = [];
  private ringGeo = new THREE.PlaneGeometry(1, 1);
  sound?: SoundHook;
  onNuke?: (at: THREE.Vector3) => void;
  private alt = 1;

  constructor() {
    this.group.add(this.smoke.points, this.add.points);
  }

  private v = (lat: number, lon: number, r = 1) => new THREE.Vector3(...toXYZ(lat, lon, r));
  /** Visual scale multiplier so effects read at every zoom level. */
  private get k() { return Math.max(0.06, Math.min(1.6, this.alt * 0.9)); }

  // -------------------------------------------------------------------------------- missiles
  launch(m: Missile) {
    const a = this.v(m.from.lat, m.from.lon), b = this.v(m.to.lat, m.to.lon);
    const omega = a.angleTo(b);
    const peak = m.type === 'icbm' ? 0.06 + omega * 0.22 : m.type === 'ballistic' ? 0.012 + omega * 0.3 : m.type === 'hypersonic' ? 0.01 + omega * 0.08 : m.type === 'cruise' ? 0.0035 : 0.0025;
    const f: Flight = { m, a, b, peak, omega, t: m.elapsed / m.dur, dur: m.dur, head: a.clone(), last: a.clone(), done: false, age: 0 };
    if (m.interceptAt !== null) f.interceptor = { from: b.clone(), start: Math.max(0, m.interceptAt - 0.22), done: false };
    this.flights.set(m.id, f);
    // Launch flash + billowing smoke
    const up = a.clone().normalize();
    const k = this.k;
    const big = m.type === 'icbm' ? 2.5 : m.type === 'shahed' ? 0.4 : 1;
    this.add.emit(a.clone().multiplyScalar(1.001), new THREE.Vector3(), 0.03 * k * big, 0.02 * k, 0.5, 1, 0.8, 0.5, 1.4);
    for (let i = 0; i < 14 * big; i++) {
      const dir = randomTangent(up).multiplyScalar(0.004 * k * Math.random()).addScaledVector(up, 0.002 * k * Math.random());
      this.smoke.emit(a.clone().multiplyScalar(1.0008), dir, 0.006 * k * big, 0.01 * k * big, 3 + Math.random() * 3, 0.7, 0.68, 0.66, 0.32, 0.97, 0.0004 * k, 0.1);
    }
    this.sound?.('launch', a, big, m.type);
  }

  private trajectory(f: Flight, t: number, out: THREE.Vector3) {
    const s = Math.sin(f.omega) || 1e-6;
    const k1 = Math.sin((1 - t) * f.omega) / s, k2 = Math.sin(t * f.omega) / s;
    out.copy(f.a).multiplyScalar(k1).addScaledVector(f.b, k2);
    if (f.omega < 1e-6) out.copy(f.a);
    let h: number;
    switch (f.m.type) {
      case 'hypersonic': h = f.peak * (t < 0.25 ? Math.sin((t / 0.25) * Math.PI / 2) : Math.pow(1 - (t - 0.25) / 0.75, 0.6)); break;
      case 'cruise': case 'shahed': h = f.peak * Math.min(1, t * 12, (1 - t) * 25) + Math.sin(t * 40) * 0.0004; break;
      default: h = f.peak * Math.sin(Math.PI * t);
    }
    return out.normalize().multiplyScalar(1.0008 + h);
  }

  intercepted(m: Missile, at: LL) {
    const f = this.flights.get(m.id);
    const p = f ? f.head.clone() : this.v(at.lat, at.lon, 1.01);
    if (f) f.done = true;
    this.explosion(p, 0.5, false, true);
    this.sound?.('intercept', p, 0.6);
    this.flights.delete(m.id);
  }

  impact(m: Missile, at: LL) {
    const f = this.flights.get(m.id);
    if (f) f.done = true;
    this.flights.delete(m.id);
    const p = this.v(at.lat, at.lon, 1.0006);
    if (m.nuclear) this.nuke(p);
    else this.explosion(p, m.type === 'shahed' ? 0.5 : m.type === 'hypersonic' ? 1.3 : 1, true);
  }

  // -------------------------------------------------------------------------------- explosions
  explosion(p: THREE.Vector3, power = 1, ground = true, air = false) {
    const k = this.k * power;
    const up = p.clone().normalize();
    this.add.emit(p, new THREE.Vector3(), 0.05 * k, 0.12 * k, 0.35, 1, 0.95, 0.8, 2.2);
    this.add.emit(p, new THREE.Vector3(), 0.03 * k, 0.05 * k, 0.9, 1, 0.55, 0.15, 1.2);
    for (let i = 0; i < 18; i++) {
      const dir = randomDir().multiplyScalar(0.006 * k * (0.4 + Math.random()));
      if (ground) dir.addScaledVector(up, 0.004 * k * Math.random());
      const hot = Math.random();
      this.add.emit(p, dir, 0.012 * k, 0.01 * k, 0.5 + Math.random() * 0.6, 1, 0.5 + hot * 0.4, 0.1 + hot * 0.2, 1.3, 0.9, 0.001 * k);
    }
    for (let i = 0; i < 26; i++) {
      const dir = randomDir().multiplyScalar(0.02 * k * (0.5 + Math.random()));
      if (ground) dir.addScaledVector(up, 0.012 * k);
      this.add.emit(p, dir, 0.0025 * k, -0.001 * k, 0.6 + Math.random() * 0.8, 1, 0.75, 0.35, 1.5, 0.93, ground ? -0.025 * k : 0);
    }
    const smokeN = air ? 6 : 22;
    for (let i = 0; i < smokeN; i++) {
      const dir = randomTangent(up).multiplyScalar(0.003 * k * Math.random()).addScaledVector(up, (air ? 0.001 : 0.004) * k * (0.3 + Math.random()));
      const g = 0.12 + Math.random() * 0.15;
      this.smoke.emit(p.clone().addScaledVector(up, 0.002 * k), dir, 0.006 * k, 0.004 * k, 4 + Math.random() * 6, g, g * 0.95, g * 0.9, 0.6, 0.985, (air ? 0 : 0.0012) * k, 0.08);
    }
    if (ground) {
      this.ring(p, 0.02 * k, 0.12 * k, 0.9, new THREE.Color(1, 0.75, 0.45), 0, 0.12);
      this.ring(p, 0.025 * k, 0.03 * k, 40, new THREE.Color(0.02, 0.015, 0.01), 1);
      this.flashLight(p, 1.2 * power, 0.5);
      this.sound?.('boom', p, power);
    }
  }

  nuke(p: THREE.Vector3) {
    const k = Math.max(0.3, this.k) * 1.4;
    const up = p.clone().normalize();
    this.onNuke?.(p);
    this.add.emit(p, new THREE.Vector3(), 0.05 * k, 0.12 * k, 1.0, 1, 1, 0.95, 3);
    this.add.emit(p, new THREE.Vector3(), 0.03 * k, 0.006 * k, 7, 1, 0.55, 0.2, 1.5);
    // Fireball rising
    for (let i = 0; i < 50; i++) {
      const dir = randomDir().multiplyScalar(0.0015 * k * Math.random()).addScaledVector(up, 0.0025 * k);
      this.add.emit(p.clone().addScaledVector(up, 0.001 * k), dir, 0.008 * k, 0.003 * k, 3 + Math.random() * 3, 1, 0.45 + Math.random() * 0.3, 0.1, 1.3, 0.985, 0.0006 * k);
    }
    // Stem
    for (let i = 0; i < 60; i++) {
      const h = Math.random();
      const pos = p.clone().addScaledVector(up, 0.008 * k * h).add(randomTangent(up).multiplyScalar(0.0012 * k * Math.random()));
      const g = 0.38 + Math.random() * 0.2;
      this.smoke.emit(pos, up.clone().multiplyScalar(0.0012 * k * (0.3 + h)), 0.007 * k, 0.0016 * k, 12 + Math.random() * 8, g + 0.15, g, g * 0.85, 0.8, 0.99, 0, 0.15);
    }
    // Cap: torus of smoke at the top
    for (let i = 0; i < 110; i++) {
      const tan = randomTangent(up);
      const pos = p.clone().addScaledVector(up, 0.01 * k + Math.random() * 0.003 * k).addScaledVector(tan, 0.003 * k * Math.random());
      const vel = tan.multiplyScalar(0.0012 * k * (0.5 + Math.random())).addScaledVector(up, 0.0008 * k * Math.random());
      const warm = Math.random() < 0.35;
      this.smoke.emit(pos, vel, 0.011 * k, 0.0026 * k, 14 + Math.random() * 10, warm ? 0.85 : 0.55, warm ? 0.5 : 0.5, warm ? 0.32 : 0.47, 0.85, 0.99, 0.00015 * k, 0.2);
    }
    // Under-lit glow inside the cap
    for (let i = 0; i < 20; i++) this.add.emit(p.clone().addScaledVector(up, 0.01 * k).addScaledVector(randomTangent(up), 0.002 * k * Math.random()), new THREE.Vector3(), 0.008 * k, 0.001 * k, 6 + Math.random() * 4, 1, 0.4, 0.12, 0.7);
    this.ring(p, 0.005 * k, 0.25 * k, 2.2, new THREE.Color(1, 0.95, 0.85), 0, 0.06);
    this.ring(p, 0.005 * k, 0.16 * k, 3.5, new THREE.Color(1, 0.6, 0.3), 0, 0.12);
    this.ring(p, 0.01 * k, 0.03 * k, 90, new THREE.Color(0.08, 0.02, 0.0), 1);
    this.ring(p, 0.02 * k, 0.025 * k, 25, new THREE.Color(1, 0.35, 0.1), 2);
    this.flashLight(p, 3, 4);
    this.sound?.('nuke', p, 1);
  }

  private flashLight(p: THREE.Vector3, power: number, dur: number) {
    this.add.emit(p.clone().multiplyScalar(1.001), new THREE.Vector3(), 0.06 * this.k * power, 0.02 * this.k * power, dur, 1, 0.6, 0.3, 0.6);
  }

  ring(p: THREE.Vector3, from: number, to: number, dur: number, color: THREE.Color, mode: 0 | 1 | 2, width = 0.1) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: ringVert, fragmentShader: ringFrag, transparent: true, depthWrite: false,
      blending: mode === 1 ? THREE.NormalBlending : THREE.AdditiveBlending,
      uniforms: { color: { value: color }, t: { value: 0 }, width: { value: width }, mode: { value: mode } },
    });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.copy(p.clone().normalize().multiplyScalar(1.0009 + this.rings.length * 1e-6));
    mesh.lookAt(p.clone().multiplyScalar(2));
    mesh.scale.setScalar(from);
    mesh.renderOrder = 4;
    this.group.add(mesh);
    this.rings.push({ mesh, t: 0, dur, from, to, mat });
  }

  capturePulse(lat: number, lon: number, color: THREE.Color) {
    if (this.alt > 1.6) return;
    this.ring(this.v(lat, lon), 0.005, 0.05 * this.k, 1.6, color, 0, 0.18);
  }

  unitDestroyed(lat: number, lon: number) { this.explosion(this.v(lat, lon, 1.002), 0.7, true); }

  // -------------------------------------------------------------------------------- combat shots
  shot(from: LL, to: LL, kind: string) {
    if (this.shots.length > 120) return;
    const a = this.v(from.lat, from.lon, 1.002), b = this.v(to.lat, to.lon, 1.002);
    const d = a.distanceTo(b);
    const dur = kind === 'art' ? 0.9 + d * 40 : kind === 'ad' ? 0.6 : kind === 'air' ? 0.5 : kind === 'drone' ? 1.6 : 0.25;
    this.shots.push({ a, b, t: 0, dur, kind, arc: kind === 'art' ? d * 0.6 + 0.002 : kind === 'ad' ? d * 0.4 : 0.0005 });
    const k = this.k;
    if (kind === 'art' || kind === 'navy' || kind === 'gun') this.add.emit(a, new THREE.Vector3(), 0.006 * k, 0.01 * k, 0.15, 1, 0.8, 0.4, 1.5);
    if (Math.random() < 0.3) this.sound?.('shot', a, kind === 'art' ? 0.6 : 0.3);
  }

  // -------------------------------------------------------------------------------- update
  update(dt: number, alt: number, viewportH: number, missiles: Missile[], paused: boolean) {
    this.alt = alt;
    const scale = viewportH / (2 * Math.tan((42 * Math.PI) / 360));
    this.add.setScale(scale); this.smoke.setScale(scale);
    const k = this.k;
    const tmp = new THREE.Vector3();
    // Sync elapsed from authoritative missiles (handles network clients too).
    const live = new Map(missiles.map((m) => [m.id, m]));
    for (const [id, f] of this.flights) {
      const m = live.get(id);
      f.age += dt;
      if (m) f.t = m.elapsed / m.dur;
      else if (!paused) f.t += dt / f.dur;
      if (f.t >= 1.05 || f.age > 60) { this.flights.delete(id); continue; }
      f.last.copy(f.head);
      this.trajectory(f, Math.min(1, f.t), f.head);
      const type = f.m.type;
      // Trail particles between last and head positions.
      const steps = Math.max(1, Math.ceil(f.last.distanceTo(f.head) / (0.0015 * k)));
      for (let s = 0; s < Math.min(steps, 12); s++) {
        tmp.copy(f.last).lerp(f.head, s / steps);
        if (type === 'icbm' || type === 'ballistic' || type === 'hypersonic') {
          const boost = type === 'icbm' ? f.t < 0.3 : f.t < 0.45;
          if (boost) {
            this.add.emit(tmp, new THREE.Vector3(), 0.006 * k * (type === 'icbm' ? 1.6 : 1), 0.004 * k, 0.25, 1, 0.65, 0.25, 1.4);
            this.smoke.emit(tmp, randomDir().multiplyScalar(0.0003 * k), 0.0025 * k, 0.004 * k, 6 + Math.random() * 4, 0.85, 0.85, 0.88, 0.3, 0.99, 0, 0.05);
          } else if (type === 'hypersonic' || f.t > 0.8) {
            this.add.emit(tmp, new THREE.Vector3(), 0.004 * k, 0.002 * k, 0.4, 1, 0.45, 0.2, 1.1);
          }
        } else if (type === 'cruise') {
          this.add.emit(tmp, new THREE.Vector3(), 0.0025 * k, 0, 0.18, 1, 0.75, 0.4, 1);
          if (s % 2 === 0) this.smoke.emit(tmp, new THREE.Vector3(), 0.0018 * k, 0.003 * k, 2.5, 0.7, 0.7, 0.72, 0.3, 1, 0, 0.1);
        } else {
          if (s % 3 === 0) this.add.emit(tmp, new THREE.Vector3(), 0.0018 * k, 0, 0.3, 1, 0.6, 0.3, 0.7);
        }
      }
      // Bright head
      const headSize = type === 'icbm' ? 0.012 : type === 'shahed' ? 0.003 : 0.006;
      this.add.emit(f.head, new THREE.Vector3(), headSize * k, 0, 0.06, 1, type === 'hypersonic' ? 0.7 : 0.9, type === 'hypersonic' ? 1 : 0.7, 1.8);
      // Interceptor
      const ic = f.interceptor;
      if (ic && !ic.done && f.t >= ic.start && f.m.interceptAt !== null) {
        const tt = Math.min(1, (f.t - ic.start) / Math.max(0.01, f.m.interceptAt - ic.start));
        const target = this.trajectory(f, f.m.interceptAt, new THREE.Vector3());
        const p = ic.from.clone().lerp(target, tt);
        p.normalize().multiplyScalar(ic.from.length() + (target.length() - ic.from.length()) * Math.sqrt(tt) + Math.sin(Math.PI * tt) * 0.004);
        this.add.emit(p, new THREE.Vector3(), 0.004 * k, 0, 0.15, 0.7, 0.9, 1, 1.6);
        this.smoke.emit(p, new THREE.Vector3(), 0.0025 * k, 0.004 * k, 3, 0.9, 0.9, 0.92, 0.35, 1, 0, 0.05);
        if (tt >= 1) ic.done = true;
      }
    }
    // Shots
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t += dt / s.dur;
      if (s.t >= 1) {
        this.shots.splice(i, 1);
        const big = s.kind === 'art' || s.kind === 'air' || s.kind === 'drone' || s.kind === 'navy';
        this.add.emit(s.b, new THREE.Vector3(), (big ? 0.012 : 0.006) * k, 0.02 * k, 0.3, 1, 0.65, 0.25, 1.6);
        if (big) for (let j = 0; j < 4; j++) this.smoke.emit(s.b, randomDir().multiplyScalar(0.001 * k).addScaledVector(s.b.clone().normalize(), 0.001 * k), 0.005 * k, 0.008 * k, 3, 0.2, 0.19, 0.18, 0.6, 0.98, 0.0005 * k, 0.1);
        continue;
      }
      tmp.copy(s.a).lerp(s.b, s.t);
      const r = tmp.length();
      tmp.multiplyScalar((r + Math.sin(Math.PI * s.t) * s.arc) / r);
      const c = s.kind === 'ad' ? [0.7, 0.9, 1] : s.kind === 'drone' ? [1, 0.9, 0.6] : [1, 0.7, 0.35];
      this.add.emit(tmp, new THREE.Vector3(), 0.0025 * k, 0, 0.12, c[0], c[1], c[2], 1.3);
    }
    // Rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt / r.dur;
      if (r.t >= 1) { this.group.remove(r.mesh); r.mat.dispose(); this.rings.splice(i, 1); continue; }
      const e = 1 - Math.pow(1 - r.t, 2.2);
      r.mesh.scale.setScalar(r.from + (r.to - r.from) * e);
      r.mat.uniforms.t.value = r.t;
    }
    this.add.update(dt);
    this.smoke.update(dt);
  }

  flightHead(id: number) { return this.flights.get(id)?.head; }
}

function randomDir() {
  const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
  return new THREE.Vector3(r * Math.cos(th), u, r * Math.sin(th));
}

function randomTangent(n: THREE.Vector3) {
  const d = randomDir();
  return d.sub(n.clone().multiplyScalar(d.dot(n))).normalize();
}
