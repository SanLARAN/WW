import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GlobeControls } from './controls';
import { Globe, makeStars } from './globe';
import type { World } from '../world/world';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, flash: { value: 0 }, alert: { value: 0 }, aberration: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float flash; uniform float alert; uniform float aberration; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float ab = 0.0012 + aberration * 0.01;
      vec3 col = vec3(texture2D(tDiffuse, vUv + c * ab).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - c * ab).b);
      float vig = smoothstep(0.95, 0.3, length(c * vec2(1.1, 1.0)));
      col *= mix(0.55, 1.0, vig);
      col += (hash(vUv * 900.0 + time) - 0.5) * 0.025;
      col = mix(col, col * vec3(1.15, 0.55, 0.5), alert * (0.5 + 0.5 * sin(time * 4.0)) * (1.0 - vig) * 0.9);
      col = mix(col, vec3(1.0, 0.97, 0.9), clamp(flash, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: GlobeControls;
  readonly globe: Globe;
  private composer: EffectComposer;
  private grade: ShaderPass;
  private stars: THREE.Points;
  private bloom: UnrealBloomPass;
  private frameHooks: ((dt: number, t: number) => void)[] = [];
  private last = performance.now();
  private t = 0;
  alert = 0;

  constructor(canvas: HTMLCanvasElement, world: World, images: { day: HTMLImageElement; night: HTMLImageElement; topo: HTMLImageElement }) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.001, 60);
    this.scene.background = new THREE.Color(0x010204);

    this.globe = new Globe(world, images, null, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.globe.group);
    this.stars = makeStars();
    this.scene.add(this.stars);

    this.controls = new GlobeControls(this.camera, canvas);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.55, 0.78);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    window.addEventListener('resize', () => this.resize());
  }

  onFrame(fn: (dt: number, t: number) => void) { this.frameHooks.push(fn); }

  flash(v: number) {
    this.grade.uniforms.flash.value = Math.max(this.grade.uniforms.flash.value, v);
    this.globe.material.uniforms.flash.value = Math.max(this.globe.material.uniforms.flash.value, v * 0.6);
  }

  shake(v: number) {
    this.controls.shake = Math.max(this.controls.shake, v);
    this.grade.uniforms.aberration.value = Math.max(this.grade.uniforms.aberration.value, v * 0.5);
  }

  /** Graphics quality: pixel ratio + bloom. 'auto' starts high and steps down on sustained low fps. */
  setQuality(q: 'high' | 'medium' | 'low') {
    const dpr = window.devicePixelRatio || 1;
    const pr = q === 'high' ? Math.min(2, dpr) : q === 'medium' ? Math.min(1.25, dpr) : 1;
    this.renderer.setPixelRatio(pr);
    this.bloom.enabled = q !== 'low';
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  start() {
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now; this.t += dt;
      this.controls.update(dt);
      this.globe.update(this.t, this.controls.closeness, this.controls.alt);
      (this.stars.material as THREE.ShaderMaterial).uniforms.time.value = this.t;
      this.stars.position.copy(this.camera.position);
      for (const f of this.frameHooks) f(dt, this.t);
      const g = this.grade.uniforms;
      g.time.value = this.t;
      g.flash.value *= Math.pow(0.02, dt);
      g.aberration.value *= Math.pow(0.05, dt);
      g.alert.value += (this.alert - g.alert.value) * Math.min(1, dt * 2);
      this.composer.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
