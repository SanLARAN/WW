import * as THREE from 'three';
import { toXYZ, DEG } from '../core/geo';
import type { LL } from '../game/types';

// ------------------------------------------------------------------------------------------------ labels
interface Label { sprite: THREE.Sprite; pos: THREE.Vector3; minAlt: number; maxAlt: number; key: string; text: string }

function textTexture(text: string, opts: { size: number; color: string; weight?: string; letter?: number; dot?: string; font?: string }) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = `${opts.weight ?? '600'} ${opts.size}px ${opts.font ?? '"Exo 2", sans-serif'}`;
  g.font = font;
  const spaced = opts.letter ? text.split('').join('\u200A'.repeat(opts.letter)) : text;
  const w = Math.ceil(g.measureText(spaced).width * 1.08 + g.lineWidth) + (opts.dot ? opts.size : 0) + 24;
  const h = Math.ceil(opts.size * 1.5);
  c.width = w; c.height = h;
  g.font = font;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const x = opts.dot ? opts.size * 0.9 : 8;
  if (opts.dot) {
    g.fillStyle = opts.dot; g.beginPath(); g.arc(opts.size * 0.4, h / 2, opts.size * 0.22, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.8)'; g.lineWidth = 2; g.stroke();
  }
  g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = Math.max(3, opts.size / 7);
  g.strokeText(spaced, x, h / 2);
  g.fillStyle = opts.color;
  g.fillText(spaced, x, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { tex: t, aspect: w / h };
}

export class LabelLayer {
  readonly group = new THREE.Group();
  private labels = new Map<string, Label>();

  set(key: string, text: string, lat: number, lon: number, worldH: number, minAlt: number, maxAlt: number, style: 'country' | 'city' | 'capital') {
    const existing = this.labels.get(key);
    const pos = new THREE.Vector3(...toXYZ(lat, lon, 1.004));
    if (existing && existing.text === text) { existing.pos.copy(pos); existing.sprite.position.copy(pos); return; }
    if (existing) this.remove(key);
    const { tex, aspect } = style === 'country'
      ? textTexture(text.toUpperCase(), { size: 64, color: 'rgba(240,232,215,0.95)', weight: '700', letter: 2 })
      : textTexture(text, { size: 40, color: style === 'capital' ? '#ffe6b0' : '#e8eef5', weight: style === 'capital' ? '700' : '500', dot: style === 'capital' ? '#e8a33d' : '#cfd8e3' });
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false, sizeAttenuation: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(worldH * aspect, worldH, 1);
    if (style !== 'country') sprite.center.set(0.08, 0.5);
    sprite.position.copy(pos);
    sprite.renderOrder = style === 'country' ? 7 : 8;
    this.group.add(sprite);
    this.labels.set(key, { sprite, pos, minAlt, maxAlt, key, text });
  }

  remove(key: string) {
    const l = this.labels.get(key);
    if (!l) return;
    this.group.remove(l.sprite);
    l.sprite.material.map?.dispose(); l.sprite.material.dispose();
    this.labels.delete(key);
  }

  keys() { return [...this.labels.keys()]; }

  update(camPos: THREE.Vector3, alt: number) {
    for (const l of this.labels.values()) {
      const facing = l.pos.clone().normalize().dot(camPos.clone().sub(l.pos).normalize());
      const inRange = alt >= l.minAlt && alt <= l.maxAlt;
      const fadeAlt = Math.min(1, (alt - l.minAlt) / (l.minAlt * 0.3 + 0.01), (l.maxAlt - alt) / (l.maxAlt * 0.3 + 0.01));
      const o = inRange ? Math.max(0, Math.min(1, fadeAlt)) * Math.max(0, Math.min(1, (facing - 0.1) * 4)) : 0;
      l.sprite.visible = o > 0.01;
      l.sprite.material.opacity = o;
    }
  }
}

// ------------------------------------------------------------------------------------------------ path lines
const dashVert = `attribute float dist; varying float vDist; void main(){ vDist = dist; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const dashFrag = `uniform vec3 color; uniform float time; uniform float opacity; varying float vDist;
  void main(){ float d = fract(vDist * 220.0 - time * 1.5); if (d > 0.6) discard; gl_FragColor = vec4(color, opacity); }`;

export class PathLayer {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private hostileMat: THREE.ShaderMaterial;
  private lines: THREE.Line[] = [];

  constructor() {
    const mk = (c: number, o: number) => new THREE.ShaderMaterial({ vertexShader: dashVert, fragmentShader: dashFrag, transparent: true, depthTest: false, uniforms: { color: { value: new THREE.Color(c) }, time: { value: 0 }, opacity: { value: o } } });
    this.mat = mk(0xffc861, 0.95);
    this.hostileMat = mk(0xff5040, 0.6);
  }

  set(paths: { from: THREE.Vector3; pts: LL[]; hostile?: boolean }[], time: number) {
    for (const l of this.lines) { this.group.remove(l); l.geometry.dispose(); }
    this.lines = [];
    this.mat.uniforms.time.value = time; this.hostileMat.uniforms.time.value = time;
    for (const p of paths) {
      const pts: THREE.Vector3[] = [p.from.clone().normalize().multiplyScalar(1.003)];
      for (const w of p.pts) {
        const b = new THREE.Vector3(...toXYZ(w.lat, w.lon, 1.003));
        const a = pts[pts.length - 1];
        const n = Math.max(1, Math.ceil(a.angleTo(b) / (0.5 * DEG)));
        for (let i = 1; i <= n; i++) pts.push(a.clone().lerp(b, i / n).normalize().multiplyScalar(1.003));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const dist = new Float32Array(pts.length);
      for (let i = 1; i < pts.length; i++) dist[i] = dist[i - 1] + pts[i].distanceTo(pts[i - 1]);
      g.setAttribute('dist', new THREE.BufferAttribute(dist, 1));
      const line = new THREE.Line(g, p.hostile ? this.hostileMat : this.mat);
      line.renderOrder = 9;
      this.group.add(line);
      this.lines.push(line);
      // Arrowhead dot at destination
    }
  }
}

// ------------------------------------------------------------------------------------------------ range circles
export class CircleLayer {
  readonly group = new THREE.Group();
  private items: THREE.Object3D[] = [];

  set(circles: { lat: number; lon: number; km: number; color: THREE.Color; fill: number; line: number }[]) {
    for (const o of this.items) { this.group.remove(o); (o as THREE.Mesh).geometry.dispose(); ((o as THREE.Mesh).material as THREE.Material).dispose(); }
    this.items = [];
    for (const c of circles) {
      const center = new THREE.Vector3(...toXYZ(c.lat, c.lon, 1));
      const ang = c.km / 6371;
      const north = new THREE.Vector3(0, 1, 0);
      const t1 = north.clone().sub(center.clone().multiplyScalar(center.dot(north))).normalize();
      if (t1.lengthSq() < 0.1) t1.set(1, 0, 0);
      const t2 = center.clone().cross(t1).normalize();
      const ring: THREE.Vector3[] = [];
      const N = 72;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const dir = t1.clone().multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a));
        ring.push(center.clone().multiplyScalar(Math.cos(ang)).addScaledVector(dir, Math.sin(ang)).normalize().multiplyScalar(1.0015));
      }
      if (c.line > 0) {
        const g = new THREE.BufferGeometry().setFromPoints(ring);
        const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: c.color, transparent: true, opacity: c.line, depthWrite: false }));
        l.renderOrder = 3;
        this.group.add(l); this.items.push(l);
      }
      if (c.fill > 0) {
        const verts: number[] = [];
        const ctr = center.clone().multiplyScalar(1.0014);
        for (let i = 0; i < N; i++) verts.push(ctr.x, ctr.y, ctr.z, ring[i].x, ring[i].y, ring[i].z, ring[i + 1].x, ring[i + 1].y, ring[i + 1].z);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: c.color, transparent: true, opacity: c.fill, depthWrite: false, side: THREE.DoubleSide }));
        m.renderOrder = 3;
        this.group.add(m); this.items.push(m);
      }
    }
  }
}
