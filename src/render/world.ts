import * as THREE from 'three';
import type { Block, Layout, Tree } from '../world/layout';
import { HALF } from '../world/layout';
import type { Surfaces } from './textures';
import { rng } from '../world/layout';

/** Adds a mesh with the shared world transform and shadow flags. */
function put<T extends THREE.Object3D>(parent: THREE.Object3D, mesh: T, cast = true, receive = true): T {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}

function box(w: number, h: number, d: number, mat: THREE.Material) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

/* ---------------------------------------------------------------- buildings */

function khrushchyovka(b: Block, s: Surfaces, r: () => number): THREE.Group {
  const g = new THREE.Group();
  const { hx, hz, h } = b;
  // main slab
  const body = put(g, box(hx * 2, h, hz * 2, s.panel));
  body.position.y = h / 2;

  // floors: a thin lighter cornice band per storey breaks up the flat face
  const floors = Math.max(3, Math.round(h / 2.8));
  for (let f = 1; f < floors; f++) {
    const band = put(g, box(hx * 2 + 0.12, 0.16, hz * 2 + 0.12, s.concrete), false, true);
    band.position.y = (h / floors) * f;
  }
  const roof = put(g, box(hx * 2 + 0.5, 0.35, hz * 2 + 0.5, s.concrete));
  roof.position.y = h + 0.1;

  // windows: dark glass with a few blown-out frames
  const winMat = new THREE.MeshStandardMaterial({ color: 0x1b1f21, roughness: 0.28, metalness: 0.4 });
  const winGeo = new THREE.PlaneGeometry(1.25, 1.55);
  const cols = Math.max(2, Math.floor(hx / 2.4));
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      for (const side of [1, -1]) {
        if (r() < 0.18) continue;
        const w = new THREE.Mesh(winGeo, winMat);
        w.position.set(-hx + 1.6 + c * 2.5, ((h / floors) * (f + 0.55)), side * (hz + 0.01));
        if (side < 0) w.rotation.y = Math.PI;
        g.add(w);
      }
      for (const side of [1, -1]) {
        if (r() < 0.3) continue;
        const w = new THREE.Mesh(winGeo, winMat);
        w.rotation.y = side * Math.PI * 0.5;
        w.position.set(side * (hx + 0.01), ((h / floors) * (f + 0.55)), -hz + 1.6 + c * 2.5);
        g.add(w);
      }
    }
  }
  // an entrance canopy and a stairwell block
  const canopy = put(g, box(3.2, 0.18, 1.6, s.concrete));
  canopy.position.set(r() * hx * 0.8 - hx * 0.4, 2.6, hz + 0.7);
  const stair = put(g, box(2.6, h + 0.6, 2.2, s.concrete));
  stair.position.set(hx - 1.4, (h + 0.6) / 2, 0);
  // shell damage: one corner blown open
  if (r() < 0.7) {
    const hole = put(g, box(2.4, 2.0, 1.2, new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 1 })), false, false);
    hole.position.set(-hx + 2 + r() * (hx * 2 - 4), h - 2.6, hz + 0.05);
  }
  return g;
}

function shed(b: Block, s: Surfaces, r: () => number): THREE.Group {
  const g = new THREE.Group();
  const body = put(g, box(b.hx * 2, b.h, b.hz * 2, r() > 0.5 ? s.brick : s.metal));
  body.position.y = b.h / 2;
  const roof = put(g, box(b.hx * 2.3, 0.16, b.hz * 2.3, s.metal));
  roof.position.y = b.h + 0.05;
  roof.rotation.z = (r() - 0.5) * 0.06;
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.9), new THREE.MeshStandardMaterial({ color: 0x24211d, roughness: 0.9 }));
  door.position.set(0, 0.95, b.hz + 0.02);
  g.add(door);
  return g;
}

function container(b: Block, r: () => number): THREE.Group {
  const g = new THREE.Group();
  const mats = [
    new THREE.MeshStandardMaterial({ color: 0x4d5a44, roughness: 0.72, metalness: 0.45 }),
    new THREE.MeshStandardMaterial({ color: 0x6b3a2c, roughness: 0.76, metalness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: 0x3d4a55, roughness: 0.7, metalness: 0.45 }),
  ];
  const body = put(g, box(b.hx * 2, b.h, b.hz * 2, mats[Math.floor(r() * mats.length)]));
  body.position.y = b.h / 2;
  // corrugation: thin ribs along the long side
  const ribMat = new THREE.MeshStandardMaterial({ color: 0x2a2f28, roughness: 0.85, metalness: 0.3 });
  for (let i = -Math.floor(b.hx); i <= Math.floor(b.hx); i += 0.7) {
    const rib = put(g, box(0.09, b.h * 0.94, 0.06, ribMat), false, false);
    rib.position.set(i, b.h / 2, b.hz + 0.03);
  }
  return g;
}

function wreck(b: Block, r: () => number): THREE.Group {
  const g = new THREE.Group();
  const burnt = new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 0.94, metalness: 0.5 });
  const hull = put(g, box(b.hx * 2, 0.9, b.hz * 2, burnt));
  hull.position.y = 0.55;
  const cab = put(g, box(b.hx * 0.9, 0.9, b.hz * 1.1, burnt));
  cab.position.set(0.2, 1.35, 0.1);
  cab.rotation.z = 0.06;
  for (let i = 0; i < 4; i++) {
    const wheel = put(g, new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), burnt));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set((i < 2 ? -1 : 1) * b.hx * 0.6, 0.42, (i % 2 ? -1 : 1) * b.hz * 0.8);
  }
  void r;
  return g;
}

function sandbagWall(b: Block, s: Surfaces, r: () => number): THREE.Group {
  const g = new THREE.Group();
  const bagGeo = new THREE.SphereGeometry(0.42, 8, 6);
  const count = Math.max(3, Math.round(b.hx * 2 / 0.78));
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(bagGeo, s.sandbag);
      m.scale.set(1.0, 0.55, 0.7);
      const off = (i - count / 2) * 0.78 + (row % 2 ? 0.34 : 0);
      m.position.set(off, 0.22 + row * 0.36, (r() - 0.5) * 0.08);
      m.rotation.y = (r() - 0.5) * 0.5;
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
  }
  return g;
}

function trench(b: Block, s: Surfaces): THREE.Group {
  const g = new THREE.Group();
  const mat = s.dirt.clone();
  mat.color = new THREE.Color(0x4a423a);
  const inner = put(g, box(b.hx * 2, b.h, b.hz * 2, mat), false, true);
  inner.position.y = -b.h * 0.45;
  const lip = put(g, box(b.hx * 2 + 0.6, 0.18, b.hz * 2 + 0.6, s.dirt), false, true);
  lip.position.y = 0.08;
  return g;
}

function bunker(b: Block, s: Surfaces): THREE.Group {
  const g = new THREE.Group();
  const body = put(g, box(b.hx * 2, b.h, b.hz * 2, s.concrete));
  body.position.y = b.h / 2;
  const roof = put(g, box(b.hx * 2 + 1.2, 0.5, b.hz * 2 + 1.2, s.concrete));
  roof.position.y = b.h + 0.25;
  // embrasure: a dark slot facing the field
  const slot = put(g, box(2.2, 0.35, 0.1, new THREE.MeshStandardMaterial({ color: 0x0b0c0c, roughness: 1 })), false, false);
  slot.position.set(0, 1.45, -b.hz - 0.06);
  const door = put(g, box(1.1, 2.0, 0.1, new THREE.MeshStandardMaterial({ color: 0x1b1a17, roughness: 0.95 })), false, false);
  door.position.set(b.hx + 0.06, 1.0, 0);
  return g;
}

/* --------------------------------------------------------------------- trees */

function buildTrees(layout: Layout, s: Surfaces): THREE.Group {
  const g = new THREE.Group();
  const r = rng(layout.seed ^ 0x5a5a);

  const pineTrunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.24, 1, 7), s.bark, layout.trees.length);
  const birchTrunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.2, 1, 7), s.bark, layout.trees.length);
  const canopy = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), s.leaves, layout.trees.length * 3);
  pineTrunk.castShadow = birchTrunk.castShadow = canopy.castShadow = true;
  pineTrunk.receiveShadow = birchTrunk.receiveShadow = canopy.receiveShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pos = new THREE.Vector3();
  let pi = 0, bi = 0, ci = 0;

  const addTree = (t: Tree) => {
    const pine = t.kind === 'pine';
    const trunkH = pine ? t.h * 0.55 : t.h * 0.62;
    pos.set(t.x, trunkH / 2, t.z);
    sc.set(1, trunkH, 1);
    q.setFromEuler(new THREE.Euler(0, r() * 6.28, 0));
    m.compose(pos, q, sc);
    if (pine) pineTrunk.setMatrixAt(pi++, m);
    else birchTrunk.setMatrixAt(bi++, m);

    if (pine) {
      // stacked cones read as a spruce silhouette from a distance
      for (let k = 0; k < 3; k++) {
        const size = (t.h * 0.30) * (1 - k * 0.22);
        pos.set(t.x, trunkH * 0.55 + k * t.h * 0.2 + size * 0.4, t.z);
        sc.set(size * 0.9, size * 1.5, size * 0.9);
        q.setFromEuler(new THREE.Euler(0, r() * 6.28, 0));
        m.compose(pos, q, sc);
        canopy.setMatrixAt(ci++, m);
      }
    } else {
      for (let k = 0; k < 3; k++) {
        const size = t.h * (0.30 - k * 0.05);
        pos.set(t.x + (r() - 0.5) * 1.6, trunkH + k * t.h * 0.14, t.z + (r() - 0.5) * 1.6);
        sc.set(size, size * 1.15, size);
        q.setFromEuler(new THREE.Euler(r(), r() * 6.28, r()));
        m.compose(pos, q, sc);
        canopy.setMatrixAt(ci++, m);
      }
    }
  };
  layout.trees.forEach(addTree);
  pineTrunk.count = pi;
  birchTrunk.count = bi;
  canopy.count = ci;
  g.add(pineTrunk, birchTrunk, canopy);
  return g;
}

/* ------------------------------------------------------------------ terrain */

function buildGround(layout: Layout, s: Surfaces): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, 96, 96);
  geo.rotateX(-Math.PI / 2);
  // gentle undulation so the field isn't a perfect billiard table
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const r = rng(layout.seed ^ 0x1234);
  const bumps: Array<[number, number, number, number]> = [];
  for (let i = 0; i < 26; i++) bumps.push([(r() - 0.5) * 200, (r() - 0.5) * 200, 8 + r() * 22, (r() - 0.5) * 0.5]);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let y = Math.sin(x * 0.03) * Math.cos(z * 0.027) * 0.22;
    for (const [bx, bz, br, bh] of bumps) {
      const d = Math.hypot(x - bx, z - bz);
      if (d < br) y += Math.cos((d / br) * Math.PI * 0.5) ** 2 * bh;
    }
    // flatten the crash clearing
    const clear = Math.hypot(x, z);
    if (clear < 22) y *= Math.max(0, (clear - 8) / 14);
    pos.setY(i, y);
  }
  geo.computeVertexNormals();
  const ground = put(g, new THREE.Mesh(geo, s.ground), false, true);
  ground.position.y = 0;
  return g;
}

/* ------------------------------------------------------------ the crash site */

/** Burnt Mi-8 hull: the centrepiece of the opening shot. */
export function buildCrashSite(layout: Layout): THREE.Group {
  const g = new THREE.Group();
  const char = new THREE.MeshStandardMaterial({ color: 0x2e3128, roughness: 0.72, metalness: 0.55 });
  const burnt = new THREE.MeshStandardMaterial({ color: 0x1b1a17, roughness: 0.9, metalness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x2b3134, roughness: 0.18, metalness: 0.9, transparent: true, opacity: 0.55 });

  const body = new THREE.Group();
  body.rotation.z = 0.16;
  body.rotation.x = -0.05;

  const hull = put(body, new THREE.Mesh(new THREE.CapsuleGeometry(1.55, 4.2, 6, 14), char));
  hull.rotation.z = Math.PI / 2;
  hull.position.y = 1.9;
  // cockpit
  const nose = put(body, new THREE.Mesh(new THREE.SphereGeometry(1.35, 16, 12), char));
  nose.position.set(3.4, 1.95, 0);
  nose.scale.set(1.25, 0.95, 0.95);
  const canopy = put(body, new THREE.Mesh(new THREE.SphereGeometry(1.2, 14, 10), glass), false, false);
  canopy.position.set(4.0, 2.05, 0);
  canopy.scale.set(0.95, 0.75, 0.85);
  // tail boom, snapped
  const boom = put(body, new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 6.4, 10), char));
  boom.rotation.z = Math.PI / 2 - 0.22;
  boom.position.set(-5.4, 2.35, 0.4);
  const fin = put(body, box(1.1, 1.7, 0.16, char));
  fin.position.set(-8.4, 3.0, 0.4);
  fin.rotation.z = 0.3;
  // rotor mast + two bent blades
  const mast = put(body, new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.9, 8), burnt));
  mast.position.set(0.6, 3.45, 0);
  for (const a of [0.4, 2.4]) {
    const blade = put(body, box(8.2, 0.1, 0.42, burnt));
    blade.position.set(0.6 + Math.cos(a) * 3.6, 3.35 - Math.sin(a) * 0.5, Math.sin(a) * 3.6);
    blade.rotation.y = a;
    blade.rotation.z = Math.sin(a) * 0.25;
  }
  // stub wings + rocket pods
  for (const side of [-1, 1]) {
    const wing = put(body, box(0.7, 0.2, 3.4, char));
    wing.position.set(0.2, 2.2, side * 2.3);
    const pod = put(body, new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.5, 10), burnt));
    pod.rotation.x = Math.PI / 2;
    pod.position.set(0.2, 1.95, side * 3.4);
  }
  // skids, one snapped
  const skidA = put(body, box(4.2, 0.14, 0.14, burnt));
  skidA.position.set(0.2, 0.1, 1.1);
  const skidB = put(body, box(2.6, 0.14, 0.14, burnt));
  skidB.position.set(-1.2, 0.1, -1.1);
  skidB.rotation.y = 0.2;

  g.add(body);
  g.position.set(layout.crash.x, 0, layout.crash.z);
  g.rotation.y = layout.crash.rot;

  // scorched earth + scattered debris
  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(7.5, 24),
    new THREE.MeshStandardMaterial({ color: 0x181613, roughness: 1, transparent: true, opacity: 0.82, depthWrite: false }),
  );
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.y = 0.02;
  g.add(scorch);

  const r = rng(9182);
  const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.12, 0.7), burnt, 60);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  for (let i = 0; i < 60; i++) {
    const a = r() * Math.PI * 2, d = 2 + r() * 11;
    p.set(Math.cos(a) * d, 0.06 + r() * 0.1, Math.sin(a) * d);
    q.setFromEuler(new THREE.Euler(r() * 0.4, r() * 6.28, r() * 0.4));
    sc.setScalar(0.4 + r() * 1.5);
    m.compose(p, q, sc);
    debris.setMatrixAt(i, m);
  }
  debris.castShadow = true;
  debris.receiveShadow = true;
  g.add(debris);
  return g;
}

/* ---------------------------------------------------------------- assembling */

export interface WorldBuild {
  root: THREE.Group;
  ground: THREE.Mesh;
}

export function buildWorld(layout: Layout, s: Surfaces): WorldBuild {
  const root = new THREE.Group();
  const r = rng(layout.seed);
  const groundGroup = buildGround(layout, s);
  root.add(groundGroup);

  for (const b of layout.blocks) {
    let node: THREE.Group | null = null;
    switch (b.kind) {
      case 'house': node = khrushchyovka(b, s, r); break;
      case 'shed': node = shed(b, s, r); break;
      case 'container': node = container(b, r); break;
      case 'wreck': node = wreck(b, r); break;
      case 'sandbag': node = sandbagWall(b, s, r); break;
      case 'trench': node = trench(b, s); break;
      case 'bunker': node = bunker(b, s); break;
      case 'wall':
        node = new THREE.Group();
        {
          const w = put(node, box(b.hx * 2, b.h, b.hz * 2, s.concrete));
          w.position.y = b.h / 2;
        }
        break;
    }
    if (!node) continue;
    node.position.set(b.x, 0, b.z);
    node.rotation.y = b.rot;
    root.add(node);
  }

  root.add(buildTrees(layout, s));
  root.add(buildCrashSite(layout));

  // grass tufts near the player, as crossed alpha-free quads of dark green
  const tuftGeo = new THREE.PlaneGeometry(1, 0.55);
  tuftGeo.translate(0, 0.27, 0);
  const tuftMat = new THREE.MeshStandardMaterial({ color: 0x59552f, roughness: 0.95, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, 5000);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  for (let i = 0; i < 5000; i++) {
    const a = r() * Math.PI * 2, d = 3 + Math.sqrt(r()) * 70;
    p.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    q.setFromEuler(new THREE.Euler(0, r() * 6.28, 0));
    sc.set(0.5 + r() * 0.8, 0.5 + r() * 1.4, 1);
    m4.compose(p, q, sc);
    tufts.setMatrixAt(i, m4);
  }
  tufts.receiveShadow = true;
  root.add(tufts);

  return { root, ground: groundGroup.children[0] as THREE.Mesh };
}
