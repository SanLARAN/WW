import * as THREE from 'three';
import { loadImage, loadWorld, TEXTURES, type World } from '../world/world';
import { Engine } from '../render/engine';
import { UnitLayer } from '../render/units';
import { FxLayer } from '../render/fx';
import { CircleLayer, LabelLayer, PathLayer } from '../render/overlays';
import { audio } from '../audio/audio';
import type { Sim, Fx } from '../game/sim';
import type { Command } from '../game/commands';
import type { CountryState, GameState, LL, LogEntry, MissileType, Unit } from '../game/types';
import { UNIT } from '../data/military';
import { Terrain } from '../world/worldTypes';
import { RESOURCE_INFO, type ResourceKey } from '../data/resources';
import { toXYZ } from '../core/geo';
import { cities } from '../data/cities';
import { countryDefs } from '../data/countries';
import type { Session } from '../net/session';
import { SoloSession as Solo } from '../net/session';
import { createSim } from '../game/game';
import { newCampaign, tickCampaign, verdict, type CampaignState } from '../game/campaign';
import { writeSave, readSave, latestSave, readMeta, SLOTS as SLOTS_ALL, type SaveMeta } from '../game/save';

export type MapMode = 'political' | 'terrain' | 'diplomacy' | 'economy' | 'military' | 'airdefense' | 'resources' | 'trade' | 'threat';
export type Panel = null | 'campaign' | 'trade' | 'overview' | 'economy' | 'production' | 'research' | 'focus' | 'diplomacy' | 'army' | 'missiles' | 'politics' | 'ops' | 'log' | 'settings';

export interface Toast { id: number; text: string; kind: LogEntry['kind'] | 'error' | 'ok'; t: number }

const hexToRgb = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const TERRAIN_COLOR: Record<Terrain, string> = {
  [Terrain.Plains]: '#93b25c', [Terrain.Forest]: '#2f6b35', [Terrain.Hills]: '#b39a5e', [Terrain.Mountains]: '#8b7b6b', [Terrain.Desert]: '#e3c37f', [Terrain.Arctic]: '#e9f1f8',
};

/** Glue between simulation, rendering, audio, network and UI. */
export class Controller {
  world!: World;
  engine!: Engine;
  units = new UnitLayer();
  fx = new FxLayer();
  labels = new LabelLayer();
  paths = new PathLayer();
  circles = new CircleLayer();
  sim: Sim | null = null;
  session: Session | null = null;
  me: string | null = null;
  playerId = sessionStorage.getItem('ww.pid') ?? Math.random().toString(36).slice(2, 10);
  playerName = localStorage.getItem('ww.name') ?? 'Командир';

  // UI state
  screen: 'loading' | 'menu' | 'select' | 'lobby' | 'game' = 'loading';
  loading = { msg: 'Инициализация', p: 0 };
  panel: Panel = null;
  mapMode: MapMode = 'political';
  selectedUnits = new Set<number>();
  selectedProvince = -1;
  inspectCountry: string | null = null;
  hoverProvince = -1;
  hoverPos: { x: number; y: number } | null = null;
  targeting: { missile: MissileType; count: number } | null = null;
  /** Campaign state (objectives/score) — present only in campaign mode. */
  campaign: CampaignState | null = null;
  /** Set when the run is over: the UI shows the ending screen. */
  ending: { title: string; text: string; score: number; won: boolean } | null = null;
  saves: SaveMeta[] = [];
  private saveTimer = 0;
  /** Alt-click strike mode: no missile choice, the sim spawns what is available. */
  strikeMode = false;
  /** Live hover preview for the bottom status readout. */
  hoverUnits: { mine: number; enemy: number } = { mine: 0, enemy: 0 };
  hoverTerrain = '';
  targetWarn: string | null = null;
  box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  toasts: Toast[] = [];
  private toastId = 1;
  private listeners = new Set<() => void>();
  private colors = new Map<string, THREE.Color>();
  private paletteDirty = true;
  private paletteTimer = 0;
  private circleTimer = 0;
  private labelTimer = 0;
  private uiTimer = 0;
  private lastLog = 0;
  private sirenUntil = 0;
  quality: 'auto' | 'high' | 'medium' | 'low' = 'auto';
  private qLevel = 0; // 0 high, 1 medium, 2 low
  private fpsE = 60;
  private qTimer = 0;

  subscribe(f: () => void) { this.listeners.add(f); return () => this.listeners.delete(f); }
  bump() { for (const f of this.listeners) f(); }

  get state(): GameState | null { return this.sim?.s ?? null; }
  get country(): CountryState | null { return this.me && this.sim ? this.sim.s.countries[this.me] ?? null : null; }

  async init(canvas: HTMLCanvasElement) {
    sessionStorage.setItem('ww.pid', this.playerId);
    const { world, images } = await loadWorld((msg, p) => { this.loading = { msg, p }; this.bump(); });
    this.world = world;
    this.engine = new Engine(canvas, world, images);
    this.quality = (localStorage.getItem('ww.quality') || 'auto') as 'auto' | 'high' | 'medium' | 'low';
    if (this.quality !== 'auto') this.qLevel = { high: 0, medium: 1, low: 2 }[this.quality];
    this.engine.setQuality(this.quality === 'auto' ? 'high' : this.quality);
    this.engine.scene.add(this.fx.group, this.units.mesh, this.labels.group, this.paths.group, this.circles.group);
    this.engine.globe.setSun(new Date(Date.UTC(2020, 0, 1, 9)));
    this.setupInput(canvas);
    this.fx.sound = (kind, at, power) => {
      const dist = at.distanceTo(this.engine.camera.position);
      if (kind === 'launch') audio.launch(power, dist, power > 2);
      else if (kind === 'boom') { audio.boom(power, dist); if (dist < 0.5) this.engine.shake(power * (0.6 - dist)); }
      else if (kind === 'nuke') audio.nuke(dist);
      else if (kind === 'intercept') audio.intercept(dist);
      else if (kind === 'shot') audio.shot(power, dist);
    };
    this.fx.onNuke = (p) => {
      const d = p.distanceTo(this.engine.camera.position);
      this.engine.flash(Math.max(0.35, 1 - d * 0.4));
      this.engine.shake(3);
    };
    this.engine.onFrame((dt, t) => this.frame(dt, t));
    // Background tabs get no animation frames: keep the authoritative simulation and network alive.
    let lastBg = performance.now();
    window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(1, (now - lastBg) / 1000);
      lastBg = now;
      if (!document.hidden || !this.sim || !this.session) return;
      this.session.update(dt);
      this.consumeFx(this.sim.fx.splice(0));
    }, 250);
    this.engine.controls.alt = 2.6;
    this.engine.start();
    this.paintPolitical(null);
    this.screen = 'menu';
    this.bump();
    loadImage(TEXTURES.clouds).then((img) => this.engine.globe.setClouds(img, 8)).catch(() => undefined);
  }

  // ------------------------------------------------------------------------------------------ game lifecycle
  attach(sim: Sim, session: Session, me: string | null, campaign: CampaignState | null = null) {
    this.sim = sim;
    this.session = session;
    this.me = me;
    this.campaign = campaign ?? (me && sim.s.settings.mode === 'campaign' ? newCampaign(sim, me) : null);
    this.ending = null;
    this.saveTimer = 45;
    this.screen = 'game';
    this.selectedUnits.clear();
    this.selectedProvince = -1;
    this.paletteDirty = true;
    this.lastLog = sim.s.log.length ? sim.s.log[sim.s.log.length - 1].t : 0;
    this.colors.clear();
    this.rebuildLabels();
    if (me) {
      const c = sim.s.countries[me];
      const cap = this.world.provinces[c.capital];
      this.engine.controls.flyTo(cap.lat, cap.lon, 0.55);
    }
    audio.setIntensity(0.1);
    this.bump();
  }

  /** Write a slot. Safe to call often — it is gzip + localStorage. */
  async saveNow(slot = 'auto') {
    if (!this.sim) return null;
    // Campaign progress rides inside the state so load() resumes it verbatim.
    if (this.campaign) this.sim.s.campaign = this.campaign;
    const meta = await writeSave(slot, this.sim, this.me, this.campaign?.score ?? 0);
    this.refreshSaves();
    return meta;
  }

  refreshSaves() { this.saves = SLOTS_ALL.map((x) => readMeta(x)).filter((m): m is SaveMeta => !!m).sort((a, b) => b.savedAt - a.savedAt); }

  /** Load a slot and take the player straight back into the game. */
  async load(slot: string) {
    const p = await readSave(slot);
    if (!p) { this.toast('Сохранение не найдено или повреждено', 'error'); return false; }
    const sim = createSim(this.world, p.state);
    const me = p.meta.country || null;
    if (me && p.state.countries[me]) p.state.countries[me].player = this.playerId;
    // Rebuild campaign progress from the save if it exists in state (multiplayer-safe).
    const saved = (p.state.campaign as CampaignState | undefined) ?? null;
    const camp = saved ?? (me ? newCampaign(sim, me) : null);
    this.attach(sim, new Solo(sim, me ?? ''), me, camp);
    this.screen = 'game';
    this.refreshSaves();
    this.bump();
    return true;
  }

  continueGame() {
    const m = latestSave();
    if (!m) { this.toast('Нет сохранений', 'error'); return Promise.resolve(false); }
    return this.load(m.slot);
  }

  colorOf(owner: string): THREE.Color {
    let c = this.colors.get(owner);
    if (!c) {
      const hex = this.sim?.s.countries[owner]?.color ?? '#888888';
      c = new THREE.Color(hex);
      this.colors.set(owner, c);
    }
    return c;
  }

  dispatch(cmd: Command) {
    if (!this.session || !this.me) return;
    const err = this.session.dispatch(cmd);
    if (err) { this.toast(err, 'error'); audio.ui('error'); }
    this.paletteDirty = true;
    this.bump();
  }

  setQuality(q: 'auto' | 'high' | 'medium' | 'low') {
    this.quality = q;
    localStorage.setItem('ww.quality', q);
    if (q !== 'auto') this.qLevel = { high: 0, medium: 1, low: 2 }[q];
    else { this.qLevel = 0; this.fpsE = 60; }
    this.engine.setQuality(q === 'auto' ? 'high' : q);
    this.bump();
  }

  toast(text: string, kind: Toast['kind'] = 'info') {
    this.toasts.push({ id: this.toastId++, text, kind, t: performance.now() });
    if (this.toasts.length > 6) this.toasts.shift();
    this.bump();
  }

  // ------------------------------------------------------------------------------------------ frame
  private frame(dt: number, t: number) {
    // Auto quality: sustained low fps steps the renderer down (high → medium → low).
    this.fpsE += (1 / Math.max(dt, 1e-3) - this.fpsE) * 0.04;
    this.qTimer += dt;
    if (this.qTimer > 4) {
      this.qTimer = 0;
      if (this.quality === 'auto' && this.fpsE < 45 && this.qLevel < 2) {
        this.qLevel++;
        this.engine.setQuality(this.qLevel === 1 ? 'medium' : 'low');
        this.bump();
      }
    }
    const sim = this.sim;
    if (!sim) {
      if (this.screen === 'menu') this.engine.controls.lon += dt * 2.5;
      this.fx.update(dt, this.engine.controls.alt, this.engine.renderer.domElement.height, [], false);
      this.labels.update(this.engine.camera.position, this.engine.controls.alt);
      return;
    }
    this.session?.update(dt);
    const s = sim.s;
    this.engine.globe.setSun(sim.date);
    this.consumeFx(sim.fx.splice(0));
    // New log entries -> toasts
    for (const e of s.log) {
      if (e.t <= this.lastLog) continue;
      if (e.kind === 'war' || e.kind === 'alert' || e.kind === 'diplo' || e.kind === 'event' || (e.country && e.country === this.me)) {
        if (!e.country || e.country === this.me || e.kind === 'alert' || (e.kind === 'war' && e.text.startsWith('⚔')) || e.kind === 'diplo') this.toast(e.text, e.kind);
        if (e.kind === 'alert') audio.ui('alert');
      }
    }
    if (s.log.length) this.lastLog = Math.max(this.lastLog, s.log[s.log.length - 1].t);

    const me = this.me;
    const enemies = new Set(me ? sim.enemiesOf(me) : []);
    const alt = this.engine.controls.alt;
    const vp = new THREE.Vector2(window.innerWidth, window.innerHeight);
    this.units.update(s.units, dt, t, {
      colorOf: (o) => this.colorOf(o), selected: this.selectedUnits, me, hostile: (o) => enemies.has(o),
      engaged: (u) => u.engaged === 0, alt, viewport: vp,
      visible: (u) => u.owner === me || enemies.has(u.owner) || this.selectedUnits.has(u.id) || (alt < 0.5 && (UNIT[u.type].domain !== 'air' || alt < 0.3)),
    });
    this.fx.update(dt, alt, this.engine.renderer.domElement.height, s.missiles, s.speed === 0);
    this.labels.update(this.engine.camera.position, alt);

    // Paths of selected units (and hostile moves near own territory are hidden — fog of war light)
    const paths: { from: THREE.Vector3; pts: LL[]; hostile?: boolean }[] = [];
    for (const id of this.selectedUnits) {
      const u = sim.unit(id);
      if (!u) { this.selectedUnits.delete(id); continue; }
      if (u.path.length) paths.push({ from: this.units.displayPos(id) ?? new THREE.Vector3(...toXYZ(u.lat, u.lon)), pts: u.path });
    }
    this.paths.set(paths, t);

    this.circleTimer -= dt;
    if (this.circleTimer <= 0) { this.circleTimer = 0.5; this.updateCircles(); }
    this.paletteTimer -= dt;
    if (this.paletteDirty || this.paletteTimer <= 0) { this.paletteTimer = 1; this.paletteDirty = false; this.updatePalette(); }
    this.labelTimer -= dt;
    if (this.labelTimer <= 0) { this.labelTimer = 8; this.rebuildLabels(); }

    // Ambience
    const inWar = me ? enemies.size > 0 : false;
    const threatened = me ? s.missiles.some((m) => m.owner !== me && this.world.provinceAt(m.to.lat, m.to.lon) >= 0 && s.prov.ctrl[this.world.provinceAt(m.to.lat, m.to.lon)] === me) : false;
    if (threatened) this.sirenUntil = performance.now() + 6000;
    const siren = performance.now() < this.sirenUntil;
    audio.siren(siren);
    this.engine.alert = siren ? 0.8 : 0;
    audio.setIntensity(Math.min(1, (inWar ? 0.5 : 0.1) + s.tension / 200));

    // Campaign objectives tick once a game day, autosave every ~45 s of play.
    if (this.campaign && this.me && !this.campaign.finished) {
      const res = tickCampaign(sim, this.campaign, this.me);
      for (const o of res.completed) this.toast(`✅ Цель выполнена: ${o.label} (+${o.points})`, 'ok');
      if (res.finished) {
        const v = verdict(this.campaign, s, this.me);
        this.ending = { title: v.title, text: v.text, score: this.campaign.score, won: res.won };
        this.toast(res.won ? '🏆 Кампания завершена победой' : '🏁 Кампания завершена', res.won ? 'ok' : 'alert');
        void this.saveNow('auto');
      }
    }
    if (this.session?.role === 'solo' && this.campaign && !this.campaign.finished) {
      this.saveTimer -= dt;
      if (this.saveTimer <= 0) { this.saveTimer = 45; void this.saveNow('auto'); }
    }

    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.2;
      const now = performance.now();
      this.toasts = this.toasts.filter((x) => now - x.t < 7000);
      this.bump();
    }
  }

  private consumeFx(list: Fx[]) {
    const s = this.sim!.s;
    for (const f of list) {
      switch (f.k) {
        case 'launch': this.fx.launch(f.m); break;
        case 'intercept': this.fx.intercepted(f.m, f.at); break;
        case 'impact': this.fx.impact(f.m, f.at); break;
        case 'shot': this.fx.shot(f.from, f.to, f.kind); break;
        case 'destroyed': this.fx.unitDestroyed(f.at.lat, f.at.lon); break;
        case 'capture': {
          const p = this.world.provinces[f.p];
          this.fx.capturePulse(p.lat, p.lon, this.colorOf(f.by));
          this.paletteDirty = true;
          break;
        }
        case 'war': {
          this.paletteDirty = true;
          if (this.me && (f.war.attackers.includes(this.me) || f.war.defenders.includes(this.me))) { audio.ui('alert'); this.engine.shake(0.6); }
          break;
        }
        case 'peace': this.paletteDirty = true; break;
      }
    }
    this.session?.broadcastFx?.(list);
    void s;
  }

  // ------------------------------------------------------------------------------------------ palette & overlays
  /** Political map for menus (no game). */
  paintPolitical(highlight: string | null) {
    const w = this.world, g = this.engine.globe;
    const idx = new Map(w.tags.map((t, i) => [t, i]));
    Promise.resolve().then(() => {
      const defs = countryDefs();
      for (const p of w.provinces) {
        const c = hexToRgb(defs.get(p.country)?.color ?? '#7a7a7a');
        const i = idx.get(p.country) ?? 0;
        const hl = highlight && p.country === highlight;
        g.setProvince(p.id, c, i, c, i, [hl ? 110 : 0, hl ? 255 : 0, 0, p.country === '010' ? 0 : 255]);
      }
      g.commitPalette();
    });
  }

  updatePalette() {
    const sim = this.sim;
    if (!sim) return;
    const s = sim.s, w = this.world, g = this.engine.globe;
    const idx = new Map(w.tags.map((t, i) => [t, i]));
    const me = this.me;
    const mode = this.mapMode;
    const enemies = new Set(me ? sim.enemiesOf(me) : []);
    const allies = new Set(me ? sim.militaryAllies(me) : []);
    // Blockaded by an enemy fleet: paint the coast deep red so it is impossible to miss.
    const blockaded = me ? sim.blockadeLevel(me) : 0;
    const hostileFleet = new Set<string>();
    if (me && blockaded > 0) for (const u of s.units) if (UNIT[u.type].domain === 'sea' && sim.atWar(u.owner, me)) hostileFleet.add(u.owner);
    const threat = new Float32Array(w.provinces.length);
    if (mode === 'threat' && me) {
      for (const u of s.units) if (enemies.has(u.owner)) {
        const p = w.provinceAt(u.lat, u.lon);
        if (p < 0) continue;
        threat[p] += 1;
        for (const n of w.provinces[p].neighbors) threat[n] += 0.5;
      }
    }
    let maxPc = 1;
    if (mode === 'economy') for (const c of Object.values(s.countries)) maxPc = Math.max(maxPc, Math.log10((c.gdp * 1000) / Math.max(0.05, c.pop) + 1));
    for (const p of w.provinces) {
      const owner = s.prov.owner[p.id], ctrl = s.prov.ctrl[p.id];
      const oc = s.countries[owner], cc = s.countries[ctrl];
      let ownerRgb = hexToRgb(oc?.color ?? '#6f6f6f'), ctrlRgb = hexToRgb(cc?.color ?? '#6f6f6f');
      let mix = owner === '010' ? 0 : 160;
      let glow = 0, pulse = 0;
      const outline = me && ctrl === me ? 255 : 0;
      if (p.id === this.selectedProvince) glow = 60;
      if (this.inspectCountry && ctrl === this.inspectCountry) glow = 90;
      if (enemies.has(ctrl) && me && p.neighbors.some((n) => s.prov.ctrl[n] === me)) pulse = 180;
      if ((s.prov.capture[p.id] ?? 0) > 0.05) pulse = 255;
      if (blockaded > 0 && hostileFleet.has(owner) && p.coastal && ctrl === me) { ownerRgb = ctrlRgb = [180, 40, 40]; mix = 210; }
      switch (mode) {
        case 'terrain': {
          ctrlRgb = ownerRgb = hexToRgb(TERRAIN_COLOR[p.terrain]);
          mix = 90;
          break;
        }
        case 'diplomacy': {
          if (!me) break;
          const r = sim.rel(me, ctrl);
          let col: [number, number, number];
          if (ctrl === me) col = [232, 163, 61];
          else if (enemies.has(ctrl)) col = [220, 40, 30];
          else if (allies.has(ctrl)) col = [60, 130, 230];
          else if (s.countries[me]?.sanctions.includes(ctrl)) col = [220, 120, 40];
          else col = r >= 0 ? lerp3([120, 120, 125], [70, 190, 110], r / 100) : lerp3([120, 120, 125], [170, 60, 60], -r / 100);
          ownerRgb = ctrlRgb = col; mix = 210;
          break;
        }
        case 'economy': {
          const c = cc;
          const pc = c ? Math.log10((c.gdp * 1000) / Math.max(0.05, c.pop) + 1) / maxPc : 0;
          ownerRgb = ctrlRgb = lerp3(lerp3([40, 40, 120], [40, 170, 170], Math.min(1, pc * 1.4)), [250, 220, 60], Math.max(0, pc * 1.6 - 0.6));
          if (s.prov.damage[p.id] > 0.05) ownerRgb = ctrlRgb = lerp3(ctrlRgb, [20, 10, 10], s.prov.damage[p.id]);
          mix = 210;
          break;
        }
        case 'military': {
          ownerRgb = lerp3(ownerRgb, [40, 40, 45], 0.45);
          if (me) {
            if (ctrl === me) ctrlRgb = lerp3(ownerRgb, [70, 210, 150], 0.7);
            else if (enemies.has(ctrl)) ctrlRgb = lerp3(ownerRgb, [235, 55, 45], 0.75);
            else ctrlRgb = lerp3(ownerRgb, [255, 255, 255], 0.08);
          } else ctrlRgb = ownerRgb;
          if (s.prov.damage[p.id] > 0.05) ownerRgb = ctrlRgb = lerp3(ctrlRgb, [15, 10, 10], Math.min(1, s.prov.damage[p.id]));
          mix = 200;
          break;
        }
        case 'airdefense': mix = 70; break;
        case 'resources': {
          const keys = Object.keys(p.resources) as (keyof typeof RESOURCE_INFO)[];
          if (keys.length) {
            const best = keys.sort((a, b) => (p.resources[b] ?? 0) - (p.resources[a] ?? 0))[0];
            const col = hexToRgb(RESOURCE_INFO[best].color === '#2b2b2b' ? '#5a3a1a' : RESOURCE_INFO[best].color);
            ownerRgb = ctrlRgb = col; mix = 160 + (p.resources[best] ?? 0) * 30;
          } else { ownerRgb = ctrlRgb = [70, 70, 75]; mix = 120; }
          break;
        }
        case 'trade': {
          // Paint each province by its country's best trade position: green = exporter,
          // red = net importer. Reads at a glance where the money flows.
          const res = (Object.keys(RESOURCE_INFO) as ResourceKey[]).reduce((best, k) => ((oc?.prod[k] ?? 0) - (oc?.use[k] ?? 0) > ((oc?.prod[best] ?? 0) - (oc?.use[best] ?? 0)) ? k : best), 'oil' as ResourceKey);
          const net = oc ? (oc.prod[res] ?? 0) - (oc.use[res] ?? 0) : 0;
          const k = Math.max(-1, Math.min(1, net / 20));
          ownerRgb = ctrlRgb = lerp3([190, 60, 50], [60, 190, 110], (k + 1) / 2);
          mix = 220;
          break;
        }
        case 'threat': {
          const tv = Math.min(1, threat[p.id] / 3);
          ownerRgb = ctrlRgb = lerp3(ctrl === me ? [60, 90, 60] : [60, 60, 65], [240, 40, 20], tv);
          mix = 200;
          break;
        }
      }
      const sameColors = mode !== 'political' && mode !== 'military' && mode !== 'airdefense';
      g.setProvince(p.id, ownerRgb, idx.get(sameColors ? ctrl : owner) ?? 0, ctrlRgb, idx.get(ctrl) ?? 0, [glow, outline, pulse, Math.min(255, mix)]);
    }
    g.commitPalette();
  }

  private updateCircles() {
    const sim = this.sim;
    if (!sim) return;
    const out: Parameters<CircleLayer['set']>[0] = [];
    const showAll = this.mapMode === 'airdefense';
    for (const u of sim.s.units) {
      if (u.type !== 'airdef') continue;
      const mine = u.owner === this.me;
      if (!showAll && !mine && !this.selectedUnits.has(u.id)) continue;
      const c = sim.c(u.owner)!;
      const km = UNIT.airdef.range * (1 + sim.mod(c, 'ad_range'));
      out.push({ lat: u.lat, lon: u.lon, km, color: mine ? new THREE.Color(0x56c8ff) : this.colorOf(u.owner), fill: showAll ? 0.12 : this.selectedUnits.has(u.id) ? 0.08 : 0, line: showAll || this.selectedUnits.has(u.id) ? 0.8 : 0.25 });
    }
    for (const id of this.selectedUnits) {
      const u = sim.unit(id);
      if (!u || u.type === 'airdef') continue;
      const st = UNIT[u.type];
      if (st.range >= 40) out.push({ lat: u.lat, lon: u.lon, km: st.range, color: new THREE.Color(0xffc861), fill: 0.05, line: 0.6 });
    }
    if (this.targeting && this.hoverPos && this.me) {
      const at = this.engine.controls.pick(this.hoverPos.x, this.hoverPos.y);
      if (at) {
        const c = sim.c(this.me)!;
        const site = sim.launchSite(c, at, this.targeting.missile);
        out.push({ lat: at.lat, lon: at.lon, km: 25, color: new THREE.Color(site ? 0xff4030 : 0x777777), fill: 0.25, line: 1 });
      }
    }
    this.circles.set(out);
  }

  rebuildLabels() {
    const w = this.world;
    const s = this.sim?.s;
    const keep = new Set<string>();
    const area = new Map<string, number>(), vec = new Map<string, THREE.Vector3>();
    for (const p of w.provinces) {
      const owner = s ? s.prov.owner[p.id] : p.country;
      if (owner === '010') continue;
      area.set(owner, (area.get(owner) ?? 0) + p.area);
      const v = vec.get(owner) ?? new THREE.Vector3();
      v.add(new THREE.Vector3(...toXYZ(p.lat, p.lon)).multiplyScalar(p.area));
      vec.set(owner, v);
    }
    document.fonts.ready.then(() => {
      const defs = countryDefs();
      for (const [id, a] of area) {
        if (a < 15000) continue;
        const v = vec.get(id)!.normalize();
        const ll = { lat: Math.asin(v.y) / (Math.PI / 180), lon: Math.atan2(-v.z, v.x) / (Math.PI / 180) };
        const h = Math.max(0.008, Math.min(0.065, Math.sqrt(a) / 70000));
        const name = s?.countries[id]?.name ?? defs.get(id)?.name ?? id;
        this.labels.set('c' + id, name, ll.lat, ll.lon, h, h * 2.5, h * 45, 'country');
        keep.add('c' + id);
      }
      for (const c of cities()) {
        const capital = s ? Object.values(s.countries).some((x) => w.provinces[x.capital]?.city?.name === c.name) : false;
        if (c.pop < 0.4 && !capital) continue;
        const key = 'city' + c.name;
        this.labels.set(key, c.name, c.lat, c.lon, capital ? 0.0042 : 0.0034, 0, capital ? 0.55 : c.pop > 3 ? 0.4 : 0.22, capital ? 'capital' : 'city');
        keep.add(key);
      }
      for (const k of this.labels.keys()) if (!keep.has(k)) this.labels.remove(k);
    });
  }

  // ------------------------------------------------------------------------------------------ input
  private setupInput(canvas: HTMLCanvasElement) {
    const ctl = this.engine.controls;
    ctl.onHover = (e) => {
      this.hoverPos = { x: e.clientX, y: e.clientY };
      const at = ctl.pick(e.clientX, e.clientY);
      const p = at ? this.world.provinceAt(at.lat, at.lon) : -1;
      if (p !== this.hoverProvince) {
        this.hoverProvince = p;
        this.engine.globe.material.uniforms.hoverId.value = p + 1 || -1;
      }
      if (this.sim && this.me) {
        const rect = { x0: e.clientX - 90, y0: e.clientY - 90, x1: e.clientX + 90, y1: e.clientY + 90 };
        const ids = this.units.pick(this.engine.camera, rect, window.innerWidth, window.innerHeight);
        let mine = 0, enemy = 0;
        for (const id of ids) {
          const u = this.sim.unit(id);
          if (!u) continue;
          if (u.owner === this.me) mine++;
          else if (this.sim.atWar(u.owner, this.me)) enemy++;
        }
        if (mine !== this.hoverUnits.mine || enemy !== this.hoverUnits.enemy) this.hoverUnits = { mine, enemy };
      }
      let warn: string | null = null;
      if (this.targeting && this.sim && this.me && p >= 0) {
        const ctrl = this.sim.s.prov.ctrl[p];
        if (ctrl !== this.me && ctrl !== '010' && !this.sim.atWar(this.me, ctrl)) warn = this.sim.c(ctrl)?.name ?? null;
      }
      if (warn !== this.targetWarn) { this.targetWarn = warn; this.bump(); }
    };
    ctl.onClick = (e) => {
      audio.unlock();
      if (!this.sim) {
        const at = ctl.pick(e.clientX, e.clientY);
        const p = at ? this.world.provinceAt(at.lat, at.lon) : -1;
        if (this.screen === 'select' && p >= 0) { this.inspectCountry = this.world.provinces[p].country; this.paintPolitical(this.inspectCountry); audio.ui('select'); this.bump(); }
        return;
      }
      if (this.targeting) { this.fireAt(e.clientX, e.clientY); return; }
      // Alt-click anywhere: immediate operational strike, no menus.
      if (e.altKey && this.me) {
        const at = ctl.pick(e.clientX, e.clientY);
        const p = at ? this.world.provinceAt(at.lat, at.lon) : -1;
        const owner = p >= 0 ? this.sim.s.prov.ctrl[p] : null;
        if (owner && owner !== this.me && this.sim.atWar(this.me, owner)) {
          this.dispatch({ t: 'ops', op: 'strike', target: owner });
          this.fx.capturePulse(at!.lat, at!.lon, new THREE.Color(0xff4030));
          this.bump();
          return;
        }
        if (owner && owner !== this.me) { this.toast('Удар возможен только по противнику в войне', 'error'); return; }
      }
      const rect = { x0: e.clientX - 14, y0: e.clientY - 10, x1: e.clientX + 14, y1: e.clientY + 10 };
      const hits = this.units.pick(this.engine.camera, rect, window.innerWidth, window.innerHeight);
      if (!e.ctrlKey && !e.metaKey) this.selectedUnits.clear();
      if (hits.length) {
        const own = hits.filter((id) => this.sim!.unit(id)?.owner === this.me);
        const pick = own.length ? own : hits.slice(0, 1);
        // Click on a stack selects the whole stack of own units.
        for (const id of pick) this.selectedUnits.add(id);
        this.selectedProvince = -1;
        this.inspectCountry = null;
        audio.ui('select');
      } else {
        const at = ctl.pick(e.clientX, e.clientY);
        const p = at ? this.world.provinceAt(at.lat, at.lon) : -1;
        this.selectedProvince = p;
        this.inspectCountry = p >= 0 ? this.sim.s.prov.ctrl[p] : null;
        this.engine.globe.material.uniforms.selectedId.value = p + 1 || -1;
        if (p >= 0) audio.ui('click');
      }
      this.paletteDirty = true;
      this.bump();
    };
    ctl.onDoubleClick = (e) => {
      // Double click on empty land: jump the camera there (fast map reading).
      if (!this.sim) return;
      const at = ctl.pick(e.clientX, e.clientY);
      if (at) ctl.flyTo(at.lat, at.lon, Math.min(0.35, ctl.alt));
    };
    ctl.onRightClick = (e) => {
      audio.unlock();
      if (this.targeting) { this.targeting = null; this.bump(); return; }
      if (!this.sim || !this.selectedUnits.size) return;
      const at = ctl.pick(e.clientX, e.clientY);
      if (!at) return;
      const mine = [...this.selectedUnits].filter((id) => this.sim!.unit(id)?.owner === this.me);
      if (!mine.length) return;
      this.dispatch({ t: 'move', units: mine, to: at });
      audio.ui('order');
      this.fx.capturePulse(at.lat, at.lon, new THREE.Color(0xffc861));
    };
    ctl.onBoxStart = (e) => {
      if (!this.sim) return false;
      this.box = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
      const move = (ev: PointerEvent) => { if (this.box) { this.box.x1 = ev.clientX; this.box.y1 = ev.clientY; this.bump(); } };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        const b = this.box;
        this.box = null;
        if (!b) return;
        const rect = { x0: Math.min(b.x0, b.x1), y0: Math.min(b.y0, b.y1), x1: Math.max(b.x0, b.x1), y1: Math.max(b.y0, b.y1) };
        const ids = this.units.pick(this.engine.camera, rect, window.innerWidth, window.innerHeight).filter((id) => this.sim!.unit(id)?.owner === this.me);
        this.selectedUnits = new Set(ids);
        if (ids.length) audio.ui('select');
        this.bump();
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      return true;
    };
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      // WASD / QE pan and zoom the camera — never let them type into browser shortcuts.
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code) && !e.ctrlKey && !e.metaKey) e.preventDefault();
      if (!this.sim || !this.me) return;
      if (e.code === 'Space') { e.preventDefault(); this.dispatch({ t: 'speed', speed: this.sim.s.speed ? 0 : 2 }); }
      else if (e.key >= '1' && e.key <= '5' && !e.ctrlKey) this.dispatch({ t: 'speed', speed: +e.key });
      else if (e.code === 'Escape') { this.targeting = null; this.selectedUnits.clear(); this.panel = null; this.selectedProvince = -1; this.inspectCountry = null; this.bump(); }
      else if (e.code === 'KeyH' && this.selectedUnits.size) this.dispatch({ t: 'hold', units: [...this.selectedUnits] });
      else if (e.code === 'KeyA' && e.ctrlKey) { e.preventDefault(); this.selectedUnits = new Set(this.sim.s.units.filter((u) => u.owner === this.me).map((u) => u.id)); this.bump(); }
      else if (e.code === 'KeyO') { this.panel = this.panel === 'ops' ? null : 'ops'; this.bump(); }
      else if (e.code === 'KeyF') { this.panel = this.panel === 'focus' ? null : 'focus'; this.bump(); }
      else if (e.code === 'KeyR' && !e.ctrlKey) { this.panel = this.panel === 'research' ? null : 'research'; this.bump(); }
    });
    void canvas;
  }

  private fireAt(x: number, y: number) {
    const at = this.engine.controls.pick(x, y);
    if (!at || !this.targeting || !this.sim) return;
    const hits = this.units.pick(this.engine.camera, { x0: x - 12, y0: y - 10, x1: x + 12, y1: y + 10 }, window.innerWidth, window.innerHeight);
    const target = hits.find((id) => this.sim!.unit(id)?.owner !== this.me) ?? null;
    const u = target !== null ? this.sim.unit(target) : null;
    this.dispatch({ t: 'launch', missile: this.targeting.missile, to: u ? { lat: u.lat, lon: u.lon } : at, count: this.targeting.count, targetUnit: target });
    if (!(window.event as KeyboardEvent | undefined)?.shiftKey) this.targeting = null;
    this.bump();
  }

  selectedUnitList(): Unit[] {
    if (!this.sim) return [];
    return [...this.selectedUnits].map((id) => this.sim!.unit(id)).filter((u): u is Unit => !!u);
  }

  focusUnit(u: Unit) { this.engine.controls.flyTo(u.lat, u.lon, Math.min(this.engine.controls.alt, 0.25)); }
}

function lerp3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

export const ctl = new Controller();
