import * as THREE from 'three';
import { toXYZ, fromXYZ, DEG } from '../core/geo';

const MIN_ALT = 0.035;
const MAX_ALT = 3.2;

/** Strategy-style globe camera: orbit around a surface target, auto-tilt when close. */
export class GlobeControls {
  lat = 45;
  lon = 30;
  alt = 1.9;
  private vLat = 0;
  private vLon = 0;
  private targetAlt = 1.9;
  private dragging = false;
  private moved = 0;
  private last = { x: 0, y: 0 };
  private keys = new Set<string>();
  private fly: { lat: number; lon: number; alt: number; t: number; from: { lat: number; lon: number; alt: number } } | null = null;
  shake = 0;
  enabled = true;
  onClick?: (e: PointerEvent) => void;
  onRightClick?: (e: PointerEvent) => void;
  onDoubleClick?: (e: PointerEvent) => void;
  private lastClick = { t: 0, x: 0, y: 0 };
  onHover?: (e: PointerEvent) => void;
  /** Called on drag start with shift held — box selection. Return true to consume. */
  onBoxStart?: (e: PointerEvent) => boolean;

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement) {
    dom.addEventListener('pointerdown', this.down);
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
    dom.addEventListener('wheel', this.wheel, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => { if (!isTyping(e)) this.keys.add(e.code); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get closeness() { return 1 - Math.min(1, Math.max(0, (this.alt - MIN_ALT) / (1.2 - MIN_ALT))); }

  flyTo(lat: number, lon: number, alt = Math.min(this.alt, 0.6)) {
    this.fly = { lat, lon, alt, t: 0, from: { lat: this.lat, lon: this.lon, alt: this.alt } };
    this.targetAlt = alt;
  }

  private down = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.dom.setPointerCapture?.(e.pointerId);
    if (e.button === 2) { this.onRightClick?.(e); return; }
    if (e.button !== 0) return;
    const now = performance.now();
    const dbl = now - this.lastClick.t < 320 && Math.hypot(e.clientX - this.lastClick.x, e.clientY - this.lastClick.y) < 6;
    this.lastClick = { t: now, x: e.clientX, y: e.clientY };
    if (dbl && this.onDoubleClick) { this.onDoubleClick(e); return; }
    if (e.shiftKey && this.onBoxStart?.(e)) return;
    this.dragging = true; this.moved = 0; this.fly = null;
    this.last = { x: e.clientX, y: e.clientY };
  };

  private move = (e: PointerEvent) => {
    if (!this.dragging) { if (e.target === this.dom) this.onHover?.(e); return; }
    const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
    this.last = { x: e.clientX, y: e.clientY };
    this.moved += Math.abs(dx) + Math.abs(dy);
    const k = (this.alt * 0.9 + 0.02) * (60 / this.dom.clientHeight);
    this.vLon = -dx * k / Math.max(0.25, Math.cos(this.lat * DEG));
    this.vLat = dy * k;
    this.lon += this.vLon; this.lat += this.vLat;
    this.clamp();
  };

  private up = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.moved < 5 && e.button === 0) { this.vLat = this.vLon = 0; this.onClick?.(e); }
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!this.enabled) return;
    this.fly = null;
    const f = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0022);
    this.targetAlt = Math.min(MAX_ALT, Math.max(MIN_ALT, this.targetAlt * f));
  };

  private clamp() {
    this.lat = Math.max(-85, Math.min(85, this.lat));
    this.lon = ((((this.lon + 180) % 360) + 360) % 360) - 180;
  }

  update(dt: number) {
    const pan = (this.alt * 0.9 + 0.03) * 70 * dt;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.lat += pan;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.lat -= pan;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.lon -= pan / Math.max(0.25, Math.cos(this.lat * DEG));
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.lon += pan / Math.max(0.25, Math.cos(this.lat * DEG));
    if (this.keys.has('KeyQ')) this.targetAlt = Math.min(MAX_ALT, this.targetAlt * (1 + dt * 1.5));
    if (this.keys.has('KeyE')) this.targetAlt = Math.max(MIN_ALT, this.targetAlt * (1 - dt * 1.5));

    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt * 0.8);
      const s = f.t * f.t * (3 - 2 * f.t);
      let dLon = f.lon - f.from.lon;
      if (dLon > 180) dLon -= 360; else if (dLon < -180) dLon += 360;
      this.lat = f.from.lat + (f.lat - f.from.lat) * s;
      this.lon = f.from.lon + dLon * s;
      const hop = Math.sin(Math.PI * s) * Math.min(1.2, Math.hypot(f.lat - f.from.lat, dLon) / 90);
      this.alt = f.from.alt + (f.alt - f.from.alt) * s + hop;
      if (f.t >= 1) { this.fly = null; this.targetAlt = this.alt; }
    } else {
      if (!this.dragging) {
        this.lat += this.vLat; this.lon += this.vLon;
        const damp = Math.pow(0.0025, dt);
        this.vLat *= damp; this.vLon *= damp;
      }
      this.alt += (this.targetAlt - this.alt) * Math.min(1, dt * 7);
    }
    this.clamp();
    this.apply();
  }

  apply() {
    const tilt = this.closeness ** 1.6 * 58 * DEG;
    const t = new THREE.Vector3(...toXYZ(this.lat, this.lon, 1));
    const n = t.clone().normalize();
    const north = new THREE.Vector3(0, 1, 0).sub(n.clone().multiplyScalar(n.y)).normalize();
    const pos = t.clone()
      .addScaledVector(n, this.alt * Math.cos(tilt))
      .addScaledVector(north, -this.alt * Math.sin(tilt));
    if (this.shake > 0) {
      const s = this.shake * 0.004 * (this.alt + 0.1);
      pos.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
      this.shake = Math.max(0, this.shake - 0.03);
    }
    this.camera.position.copy(pos);
    this.camera.up.copy(north.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(n, Math.sin(tilt)));
    this.camera.lookAt(t.clone().addScaledVector(north, this.alt * 0.12 * Math.sin(tilt)));
    this.camera.near = Math.max(0.0005, this.alt * 0.05);
    this.camera.far = 60;
    this.camera.updateProjectionMatrix();
  }

  /** Surface lat/lon under a screen point, or null if off-globe. */
  pick(clientX: number, clientY: number): { lat: number; lon: number } | null {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1), new THREE.Vector3());
    return hit ? fromXYZ(hit.x, hit.y, hit.z) : null;
  }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
