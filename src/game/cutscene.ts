import * as THREE from 'three';
import type { Engine } from '../render/engine';
import type { Layout } from '../world/layout';
import type { AudioEngine } from './audio';

/**
 * Opening cutscene: the flight, the hit, the fall, the silence.
 *
 * A scripted camera, a modelled helicopter and a handful of keyframes — no
 * video, no downloads. It can be skipped at any time with a click or Esc.
 *
 * Beats:
 *   0.0 – 6.5   low pass over the treeline, rotor fill, radio chatter (text)
 *   6.5 – 9.0   the hit: a flash, a black plume, the machine lurches
 *   9.0 – 13.5  the fall, the world spins, ground rushes up
 *   13.5– 17.0  black, dust settling, then the first card
 */

export interface CutsceneHandle {
  update: (dt: number) => boolean; // false = finished
  lens: () => { fade: number; damage: number; desat: number };
  skip: () => void;
  dispose: () => void;
}

interface Beat { at: number; text: [string, string]; }

const BEATS: Beat[] = [
  { at: 0.0, text: ['ВЫСОТА 200', 'Борт 24, идём вдоль лесополосы. До точки — четыре минуты.'] },
  { at: 4.2, text: ['БОРТ 24', 'Вижу дым над посёлком. Работала артиллерия, свежая.'] },
  { at: 7.6, text: ['', ''] },
  { at: 10.5, text: ['БОРТ 24', 'Пуск! Пуск справа! Уходим вле—'] },
  { at: 14.2, text: ['', ''] },
  { at: 15.6, text: ['', 'Тишина. Только ветер и звон в ушах.'] },
];

export function playCutscene(engine: Engine, layout: Layout, audio: AudioEngine, onDone: () => void): CutsceneHandle {
  const { scene, camera } = engine;

  const heli = buildHelicopter();
  scene.add(heli.root);

  // dust column, drawn as a stack of soft billboards
  const smoke = makeSmoke();
  scene.add(smoke.root);

  const rotor = audio.rotor();
  let t = 0;
  let done = false;
  let beatIdx = 0;
  const started = performance.now();

  // flight path: a long arc from the north, past the settlement, over the crash site
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-140, 62, -190),
    new THREE.Vector3(-70, 46, -110),
    new THREE.Vector3(-10, 34, -40),
    new THREE.Vector3(24, 26, 16),
    new THREE.Vector3(60, 18, 70),
  ]);

  const hitAt = 7.0;
  const crashAt = 13.4;
  let hit = false;

  const camPos = path.getPointAt(0).clone().add(new THREE.Vector3(-16, 6.5, -12));
  const camTarget = path.getPointAt(0).clone();
  let spin = 0;
  let fade = 0;

  const tick = (dt: number) => {
    t += dt;

    // ---- helicopter motion
    const p = path.getPointAt(Math.min(1, t / 11.5));
    const ahead = path.getPointAt(Math.min(1, (t + 0.6) / 11.5));
    heli.root.position.copy(p);
    heli.root.lookAt(ahead);

    if (t > hitAt) {
      if (!hit) {
        hit = true;
        audio.explosion(6);
        smoke.burst(p.clone());
        heli.damage();
      }
      // lose altitude, yaw out, shake
      const f = Math.min(1, (t - hitAt) / (crashAt - hitAt));
      const fall = f * f * 46;
      heli.root.position.y = p.y - fall;
      heli.root.position.x += Math.sin(f * 9) * 1.6;
      spin += dt * (1.4 + f * 5.5);
      heli.root.rotateZ(-0.16 * f - spin * 0.12 * f);
      heli.root.rotateY(spin * dt * 2.2);
      smoke.follow(heli.root.position, dt, f);
      if (t > crashAt) {
        if (!heli.crashed) {
          heli.crash();
          audio.explosion(3);
          smoke.burst(heli.root.position.clone(), true);
        }
      }
    }

    // ---- camera: a shoulder-mounted chase, then a detached observer
    if (t < hitAt) {
      const back = new THREE.Vector3().copy(p).add(new THREE.Vector3(-16, 6.5, -12));
      const shake = 0.16;
      camPos.lerp(back, 1 - Math.exp(-dt * 3.2));
      camTarget.lerp(p.clone().add(new THREE.Vector3(0, 2, 0)), 1 - Math.exp(-dt * 4));
      camera.position.copy(camPos).add(new THREE.Vector3(
        Math.sin(t * 31) * shake, Math.cos(t * 27) * shake * 0.7, Math.sin(t * 19) * shake,
      ));
      camera.lookAt(camTarget);
      camera.fov = 48;
    } else if (t < crashAt) {
      // the hit knocks the camera loose: hold the fall in a wide handheld frame
      const base = new THREE.Vector3(heli.root.position.x + 22, heli.root.position.y + 4, heli.root.position.z - 26);
      camPos.lerp(base, 1 - Math.exp(-dt * 2.4));
      camTarget.lerp(heli.root.position, 1 - Math.exp(-dt * 5));
      camera.position.copy(camPos);
      camera.lookAt(camTarget);
      camera.rotation.z += Math.sin(t * 13) * 0.02;
      camera.fov = 58;
    } else {
      // inside the fireball: pitch down to the ground, then fade
      const f = Math.min(1, (t - crashAt) / 3.2);
      const ground = new THREE.Vector3(layout.crash.x - 6, 1.7, layout.crash.z - 8);
      camera.position.lerp(ground, 1 - Math.exp(-dt * 1.6));
      camera.lookAt(layout.crash.x, 1.2 + f * 0.4, layout.crash.z);
      camera.rotation.z += Math.sin(t * 4) * 0.01;
      camera.fov = 66;
      fade = Math.max(0, Math.min(1, (t - crashAt - 1.4) / 1.6));
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    smoke.update(dt, t);
    heli.update(dt, t);
    rotor?.set(1 - Math.min(1, Math.max(0, (t - hitAt) / 3)) * 0.7, 4);
    if (rotor && t > crashAt + 1.2) { rotor.stop(); }

    engine.render(t);

    // ---- title cards are DOM; the caller reads this
    while (beatIdx < BEATS.length && BEATS[beatIdx].at <= t) {
      onBeat(beatIdx);
      beatIdx++;
    }

    if (t > crashAt + 3.4) {
      if (!done) finish();
    }
    return !done;
  };

  let beatHandler: (i: number) => void = () => {};
  const onBeat = (i: number) => beatHandler(i);
  const finish = () => {
    if (done) return;
    done = true;
    rotor?.stop();
  };

  return {
    update: tick,
    lens: () => ({ fade, damage: t > hitAt ? 0.5 : 0, desat: t > hitAt ? 0.4 : 0.05 }),
    skip: finish,
    dispose: () => {
      scene.remove(heli.root);
      scene.remove(smoke.root);
      heli.dispose();
      smoke.dispose();
      rotor?.stop();
      void started;
      void onDone;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setBeatHandler: (fn: (i: number) => void) => { beatHandler = fn; },
  } as CutsceneHandle & { setBeatHandler: (fn: (i: number) => void) => void };
}

export { BEATS };

/* ---------------------------------------------------------------- helicopter */

function buildHelicopter() {
  const root = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0x4a5248, roughness: 0.62, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22251f, roughness: 0.7, metalness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x2a3439, roughness: 0.12, metalness: 0.95, transparent: true, opacity: 0.6 });

  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(1.5, 4.4, 8, 16), paint);
  hull.rotation.z = Math.PI / 2;
  hull.castShadow = true;
  root.add(hull);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.3, 16, 12), paint);
  nose.position.set(3.5, 0, 0);
  nose.scale.set(1.3, 0.95, 0.95);
  root.add(nose);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.16, 14, 12), glass);
  canopy.position.set(4.1, 0.12, 0);
  canopy.scale.set(1, 0.72, 0.86);
  root.add(canopy);

  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.4, 6.2, 10), paint);
  boom.rotation.z = Math.PI / 2;
  boom.position.set(-5.4, 0.4, 0);
  root.add(boom);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.8, 0.14), paint);
  fin.position.set(-8.5, 1.0, 0);
  root.add(fin);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.8, 8), dark);
  mast.position.set(0.6, 1.6, 0);
  root.add(mast);

  const mainRotor = new THREE.Group();
  mainRotor.position.set(0.6, 2.1, 0);
  for (let i = 0; i < 5; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.06, 0.4), dark);
    blade.position.x = 4.4;
    const arm = new THREE.Group();
    arm.rotation.y = (i / 5) * Math.PI * 2;
    arm.add(blade);
    mainRotor.add(arm);
  }
  const rotorDisc = new THREE.Mesh(
    new THREE.CircleGeometry(9.4, 32),
    new THREE.MeshBasicMaterial({ color: 0x1a1c1a, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
  );
  rotorDisc.rotation.x = -Math.PI / 2;
  mainRotor.add(rotorDisc);
  root.add(mainRotor);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(-8.6, 1.1, 0.3);
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.5, 0.14), dark);
    blade.rotation.z = (i / 3) * Math.PI * 2;
    tailRotor.add(blade);
  }
  root.add(tailRotor);

  // stub wings with rocket pods
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 3.2), paint);
    wing.position.set(0.2, 0.35, side * 2.2);
    root.add(wing);
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.4, 10), dark);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(0.2, 0.1, side * 3.3);
    root.add(pod);
  }
  // skids
  for (const side of [-1, 1]) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.12, 0.12), dark);
    skid.position.set(0.2, -1.55, side * 1.0);
    root.add(skid);
    for (const fx of [-1.4, 1.4]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.1), dark);
      leg.position.set(fx, -1.05, side * 1.0);
      root.add(leg);
    }
  }

  const fire = new THREE.PointLight(0xff7a33, 0, 30, 2);
  fire.position.set(0.6, 0.6, 0);
  root.add(fire);
  const fireMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff8a3c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  fireMesh.position.set(0.6, 0.5, 0);
  root.add(fireMesh);

  let damaged = false;
  let crashed = false;
  return {
    root,
    damage: () => { damaged = true; },
    crash: () => { crashed = true; },
    get crashed() { return crashed; },
    update: (dt: number, t: number) => {
      if (crashed) {
        const k = 0.55 + Math.sin(t * 18) * 0.25;
        fire.intensity = 22 * k;
        (fireMesh.material as THREE.MeshBasicMaterial).opacity = 0.75 * k;
        fireMesh.scale.setScalar(1.4 + Math.sin(t * 11) * 0.2);
        mainRotor.rotation.y += dt * 0.4;
      } else {
        mainRotor.rotation.y += dt * (damaged ? 16 : 26);
        tailRotor.rotation.y += dt * 40;
        if (damaged) {
          fire.intensity = 4 + Math.sin(t * 22) * 2;
          (fireMesh.material as THREE.MeshBasicMaterial).opacity = 0.35;
        }
      }
    },
    dispose: () => {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
      });
    },
  };
}

/* --------------------------------------------------------------------- smoke */

function makeSmoke() {
  const root = new THREE.Group();
  const tex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 1, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.5, 'rgba(180,180,180,0.35)');
    grd.addColorStop(1, 'rgba(120,120,120,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();

  interface Puff { spr: THREE.Sprite; life: number; max: number; vy: number; vx: number; vz: number; size: number }
  const puffs: Puff[] = [];
  const matFor = (hot: boolean) => new THREE.SpriteMaterial({
    map: tex,
    color: hot ? 0xff9a4a : 0x2a2b28,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: hot ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  const emit = (at: THREE.Vector3, hot = false, big = false) => {
    const spr = new THREE.Sprite(matFor(hot));
    spr.position.copy(at);
    const size = (big ? 7 : 2.2) + Math.random() * (big ? 9 : 2.4);
    spr.scale.setScalar(size);
    root.add(spr);
    puffs.push({
      spr,
      life: 0,
      max: big ? 5.4 : 2.6,
      vy: (big ? 6 : 2.5) + Math.random() * 3,
      vx: (Math.random() - 0.5) * (big ? 9 : 3),
      vz: (Math.random() - 0.5) * (big ? 9 : 3),
      size,
    });
  };

  return {
    root,
    burst: (at: THREE.Vector3, big = false) => {
      for (let i = 0; i < (big ? 40 : 18); i++) emit(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)), i < 6, big);
    },
    follow: (at: THREE.Vector3, _dt: number, intensity: number) => {
      if (Math.random() < intensity * 0.9) emit(at.clone().add(new THREE.Vector3(0, 0.6, 0)), false);
    },
    update: (dt: number, _t: number) => {
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i];
        p.life += dt;
        const k = p.life / p.max;
        if (k >= 1) { root.remove(p.spr); p.spr.material.dispose(); puffs.splice(i, 1); continue; }
        p.spr.position.x += p.vx * dt;
        p.spr.position.y += p.vy * dt;
        p.spr.position.z += p.vz * dt;
        p.vy *= 1 - dt * 0.25;
        p.vx *= 1 - dt * 0.7;
        p.vz *= 1 - dt * 0.7;
        p.spr.scale.setScalar(p.size * (1 + k * 3.2));
        p.spr.material.opacity = 0.55 * (1 - k) ** 1.4;
      }
    },
    dispose: () => {
      for (const p of puffs) { root.remove(p.spr); p.spr.material.dispose(); }
      puffs.length = 0;
      tex.dispose();
    },
  };
}
