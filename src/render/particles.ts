import * as THREE from 'three';
import type { Layout } from '../world/layout';

/**
 * Atmosphere: rain (drizzle slanting with the wind), drifting haze sheets in the
 * treeline, and a slow dust film the overcast light picks up. All procedural.
 */
export class Weather {
  readonly root = new THREE.Group();
  private rain: THREE.Points;
  private rainPos: Float32Array;
  private haze: THREE.Mesh[] = [];
  private wind = 0.9;

  constructor(layout: Layout) {
    // ---- drizzle: 5000 points in a 70 m column that follows the camera
    const COUNT = 5200;
    const geo = new THREE.BufferGeometry();
    this.rainPos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      this.rainPos[i * 3] = (Math.random() - 0.5) * 70;
      this.rainPos[i * 3 + 1] = Math.random() * 26;
      this.rainPos[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    const dropTex = makeDropTexture();
    this.rain = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.11,
        map: dropTex,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        sizeAttenuation: true,
        color: 0xc8d2d6,
      }),
    );
    this.rain.frustumCulled = false;
    this.root.add(this.rain);

    // ---- haze: a few very soft planes laid across the far treeline
    const hazeTex = makeHazeTexture();
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(160, 44),
        new THREE.MeshBasicMaterial({
          map: hazeTex, transparent: true, opacity: 0.11 + Math.random() * 0.07,
          depthWrite: false, color: 0xb9c0c2,
        }),
      );
      const a = (i / 7) * Math.PI * 2;
      m.position.set(Math.cos(a) * 105, 13 + Math.random() * 8, Math.sin(a) * 105);
      m.lookAt(0, m.position.y, 0);
      this.haze.push(m);
      this.root.add(m);
    }
    void layout;
  }

  update(dt: number, camX: number, camZ: number) {
    this.wind = 0.9 + Math.sin(performance.now() * 0.00016) * 0.45;
    // rain lives in a moving box around the player: cheap and always visible
    this.rain.position.set(camX, 0, camZ);
    const p = this.rainPos;
    const fall = 15 * dt;
    for (let i = 0; i < p.length; i += 3) {
      p[i + 1] -= fall;
      p[i] += this.wind * dt * 2.6;
      p[i + 2] += this.wind * dt * 1.2;
      if (p[i + 1] < 0) {
        p[i + 1] = 24 + Math.random() * 4;
        p[i] = (Math.random() - 0.5) * 70;
        p[i + 2] = (Math.random() - 0.5) * 70;
      }
      if (p[i] > 35) p[i] -= 70;
      if (p[i + 2] > 35) p[i + 2] -= 70;
    }
    (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    // haze drifts slowly around the ring, never telegraphing its own edges
    for (let i = 0; i < this.haze.length; i++) {
      const m = this.haze[i];
      m.position.y = 12 + Math.sin(performance.now() * 0.00009 + i) * 3;
    }
  }
}

function makeDropTexture() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 32;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(3, 0, 2, 32);
  return new THREE.CanvasTexture(c);
}

function makeHazeTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 64, 4, 128, 64, 128);
  grd.addColorStop(0, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 128);
  return new THREE.CanvasTexture(c);
}
