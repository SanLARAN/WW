import * as THREE from 'three';
import { W, H } from '../world/worldTypes';
import type { World } from '../world/world';

const surfaceVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const surfaceFrag = /* glsl */ `
precision highp float;
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D topoMap;
uniform sampler2D provMap;
uniform sampler2D palette;
uniform vec2 paletteSize;
uniform vec3 sunDir;
uniform float time;
uniform float politicalMix;
uniform float hoverId;
uniform float selectedId;
uniform float closeness;
uniform float flash;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;

float decodeId(vec2 uv) {
  vec4 c = texture2D(provMap, uv);
  return floor(c.r * 255.0 + 0.5) + floor(c.g * 255.0 + 0.5) * 256.0;
}
vec4 pal(float id, float row) {
  return texture2D(palette, vec2((id - 0.5) / paletteSize.x, (row + 0.5) / paletteSize.y));
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float id = decodeId(uv);
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float sunDot = dot(N, sunDir);
  float day = smoothstep(-0.12, 0.22, sunDot);

  // Relief from heightmap.
  vec2 tx = vec2(1.0 / 2048.0, 1.0 / 1024.0);
  float h0 = texture2D(topoMap, vUv).r;
  float hx = texture2D(topoMap, vUv + vec2(tx.x, 0.0)).r;
  float hy = texture2D(topoMap, vUv + vec2(0.0, tx.y)).r;
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), N) + vec3(1e-5));
  vec3 north = normalize(cross(N, east));
  vec3 Nb = normalize(N - (east * (hx - h0) + north * (hy - h0)) * 9.0);
  float relief = clamp(dot(Nb, sunDir) * 0.5 + 0.5, 0.0, 1.0);

  vec3 sat = texture2D(dayMap, vUv).rgb;
  vec3 lights = texture2D(nightMap, vUv).rgb;
  vec3 col;

  if (id < 0.5) {
    // Ocean
    vec3 deep = mix(vec3(0.015, 0.05, 0.11), sat * 0.75, 0.55);
    vec3 R = reflect(-sunDir, N);
    float spec = pow(max(dot(R, V), 0.0), 60.0) * 0.9;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    col = deep * (0.25 + 0.95 * day) + vec3(1.0, 0.85, 0.6) * spec * day + vec3(0.15, 0.3, 0.5) * fres * 0.45;
    col += vec3(0.04, 0.09, 0.16) * (1.0 - day) * 0.5;
  } else {
    vec4 owner = pal(id, 0.0);
    vec4 ctrl = pal(id, 1.0);
    vec4 fx = pal(id, 2.0);
    vec3 base = sat * (0.55 + 0.65 * relief);
    vec3 polCol = ctrl.rgb;
    // Occupation hatching.
    if (abs(ctrl.a - owner.a) > 0.001) {
      float s = step(0.5, fract((uv.x * 4096.0 + uv.y * 2048.0) * 0.12 * (0.4 + closeness)));
      polCol = mix(owner.rgb, ctrl.rgb, 0.35 + 0.65 * s);
    }
    float pm = politicalMix * fx.a;
    vec3 tinted = mix(base, polCol * (0.55 + 0.6 * relief), pm);
    col = tinted * (0.16 + 0.95 * day) + polCol * pm * (1.0 - day) * 0.28;

    // Borders (screen-space constant width).
    vec2 d = fwidth(uv) * 1.1;
    float l = decodeId(uv - vec2(d.x, 0.0)), r = decodeId(uv + vec2(d.x, 0.0));
    float u = decodeId(uv - vec2(0.0, d.y)), b = decodeId(uv + vec2(0.0, d.y));
    bool provEdge = l != id || r != id || u != id || b != id;
    float cId = ctrl.a;
    bool ctryEdge = false;
    if (provEdge) {
      ctryEdge = (l < 0.5 || abs(pal(l, 1.0).a - cId) > 0.001) || (r < 0.5 || abs(pal(r, 1.0).a - cId) > 0.001) ||
                 (u < 0.5 || abs(pal(u, 1.0).a - cId) > 0.001) || (b < 0.5 || abs(pal(b, 1.0).a - cId) > 0.001);
      bool coastOnly = (l < 0.5 || r < 0.5 || u < 0.5 || b < 0.5);
      float provA = smoothstep(0.15, 0.85, closeness) * 0.35 * pm;
      if (ctryEdge) {
        vec3 bc = coastOnly ? vec3(0.9, 0.95, 1.0) * 0.35 : vec3(0.02, 0.02, 0.03);
        col = mix(col, bc, coastOnly ? 0.35 : 0.85 * max(pm, 0.4));
      } else col = mix(col, vec3(0.0), provA);
    }

    // Night city lights.
    col += lights * vec3(1.0, 0.78, 0.45) * (1.0 - day) * 1.35;

    // Highlights from palette row 2: r = hover/select glow, g = player outline, b = pulse (war zone).
    float pulse = 0.5 + 0.5 * sin(time * 3.0);
    col += polCol * fx.r * 0.35;
    if (id == hoverId) col += vec3(0.12, 0.11, 0.08);
    if (id == selectedId) col += vec3(0.25, 0.2, 0.1) * (0.6 + 0.4 * pulse);
    if (ctryEdge && fx.g > 0.5) col = mix(col, vec3(1.0, 0.72, 0.25), 0.6 + 0.3 * pulse);
    col = mix(col, vec3(1.0, 0.15, 0.05), fx.b * 0.25 * pulse);
  }

  // Atmospheric rim scattering on the surface.
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += vec3(0.25, 0.5, 1.0) * rim * 0.35 * day;
  col += vec3(1.0, 0.95, 0.85) * flash;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const atmoVert = /* glsl */ `
varying vec3 vN; varying vec3 vP;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const atmoFrag = /* glsl */ `
uniform vec3 sunDir;
varying vec3 vN; varying vec3 vP;
void main() {
  vec3 rd = normalize(vP - cameraPosition);
  float t = -dot(cameraPosition, rd);
  vec3 cp = cameraPosition + rd * max(t, 0.0);
  float b = length(cp);
  float h = clamp((b - 1.0) / 0.035, 0.0, 1.0);
  float dens = pow(1.0 - h, 2.4) * step(1.0, b + 0.0005);
  float s = dot(normalize(cp), sunDir);
  vec3 dayC = vec3(0.32, 0.62, 1.0), sunset = vec3(1.0, 0.5, 0.25);
  vec3 c = mix(dayC, sunset, smoothstep(0.3, 0.0, abs(s)) * 0.8);
  float lit = smoothstep(-0.3, 0.25, s);
  gl_FragColor = vec4(c * dens * (0.08 + 1.4 * lit), 1.0);
}`;

const cloudFrag = /* glsl */ `
uniform sampler2D map; uniform vec3 sunDir; uniform float opacity;
varying vec2 vUv; varying vec3 vNormalW; varying vec3 vPosW;
void main() {
  vec4 ct = texture2D(map, vUv);
  float a = ct.a * dot(ct.rgb, vec3(0.333));
  float l = smoothstep(-0.15, 0.4, dot(normalize(vNormalW), sunDir));
  gl_FragColor = vec4(vec3(0.78) * (0.04 + 0.9 * l), a * opacity * (0.2 + 0.8 * l));
}`;

export class Globe {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  readonly palette: THREE.DataTexture;
  readonly paletteData: Uint8Array;
  private clouds: THREE.Mesh;
  private atmo: THREE.ShaderMaterial;
  readonly sunDir = new THREE.Vector3(1, 0.2, 0.3).normalize();
  readonly count: number;

  constructor(world: World, images: { day: HTMLImageElement; night: HTMLImageElement; topo: HTMLImageElement }, cloudsImg: HTMLImageElement | null, maxAniso: number) {
    const tex = (img: HTMLImageElement, srgb = true) => {
      const t = new THREE.Texture(img);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = maxAniso;
      t.wrapS = THREE.RepeatWrapping;
      t.needsUpdate = true;
      return t;
    };
    const rgba = new Uint8Array(W * H * 4);
    for (let i = 0; i < world.prov.length; i++) { const v = world.prov[i]; rgba[i * 4] = v & 255; rgba[i * 4 + 1] = v >> 8; }
    const provTex = new THREE.DataTexture(rgba, W, H, THREE.RGBAFormat);
    provTex.magFilter = provTex.minFilter = THREE.NearestFilter;
    provTex.generateMipmaps = false;
    provTex.needsUpdate = true;

    this.count = world.provinces.length;
    this.paletteData = new Uint8Array(this.count * 3 * 4);
    this.palette = new THREE.DataTexture(this.paletteData, this.count, 3, THREE.RGBAFormat);
    this.palette.magFilter = this.palette.minFilter = THREE.NearestFilter;
    this.palette.colorSpace = THREE.NoColorSpace;

    this.material = new THREE.ShaderMaterial({
      vertexShader: surfaceVert,
      fragmentShader: surfaceFrag,
      uniforms: {
        dayMap: { value: tex(images.day) }, nightMap: { value: tex(images.night) }, topoMap: { value: tex(images.topo, false) },
        provMap: { value: provTex }, palette: { value: this.palette }, paletteSize: { value: new THREE.Vector2(this.count, 3) },
        sunDir: { value: this.sunDir }, time: { value: 0 }, politicalMix: { value: 0.62 }, hoverId: { value: -1 },
        selectedId: { value: -1 }, closeness: { value: 0 }, flash: { value: 0 },
      },
    });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), this.material);
    earth.name = 'earth';
    this.group.add(earth);

    this.atmo = new THREE.ShaderMaterial({
      vertexShader: atmoVert, fragmentShader: atmoFrag, uniforms: { sunDir: { value: this.sunDir } },
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.group.add(new THREE.Mesh(new THREE.SphereGeometry(1.035, 96, 48), this.atmo));

    const cloudMat = new THREE.ShaderMaterial({
      vertexShader: surfaceVert, fragmentShader: cloudFrag, transparent: true, depthWrite: false,
      uniforms: { map: { value: cloudsImg ? tex(cloudsImg, false) : null }, sunDir: { value: this.sunDir }, opacity: { value: cloudsImg ? 0.75 : 0 } },
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.006, 128, 64), cloudMat);
    this.clouds.renderOrder = 2;
    this.group.add(this.clouds);
  }

  setClouds(img: HTMLImageElement, maxAniso: number) {
    const t = new THREE.Texture(img);
    t.anisotropy = maxAniso; t.needsUpdate = true;
    const m = this.clouds.material as THREE.ShaderMaterial;
    m.uniforms.map.value = t; m.uniforms.opacity.value = 0.5;
  }

  /** row 0: owner rgb + owner idx; row 1: controller rgb + controller idx; row 2: fx (glow, outline, pulse, politicalMix). */
  setProvince(i: number, owner: [number, number, number], ownerIdx: number, ctrl: [number, number, number], ctrlIdx: number, fx: [number, number, number, number]) {
    const d = this.paletteData, n = this.count;
    d.set([owner[0], owner[1], owner[2], ownerIdx], i * 4);
    d.set([ctrl[0], ctrl[1], ctrl[2], ctrlIdx], (n + i) * 4);
    d.set(fx, (2 * n + i) * 4);
  }

  commitPalette() { this.palette.needsUpdate = true; }

  update(time: number, closeness: number, cameraAlt: number) {
    const u = this.material.uniforms;
    u.time.value = time; u.closeness.value = closeness;
    u.flash.value *= 0.9;
    this.clouds.rotation.y = time * 0.002;
    const cm = this.clouds.material as THREE.ShaderMaterial;
    if (cm.uniforms.map.value) cm.uniforms.opacity.value = Math.min(0.55, Math.max(0, (cameraAlt - 0.15) * 0.8));
  }

  /** Real subsolar point for a given UTC date. */
  setSun(date: Date) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    const doy = (date.getTime() - start) / 86400000;
    const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10));
    const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
    const lon = (12 - hours) * 15;
    const la = (decl * Math.PI) / 180, lo = (lon * Math.PI) / 180;
    this.sunDir.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)).normalize();
  }
}

export function makeStars(): THREE.Points {
  const n = 9000;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  const rnd = (s: number) => { const x = Math.sin(s * 127.1) * 43758.5453; return x - Math.floor(x); };
  for (let i = 0; i < n; i++) {
    // Concentrate a portion along a galactic band.
    const band = i % 3 === 0;
    const u = rnd(i + 1) * 2 - 1, th = rnd(i + 7) * Math.PI * 2;
    let y = band ? (rnd(i + 3) - 0.5) * 0.25 : u;
    const r = Math.sqrt(1 - y * y);
    let x = r * Math.cos(th), z = r * Math.sin(th);
    const tilt = 1.05; const yy = y * Math.cos(tilt) - z * Math.sin(tilt); z = y * Math.sin(tilt) + z * Math.cos(tilt); y = yy;
    pos.set([x * 40, y * 40, z * 40], i * 3);
    const t = rnd(i + 11);
    const c = t < 0.15 ? [1, 0.8, 0.6] : t < 0.3 ? [0.7, 0.8, 1] : [1, 1, 1];
    const b = 0.35 + rnd(i + 5) ** 3 * 0.9;
    col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
    size[i] = 0.6 + rnd(i + 9) ** 4 * 2.6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, pr: { value: Math.min(2, window.devicePixelRatio) } },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float time; uniform float pr;
      void main(){ vC = color * (0.75 + 0.25 * sin(time * 1.5 + position.x * 3.0 + position.z)); vec4 mv = modelViewMatrix * vec4(position,1.0);
      gl_PointSize = size * pr; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vC * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}
