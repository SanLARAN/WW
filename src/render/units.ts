import * as THREE from 'three';
import type { Unit, UnitType } from '../game/types';
import { toXYZ } from '../core/geo';

export const UNIT_TYPES: UnitType[] = ['infantry', 'armor', 'artillery', 'airdef', 'drones', 'air', 'navy', 'special'];
const MAX = 6000;

function drawAtlas(): HTMLCanvasElement {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S * UNIT_TYPES.length; c.height = S;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round';
  UNIT_TYPES.forEach((t, i) => {
    g.save();
    g.translate(i * S + S / 2, S / 2);
    const w = 70, h = 46;
    switch (t) {
      case 'infantry': g.beginPath(); g.moveTo(-w / 2, -h / 2); g.lineTo(w / 2, h / 2); g.moveTo(w / 2, -h / 2); g.lineTo(-w / 2, h / 2); g.stroke(); break;
      case 'armor': g.beginPath(); g.ellipse(0, 0, w * 0.38, h * 0.3, 0, 0, Math.PI * 2); g.stroke(); break;
      case 'artillery': g.beginPath(); g.arc(0, 0, 13, 0, Math.PI * 2); g.fill(); g.beginPath(); g.moveTo(-w / 2, h / 2 - 4); g.lineTo(w / 2, h / 2 - 4); g.stroke(); break;
      case 'airdef': g.beginPath(); g.arc(0, h / 2 - 2, w * 0.36, Math.PI, 0); g.stroke(); g.beginPath(); g.moveTo(0, h / 2 - 2); g.lineTo(0, -h / 2 - 6); g.stroke(); break;
      case 'drones': g.beginPath(); g.moveTo(-w / 2, -h / 4); g.lineTo(0, h / 3); g.lineTo(w / 2, -h / 4); g.stroke(); g.beginPath(); g.arc(0, -4, 6, 0, Math.PI * 2); g.fill(); break;
      case 'air': g.beginPath(); g.moveTo(0, -h * 0.7); g.lineTo(0, h * 0.7); g.moveTo(-w * 0.5, 4); g.lineTo(0, -10); g.lineTo(w * 0.5, 4); g.moveTo(-16, h * 0.6); g.lineTo(0, h * 0.42); g.lineTo(16, h * 0.6); g.stroke(); break;
      case 'navy': g.beginPath(); g.moveTo(0, -h * 0.6); g.lineTo(0, h * 0.55); g.moveTo(-14, -h * 0.35); g.lineTo(14, -h * 0.35); g.moveTo(-w * 0.4, 6); g.quadraticCurveTo(-w * 0.3, h * 0.65, 0, h * 0.55); g.quadraticCurveTo(w * 0.3, h * 0.65, w * 0.4, 6); g.stroke(); break;
      case 'special': g.beginPath(); g.moveTo(8, -h * 0.6); g.lineTo(-12, 2); g.lineTo(6, 2); g.lineTo(-8, h * 0.6); g.stroke(); break;
    }
    g.restore();
  });
  return c;
}

const vert = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iColor;
attribute vec4 iData; // icon, flags, strength, scale
uniform float uScale;
uniform vec2 uViewport;
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
varying float vFlags;
varying float vStr;
varying float vIcon;
void main() {
  vUv = uv;
  vColor = iColor; vFlags = iData.y; vStr = iData.z; vIcon = iData.x;
  vec4 wp = modelMatrix * vec4(iPos, 1.0);
  vec3 toCam = normalize(cameraPosition - wp.xyz);
  float facing = dot(normalize(wp.xyz), toCam);
  vec4 clip = projectionMatrix * viewMatrix * wp;
  float px = uScale * iData.w;
  if (mod(floor(vFlags / 1.0), 2.0) == 1.0) px *= 1.18;
  vec2 off = (position.xy * vec2(1.5, 1.0)) * px / uViewport * 2.0;
  clip.xy += off * clip.w;
  if (facing < 0.05) clip = vec4(0.0, 0.0, -10.0, 1.0);
  gl_Position = clip;
}`;

const frag = /* glsl */ `
uniform sampler2D atlas;
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
varying float vFlags;
varying float vStr;
varying float vIcon;
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 p = (vUv - 0.5) * vec2(1.5, 1.0);
  float selected = mod(vFlags, 2.0);
  float own = mod(floor(vFlags / 2.0), 2.0);
  float engaged = mod(floor(vFlags / 4.0), 2.0);
  float hostile = mod(floor(vFlags / 8.0), 2.0);
  float moving = mod(floor(vFlags / 16.0), 2.0);
  float d = sdBox(p, vec2(0.62, 0.38), 0.08);
  if (d > 0.12) discard;
  vec4 col = vec4(0.0);
  // outer glow / selection ring
  float glow = smoothstep(0.12, 0.0, d);
  vec3 ringC = selected > 0.5 ? vec3(1.0, 0.78, 0.3) : hostile > 0.5 ? vec3(1.0, 0.25, 0.2) : vec3(0.0);
  float ringA = selected > 0.5 ? 0.9 : hostile > 0.5 ? 0.55 : 0.0;
  if (engaged > 0.5) { ringC = vec3(1.0, 0.35, 0.1); ringA = max(ringA, 0.5 + 0.5 * sin(uTime * 9.0)); }
  col = vec4(ringC, glow * ringA);
  if (d < 0.0) {
    vec3 bg = vColor * (0.8 + 0.25 * (0.5 - vUv.y));
    float edge = smoothstep(-0.05, -0.02, d);
    vec3 c = mix(bg, vec3(0.02, 0.03, 0.05), edge * 0.85);
    vec2 iuv = vec2((vIcon + (vUv.x - 0.5) * 1.15 + 0.5) / 8.0, vUv.y * 0.95 + 0.05);
    float sym = texture2D(atlas, iuv).a;
    float lum = dot(vColor, vec3(0.3, 0.59, 0.11));
    vec3 symC = lum > 0.62 ? vec3(0.05) : vec3(1.0);
    c = mix(c, symC, sym * (1.0 - edge));
    // strength bar
    if (vUv.y < 0.16 && vUv.y > 0.06 && abs(p.x) < 0.55) {
      float fill = step((p.x + 0.55) / 1.1, vStr);
      vec3 bar = mix(vec3(0.9, 0.15, 0.1), vec3(0.3, 0.95, 0.35), vStr);
      c = mix(vec3(0.05), bar, fill);
    }
    if (own > 0.5 && vUv.y > 0.86 && abs(p.x) < 0.5) c = mix(c, vec3(1.0, 0.78, 0.3), 0.85);
    if (moving > 0.5 && vUv.x > 0.9 && vUv.y > 0.7) c = vec3(0.3, 0.9, 1.0);
    col = vec4(c, 1.0);
  }
  gl_FragColor = col;
}`;

export interface UnitView { id: number; type: UnitType; owner: string; pos: THREE.Vector3; flags: number }

/** Instanced NATO-style unit counters, one draw call. */
export class UnitLayer {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private pos: THREE.InstancedBufferAttribute;
  private color: THREE.InstancedBufferAttribute;
  private data: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  private display = new Map<number, THREE.Vector3>();
  /** Screen-space projected positions for picking. */
  views: UnitView[] = [];

  constructor() {
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.data = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    for (const a of [this.pos, this.color, this.data]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.pos);
    this.geo.setAttribute('iColor', this.color);
    this.geo.setAttribute('iData', this.data);
    this.geo.instanceCount = 0;
    const atlas = new THREE.CanvasTexture(drawAtlas());
    atlas.generateMipmaps = true;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthTest: false, depthWrite: false,
      uniforms: { atlas: { value: atlas }, uScale: { value: 14 }, uViewport: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 } },
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  update(units: Unit[], dt: number, t: number, opts: {
    colorOf: (owner: string) => THREE.Color; selected: Set<number>; me: string | null; hostile: (owner: string) => boolean;
    engaged: (u: Unit) => boolean; alt: number; viewport: THREE.Vector2; visible: (u: Unit) => boolean;
  }) {
    const k = Math.min(1, dt * 6);
    const seen = new Set<number>();
    let n = 0;
    this.views.length = 0;
    // Pixel size: a bit larger when zoomed in.
    this.mat.uniforms.uScale.value = Math.max(9, Math.min(17, 20 - opts.alt * 6));
    this.mat.uniforms.uViewport.value.copy(opts.viewport);
    this.mat.uniforms.uTime.value = t;
    const far = opts.alt > 1.2;
    for (const u of units) {
      if (n >= MAX) break;
      if (!opts.visible(u)) continue;
      const mine = u.owner === opts.me;
      if (far && !mine && u.type !== 'navy' && !opts.hostile(u.owner) && u.id % 3 !== 0) continue;
      seen.add(u.id);
      const alt = u.type === 'air' ? 1.012 : u.type === 'drones' ? 1.006 : 1.0025;
      const target = new THREE.Vector3(...toXYZ(u.lat, u.lon, alt));
      let d = this.display.get(u.id);
      if (!d) { d = target.clone(); this.display.set(u.id, d); }
      else if (d.distanceToSquared(target) > 0.01) d.copy(target);
      else d.lerp(target, k);
      const c = opts.colorOf(u.owner);
      const flags = (opts.selected.has(u.id) ? 1 : 0) | (mine ? 2 : 0) | (opts.engaged(u) ? 4 : 0) | (opts.hostile(u.owner) ? 8 : 0) | (u.path.length ? 16 : 0);
      this.pos.setXYZ(n, d.x, d.y, d.z);
      this.color.setXYZ(n, c.r, c.g, c.b);
      this.data.setXYZW(n, UNIT_TYPES.indexOf(u.type), flags, Math.max(0, Math.min(1, u.str / 100)), mine ? 1.05 : 0.9);
      this.views.push({ id: u.id, type: u.type, owner: u.owner, pos: d, flags });
      n++;
    }
    for (const id of this.display.keys()) if (!seen.has(id)) this.display.delete(id);
    this.geo.instanceCount = n;
    this.pos.needsUpdate = this.color.needsUpdate = this.data.needsUpdate = true;
  }

  displayPos(id: number) { return this.display.get(id); }

  /** Unit ids under/inside a screen rect (client px). */
  pick(camera: THREE.Camera, rect: { x0: number; y0: number; x1: number; y1: number }, w: number, h: number): number[] {
    const out: number[] = [];
    const v = new THREE.Vector3();
    const camPos = (camera as THREE.PerspectiveCamera).position;
    for (const u of this.views) {
      const toCam = camPos.clone().sub(u.pos).normalize();
      if (u.pos.clone().normalize().dot(toCam) < 0.05) continue;
      v.copy(u.pos).project(camera);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      if (x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1) out.push(u.id);
    }
    return out;
  }
}
