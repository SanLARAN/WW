import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildSky } from './sky';

/**
 * Renderer + post stack.
 *
 * Overcast light: a big soft key from a hemisphere, a weak directional sun for
 * soft shadows, and a procedural environment for metal. Post: SMAA (no MSAA on
 * the composer path), a film-style grade with vignette, grain, chromatic
 * aberration and suppressed-sight desaturation, then ACES output.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly skyMat: THREE.ShaderMaterial;
  private grade: ShaderPass;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private baseFov = 72;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const sky = buildSky(this.renderer);
    this.skyMat = sky.material;
    this.scene.add(sky.mesh);
    this.scene.fog = sky.fog;
    this.scene.environment = sky.env;
    this.scene.environmentIntensity = 0.62;

    this.camera = new THREE.PerspectiveCamera(this.baseFov, innerWidth / innerHeight, 0.12, 1200);

    this.hemi = new THREE.HemisphereLight(0xb9c2c8, 0x4a463c, 1.35);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xcdd4d8, 1.15);
    this.sun.position.set(-70, 110, 120);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 320;
    const c = this.sun.shadow.camera as THREE.OrthographicCamera;
    c.left = -60; c.right = 60; c.top = 60; c.bottom = -60;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.composer.setSize(innerWidth, innerHeight);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new SMAAPass());

    this.grade = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uVignette: { value: 0.55 },
        uDamage: { value: 0 },
        uSuppress: { value: 0 },
        uDesat: { value: 0 },
        uAberration: { value: 0.0012 },
        uResolution: { value: new THREE.Vector2(innerWidth, innerHeight) },
        uFade: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uTime, uVignette, uDamage, uSuppress, uDesat, uAberration, uFade;
        uniform vec2 uResolution;
        varying vec2 vUv;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

        void main() {
          vec2 uv = vUv;
          vec2 d = uv - 0.5;
          float r2 = dot(d, d);
          // lens: a touch of lateral chromatic aberration, stronger at the edges
          float ab = uAberration * (0.35 + r2 * 2.4) * (1.0 + uSuppress * 2.0);
          vec3 col;
          col.r = texture2D(tDiffuse, uv + d * ab).r;
          col.g = texture2D(tDiffuse, uv).g;
          col.b = texture2D(tDiffuse, uv - d * ab).b;

          // grade: cold, slightly crushed shadows, bleached highlights
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          vec3 cold = mix(vec3(l), col, 0.86);
          cold *= vec3(0.97, 1.0, 1.045);
          col = mix(col, cold, 0.75);
          col = mix(col, vec3(l), uDesat + uSuppress * 0.55);

          // suppressed / wounded: a red-brown wash creeping in at the edges
          float edge = smoothstep(0.10, 0.55, r2);
          col = mix(col, col * vec3(1.06, 0.82, 0.78), edge * clamp(uDamage * 1.15, 0.0, 1.0) * 0.85);
          col += vec3(0.20, 0.02, 0.02) * edge * uDamage * 0.55;
          col = mix(col, col * vec3(0.82, 0.86, 0.92), uSuppress * 0.5);

          // vignette
          float vig = smoothstep(0.95, 0.18, length(d) * (1.0 + uVignette * 0.55));
          col *= mix(1.0, vig, 0.85);

          // fine grain, animated — hides banding in the grey sky
          float g = hash(uv * uResolution + fract(uTime) * 91.7) - 0.5;
          col += g * 0.021;

          col = mix(col, vec3(0.0), clamp(uFade, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    (this.grade.uniforms.uResolution.value as THREE.Vector2).set(w, h);
  }

  /** Camera FOV with sprint / ADS handled by the controller, smoothed here. */
  setFov(fov: number) {
    if (Math.abs(this.camera.fov - fov) < 0.01) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** Keep the shadow frustum tight around the action. */
  focusShadows(x: number, z: number) {
    this.sun.position.set(x - 70, 110, z + 120);
    this.sun.target.position.set(x, 0, z);
    this.sun.target.updateMatrixWorld();
  }

  post() {
    return this.grade.uniforms;
  }

  render(elapsed: number) {
    this.skyMat.uniforms.uTime.value = elapsed;
    this.grade.uniforms.uTime.value = elapsed;
    this.composer.render();
  }
}
