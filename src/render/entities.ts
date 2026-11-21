import * as THREE from 'three';
import type { EnemyState, GameState, SupplyBox } from '../core/types';
import { rng } from '../world/layout';

/**
 * Visuals for everything the sim spawns: enemies, tracers, impacts, supply
 * crates. Kept as pooled meshes so nothing allocates during a fight.
 */

const enemyGeoCache: Record<string, THREE.BufferGeometry[]> = {};

function soldierGeo() {
  if (enemyGeoCache.soldier) return enemyGeoCache.soldier;
  const torso = new THREE.CapsuleGeometry(0.24, 0.5, 4, 8);
  const head = new THREE.SphereGeometry(0.13, 10, 8);
  const leg = new THREE.BoxGeometry(0.16, 0.82, 0.18);
  const arm = new THREE.BoxGeometry(0.12, 0.6, 0.14);
  enemyGeoCache.soldier = [torso, head, leg, arm];
  return enemyGeoCache.soldier;
}

export class EntityView {
  readonly root = new THREE.Group();
  private bodies = new Map<number, { group: THREE.Group; hpBar: THREE.Mesh; legs: THREE.Mesh[] }>();
  private tracers: THREE.Line[] = [];
  private tracerPool: THREE.Line[] = [];
  private impacts: THREE.Mesh[] = [];
  private impactPool: THREE.Mesh[] = [];
  private crates = new Map<number, THREE.Group>();

  private matHostile = new THREE.MeshStandardMaterial({ color: 0x3b3f33, roughness: 0.85, metalness: 0.15 });
  private matSkin = new THREE.MeshStandardMaterial({ color: 0x8a6a54, roughness: 0.9, metalness: 0 });
  private matDrone = new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: 0.45, metalness: 0.7 });
  private matArmor = new THREE.MeshStandardMaterial({ color: 0x2b2f26, roughness: 0.7, metalness: 0.5 });

  constructor() {
    this.root.matrixAutoUpdate = false;
  }

  private bodyFor(e: EnemyState) {
    let b = this.bodies.get(e.id);
    if (b) return b;
    const g = new THREE.Group();
    if (e.kind === 'infantry') {
      const [torso, head, legGeo, armGeo] = soldierGeo();
      const body = new THREE.Mesh(torso, this.matHostile);
      body.position.y = 1.05;
      body.castShadow = true;
      g.add(body);
      const h = new THREE.Mesh(head, this.matSkin);
      h.position.y = 1.55;
      h.castShadow = true;
      g.add(h);
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.145, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), this.matDrone);
      helmet.position.y = 1.58;
      g.add(helmet);
      const legs: THREE.Mesh[] = [];
      for (const side of [-1, 1]) {
        const l = new THREE.Mesh(legGeo, this.matHostile);
        l.position.set(side * 0.11, 0.41, 0);
        l.castShadow = true;
        legs.push(l);
        g.add(l);
        const a = new THREE.Mesh(armGeo, this.matHostile);
        a.position.set(side * 0.32, 1.15, 0.03);
        a.rotation.x = -0.5;
        g.add(a);
      }
      // a rifle silhouette so you can read intent at 80 m
      const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.72), this.matDrone);
      rifle.position.set(0.24, 1.2, -0.28);
      g.add(rifle);
      b = { group: g, hpBar: new THREE.Mesh(), legs };
    } else if (e.kind === 'drone' || e.kind === 'fpv') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.34), this.matDrone);
      body.castShadow = true;
      g.add(body);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.05), this.matDrone);
        arm.position.set(sx * 0.22, 0.02, sz * 0.22);
        arm.rotation.y = Math.atan2(sz, sx);
        g.add(arm);
        const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.01, 12), new THREE.MeshStandardMaterial({ color: 0x101112, roughness: 0.6, transparent: true, opacity: 0.5 }));
        rotor.position.set(sx * 0.4, 0.05, sz * 0.4);
        g.add(rotor);
      }
      if (e.kind === 'fpv') {
        const warhead = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0x5a5a2c, roughness: 0.85 }));
        warhead.position.y = -0.2;
        warhead.rotation.x = Math.PI;
        g.add(warhead);
      }
      b = { group: g, hpBar: new THREE.Mesh(), legs: [] };
    } else {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.1, 5.6), this.matArmor);
      hull.position.y = 0.85;
      hull.castShadow = true;
      g.add(hull);
      const turret = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.8, 2.4), this.matArmor);
      turret.position.y = 1.7;
      g.add(turret);
      const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3.0, 8), this.matDrone);
      gun.rotation.x = Math.PI / 2;
      gun.position.set(0, 1.8, -2.4);
      g.add(gun);
      b = { group: g, hpBar: new THREE.Mesh(), legs: [] };
    }
    this.bodies.set(e.id, b);
    this.root.add(g);
    return b;
  }

  private tracerLine(): THREE.Line {
    const l = this.tracerPool.pop();
    if (l) { l.visible = true; return l; }
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    line.frustumCulled = false;
    this.root.add(line);
    return line;
  }

  private impactMesh(): THREE.Mesh {
    const m = this.impactPool.pop();
    if (m) { m.visible = true; return m; }
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xe8d9b8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.root.add(mesh);
    return mesh;
  }

  private crateFor(box: SupplyBox) {
    let c = this.crates.get(box.id);
    if (c) return c;
    c = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 1.1), new THREE.MeshStandardMaterial({ color: 0x4b5238, roughness: 0.8, metalness: 0.25 }));
    body.castShadow = true;
    body.receiveShadow = true;
    c.add(body);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.1, 0.14), new THREE.MeshStandardMaterial({ color: 0x9aa06a, roughness: 0.7 }));
    strap.position.y = 0.2;
    c.add(strap);
    // parachute canopy, deflates after landing
    const chute = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.42),
      new THREE.MeshStandardMaterial({ color: 0xa8a894, roughness: 0.9, side: THREE.DoubleSide }),
    );
    chute.position.y = 3.2;
    chute.name = 'chute';
    c.add(chute);
    const smoke = new THREE.PointLight(0xff5a2a, 3, 12);
    smoke.position.y = 1.0;
    smoke.name = 'light';
    c.add(smoke);
    this.crates.set(box.id, c);
    this.root.add(c);
    return c;
  }

  update(s: GameState, dt: number, time: number) {
    const r = rng(s.tick ^ 0x99);

    // ---- enemies
    const seen = new Set<number>();
    for (const e of s.enemies) {
      seen.add(e.id);
      let b = this.bodyFor(e);
      if (!this.bodies.has(e.id)) b = this.bodyFor(e);
      b.group.visible = e.alive;
      if (!e.alive) continue;
      b.group.position.set(e.x, e.kind === 'drone' || e.kind === 'fpv' ? e.y : 0, e.z);
      b.group.rotation.y = e.yaw;
      if (e.kind === 'drone' || e.kind === 'fpv') {
        b.group.rotation.z = Math.sin(time * 8 + e.id) * 0.12;
        b.group.position.y += Math.sin(time * 3 + e.id) * 0.15;
      }
      if (b.legs.length) {
        const sp = Math.hypot(e.x - (b.group.userData.lx ?? e.x), e.z - (b.group.userData.lz ?? e.z)) / Math.max(dt, 1e-3);
        b.group.userData.lx = e.x; b.group.userData.lz = e.z;
        const stride = Math.sin(time * 9) * Math.min(1, sp / 2) * 0.55;
        b.legs[0].rotation.x = stride;
        b.legs[1].rotation.x = -stride;
      }
    }
    for (const [id, b] of this.bodies) {
      if (!seen.has(id)) { this.root.remove(b.group); this.bodies.delete(id); }
    }

    // ---- tracers
    for (const line of this.tracers) { line.visible = false; this.tracerPool.push(line); }
    this.tracers.length = 0;
    for (const t of s.tracers) {
      const l = this.tracerLine();
      const arr = (l.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      arr[0] = t.from.x; arr[1] = t.from.y; arr[2] = t.from.z;
      arr[3] = t.to.x; arr[4] = t.to.y; arr[5] = t.to.z;
      (l.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (l.material as THREE.LineBasicMaterial).opacity = Math.min(1, t.t / 60);
      (l.material as THREE.LineBasicMaterial).color.setHex(t.enemy ? 0xffb070 : 0xffe6b0);
      l.visible = true;
      this.tracers.push(l);
    }

    // ---- impacts (dust puffs and blood)
    for (const m of this.impacts) { m.visible = false; this.impactPool.push(m); }
    this.impacts.length = 0;
    for (const im of s.impacts) {
      const m = this.impactMesh();
      m.position.set(im.x, im.y, im.z);
      const k = 1 - im.t / 700;
      m.scale.setScalar((0.5 + (1 - k) * 2.2) * (im.kind === 'blood' ? 0.8 : 1));
      (m.material as THREE.MeshBasicMaterial).color.setHex(im.kind === 'blood' ? 0x7a1512 : im.kind === 'metal' ? 0xfff0c0 : 0xb7a888);
      (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, k) * 0.8;
      m.visible = true;
      this.impacts.push(m);
    }

    // ---- supply crates
    const live = new Set<number>();
    for (const box of s.supplies) {
      live.add(box.id);
      const c = this.crateFor(box);
      c.visible = !box.opened;
      c.position.set(box.x, box.y + 0.35, box.z);
      c.rotation.y = time * 0.2 + box.id;
      const chute = c.getObjectByName('chute');
      if (chute) {
        chute.scale.setScalar(Math.min(1, box.falling / 3));
        chute.visible = box.falling > 0.2;
      }
      const light = c.getObjectByName('light') as THREE.PointLight | undefined;
      if (light) light.intensity = box.falling > 0 ? 0 : 2 + Math.sin(time * 6) * 1.4;
    }
    for (const [id, c] of this.crates) {
      if (!live.has(id)) { this.root.remove(c); this.crates.delete(id); }
    }
    void r;
  }
}
