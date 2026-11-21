import * as THREE from 'three';

/**
 * Heavy, low overcast — the sky is the light source and the mood.
 * A single inverted sphere with a procedural shader: no HDRI fetch needed and it
 * matches the grey palette exactly on every machine.
 */
export function buildSky(renderer: THREE.WebGLRenderer): { mesh: THREE.Mesh; fog: THREE.FogExp2; env: THREE.Texture; material: THREE.ShaderMaterial } {
  const geo = new THREE.SphereGeometry(900, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x5d646c) },
      uHorizon: { value: new THREE.Color(0xa8adaf) },
      uBottom: { value: new THREE.Color(0x6d6f6b) },
      uSunDir: { value: new THREE.Vector3(-0.35, 0.42, 0.84).normalize() },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom;
      uniform vec3 uSunDir; uniform float uTime;
      varying vec3 vDir;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float s = 0.0, a = 0.5;
        for (int i = 0; i < 6; i++) { s += vnoise(p) * a; p *= 2.03; a *= 0.5; }
        return s;
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        // base gradient: dark slate above, pale washed-out band at the horizon
        vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.62));
        col = mix(col, uBottom, smoothstep(0.0, -0.18, d.y));

        // thick stratocumulus deck, slowly drifting
        vec2 uv = d.xz / max(0.12, d.y + 0.22);
        float cloud = fbm(uv * 1.25 + vec2(uTime * 0.006, uTime * 0.003));
        float detail = fbm(uv * 5.5 - vec2(uTime * 0.012, 0.0));
        float mass = smoothstep(0.34, 0.86, cloud * 0.78 + detail * 0.32);
        // clouds sit on a flat sheet so the horizon stays clean
        mass *= smoothstep(-0.02, 0.22, d.y);

        float lum = mix(0.32, 1.0, smoothstep(0.3, 0.95, cloud));
        vec3 cloudCol = mix(vec3(0.30, 0.33, 0.36), vec3(0.76, 0.78, 0.78), lum);
        col = mix(col, cloudCol, mass * 0.88);

        // diffuse glow where the sun would be, smeared by the overcast
        float sun = max(dot(d, uSunDir), 0.0);
        col += vec3(0.20, 0.18, 0.15) * pow(sun, 6.0) * 0.55;
        col += vec3(0.05, 0.05, 0.055) * pow(sun, 1.4) * 0.4;
        // cool bounce from the ground plane
        col = mix(col, vec3(0.42, 0.42, 0.40), smoothstep(0.05, -0.2, d.y) * 0.5);

        // Keep this linear: the composer's OutputPass applies ACES and sRGB at the
        // very end, so doing gamma here would double-count it and bleach the sky.
        col = col / (col + vec3(0.85));
        gl_FragColor = vec4(col * 1.55, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;

  const fog = new THREE.FogExp2(0x9aa0a2, 0.0072);

  // A tiny procedural environment map keeps metal from looking like flat paint.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 12), mat.clone());
  envScene.add(envSky);
  const env = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
  envScene.clear();

  return { mesh, fog, env, material: mat };
}
