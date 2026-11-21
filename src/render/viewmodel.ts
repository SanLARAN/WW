import * as THREE from 'three';
import type { WeaponId } from '../core/types';
import type { Controller } from '../game/controller';

/**
 * First-person weapon view model.
 *
 * Built from primitives with a small PBR treatment (parkarised steel, polymer,
 * blued barrel), then driven by inertia: the gun lags the yaw, dips when you
 * sprint, dips again on landing, kicks on the shot and settles. Ads brings the
 * sights to the centre of the screen. This is what sells the weight.
 */

type Parts = { root: THREE.Group; muzzle: THREE.Object3D };

function steel(color = 0x2b2d2e, rough = 0.42, metal = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function buildRifle(): Parts {
  const root = new THREE.Group();
  const dark = steel(0x1f2122, 0.5, 0.6);
  const body = steel(0x2a2c2b, 0.55, 0.5);
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.72, metalness: 0.08 });

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.10, 0.42), body);
  receiver.position.set(0, 0, 0);
  root.add(receiver);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.42, 10), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.012, -0.40);
  root.add(barrel);

  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.062, 0.22), wood);
  handguard.position.set(0, -0.004, -0.27);
  root.add(handguard);

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.17, 0.075), dark);
  mag.position.set(0, -0.13, -0.02);
  mag.rotation.x = -0.22;
  root.add(mag);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.14, 0.06), dark);
  grip.position.set(0, -0.10, 0.14);
  grip.rotation.x = 0.3;
  root.add(grip);

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.075, 0.26), wood);
  stock.position.set(0, -0.02, 0.32);
  root.add(stock);

  // rear sight ghost ring + front post: what you look through when ADS
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.004, 6, 14), dark);
  ring.position.set(0, 0.062, 0.06);
  root.add(ring);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.03, 0.006), dark);
  post.position.set(0, 0.052, -0.5);
  root.add(post);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, -0.62);
  root.add(muzzle);
  return { root, muzzle };
}

function buildShotgun(): Parts {
  const root = new THREE.Group();
  const dark = steel(0x22242a, 0.45, 0.8);
  const wood = new THREE.MeshStandardMaterial({ color: 0x4d3119, roughness: 0.68, metalness: 0.1 });
  const rec = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.105, 0.4), dark);
  root.add(rec);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.5, 10), dark);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, -0.012, -0.36);
  root.add(tube);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.5, 10), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, -0.36);
  root.add(barrel);
  const fore = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.2), wood);
  fore.position.set(0, -0.02, -0.3);
  root.add(fore);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.3), wood);
  stock.position.set(0, -0.03, 0.33);
  root.add(stock);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, -0.62);
  root.add(muzzle);
  return { root, muzzle };
}

function buildSniper(): Parts {
  const root = new THREE.Group();
  const dark = steel(0x1e2224, 0.4, 0.8);
  const stockMat = new THREE.MeshStandardMaterial({ color: 0x3b3a30, roughness: 0.6, metalness: 0.2 });
  const rec = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.5), dark);
  root.add(rec);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.72, 10), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.01, -0.58);
  root.add(barrel);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.1, 0.36), stockMat);
  stock.position.set(0, -0.02, 0.38);
  root.add(stock);
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.3, 12), dark);
  scope.rotation.x = Math.PI / 2;
  scope.position.set(0, 0.085, -0.02);
  root.add(scope);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 14), new THREE.MeshStandardMaterial({ color: 0x0a1418, roughness: 0.1, metalness: 1 }));
  lens.position.set(0, 0.085, 0.13);
  root.add(lens);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.01, -0.94);
  root.add(muzzle);
  return { root, muzzle };
}

function buildLmg(): Parts {
  const root = new THREE.Group();
  const dark = steel(0x23262a, 0.48, 0.75);
  const rec = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.12, 0.5), dark);
  root.add(rec);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.021, 0.6, 10), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.015, -0.52);
  root.add(barrel);
  const ammo = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.14, 0.2), steel(0x3c4a34, 0.7, 0.5));
  ammo.position.set(0.02, -0.13, 0.02);
  root.add(ammo);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.28), dark);
  stock.position.set(0, -0.01, 0.36);
  root.add(stock);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.015, -0.84);
  root.add(muzzle);
  return { root, muzzle };
}

export class ViewModel {
  readonly root = new THREE.Group();
  private parts: Record<string, Parts> = {};
  private recoil = 0;
  private recoilVel = 0;
  private flash: THREE.Mesh;
  private flashLight: THREE.PointLight;
  private flashT = 0;
  private weapon: WeaponId = 'ak';

  constructor() {
    const scene = new THREE.Group();
    this.parts.ak = buildRifle();
    this.parts.shotgun = buildShotgun();
    this.parts.sniper = buildSniper();
    this.parts.lmg = buildLmg();
    for (const p of Object.values(this.parts)) {
      p.root.visible = false;
      p.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = false;
          o.receiveShadow = false;
          // Draw the gun over the world: a first-person weapon must never clip
          // into a wall you are standing against.
          (o as THREE.Mesh).renderOrder = 100;
          const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
          mat.depthTest = false;
          mat.depthWrite = false;
        }
      });
      scene.add(p.root);
    }
    this.root.add(scene);

    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffdf9a, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }),
    );
    this.flash.renderOrder = 120;
    this.root.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffc46a, 0, 14, 2);
    this.root.add(this.flashLight);

    this.root.matrixAutoUpdate = false;
    this.root.renderOrder = 9;
  }

  setWeapon(id: WeaponId) {
    if (this.weapon === id) return;
    this.weapon = id;
    for (const [k, p] of Object.entries(this.parts)) p.root.visible = k === id || (id === 'drone' && k === 'ak');
  }

  /** Called on every shot: strong kick that settles like a real action. */
  kick(strength: number) {
    this.recoilVel += 22 * strength;
    this.flashT = 0.045;
  }

  update(dt: number, c: Controller, t: number) {
    const p = this.parts[this.weapon] ?? this.parts.ak;
    for (const [k, part] of Object.entries(this.parts)) part.root.visible = k === this.weapon || (this.weapon === 'drone' && k === 'ak');
    void p;

    const ads = c.adsAmount;
    // weapon spring
    const acc = -this.recoil * 620 - this.recoilVel * 26;
    this.recoilVel += acc * dt;
    this.recoil += this.recoilVel * dt;
    this.recoil = Math.max(-0.5, Math.min(1.2, this.recoil));

    // hip vs. ADS pose
    const hipPos = new THREE.Vector3(0.175, -0.175, -0.32);
    const hipRot = new THREE.Euler(0.02, 0.055, 0.02);
    const adsPos = new THREE.Vector3(0, -0.058, -0.24);

    const sway = 0.018;
    const sprintDip = c.sprinting ? 1 : 0;
    const bobX = Math.cos(t * 6.6) * 0.006 * (1 - ads);
    const bobY = Math.sin(t * 13.2) * 0.005 * (1 - ads);

    const pos = hipPos.clone().lerp(adsPos, ads);
    pos.x += (1 - ads) * (Math.sin(t * 1.3) * sway * 0.5 + bobX) + (sprintDip * 0.05);
    pos.y += (1 - ads) * (Math.cos(t * 1.7) * sway * 0.4 + bobY) - sprintDip * 0.075;
    pos.z += this.recoil * 0.06 + ads * this.recoil * 0.02;

    const rot = new THREE.Euler(
      hipRot.x + (1 - ads) * Math.sin(t * 1.9) * 0.006 - sprintDip * 0.35 + this.recoil * 0.05,
      hipRot.y + (1 - ads) * Math.sin(t * 1.1) * 0.008,
      hipRot.z + (1 - ads) * Math.sin(t * 2.3) * 0.01 + sprintDip * 0.18,
    );

    for (const part of Object.values(this.parts)) {
      if (!part.root.visible) continue;
      part.root.position.copy(pos);
      part.root.rotation.copy(rot);
      // muzzle flash follows whichever gun is out
      if (part === this.parts[this.weapon]) {
        part.muzzle.getWorldPosition(this.flash.position);
        this.flash.position.copy(part.muzzle.position).applyEuler(rot).add(pos);
        this.flashLight.position.copy(this.flash.position);
      }
    }

    if (this.flashT > 0) {
      this.flashT -= dt;
      const k = Math.max(0, this.flashT / 0.045);
      (this.flash.material as THREE.MeshBasicMaterial).opacity = k;
      this.flash.scale.setScalar(0.7 + k * 0.9);
      this.flash.visible = true;
      this.flashLight.intensity = k * 4.2;
    } else {
      this.flash.visible = false;
      this.flashLight.intensity = 0;
    }
  }
}
