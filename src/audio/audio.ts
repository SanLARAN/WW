type Bus = 'music' | 'sfx' | 'ui' | 'ambient';

const STORE_KEY = 'ww.audio';

export interface AudioSettings { master: number; music: number; sfx: number; ui: number; ambient: number; muted: boolean }

const CHORDS_CALM = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
const CHORDS_WAR = [[50, 53, 57], [46, 50, 53], [48, 51, 55], [45, 49, 52]]; // Dm Bb Cm A

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** Fully procedural sound design: nothing is loaded from disk. */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses = {} as Record<Bus, GainNode>;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  settings: AudioSettings = { master: 0.8, music: 0.55, sfx: 0.9, ui: 0.6, ambient: 0.5, muted: false };
  private intensity = 0;
  private musicTimer: number | null = null;
  private chord = 0;
  private pad: { osc: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private sirenNode: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;
  private lastShot = 0;
  private lastBoom = 0;

  constructor() {
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')); } catch { /* ignore */ }
  }

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    for (const b of ['music', 'sfx', 'ui', 'ambient'] as Bus[]) { this.buses[b] = ctx.createGain(); this.buses[b].connect(this.master); }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.4);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.noise = this.makeNoise(false);
    this.brown = this.makeNoise(true);
    this.apply();
  }

  apply() {
    if (!this.ctx) return;
    const s = this.settings;
    this.master.gain.value = s.muted ? 0 : s.master;
    this.buses.music.gain.value = s.music * 0.5;
    this.buses.sfx.gain.value = s.sfx;
    this.buses.ui.gain.value = s.ui * 0.5;
    this.buses.ambient.gain.value = s.ambient * 0.6;
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  }

  private makeNoise(brown: boolean) {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }

  private impulse(len: number, decay: number) {
    const ctx = this.ctx!;
    const n = ctx.sampleRate * len;
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return b;
  }

  private src(buf: AudioBuffer, rate = 1) {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
    s.loopStart = Math.random() * 2;
    return s;
  }

  private out(bus: Bus, gain: number, reverb = 0.3) {
    const g = this.ctx!.createGain();
    g.gain.value = gain;
    g.connect(this.buses[bus]);
    if (reverb > 0) { const r = this.ctx!.createGain(); r.gain.value = reverb; g.connect(r).connect(this.reverbSend); }
    return g;
  }

  // ------------------------------------------------------------------ UI
  ui(kind: 'click' | 'hover' | 'open' | 'close' | 'confirm' | 'error' | 'notify' | 'alert' | 'select' | 'order') {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const tone = (f: number, d: number, type: OscillatorType, g: number, at = 0, slide = 0) => {
      const o = ctx.createOscillator(), e = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t + at);
      if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + at + d);
      e.gain.setValueAtTime(0, t + at); e.gain.linearRampToValueAtTime(g, t + at + 0.005); e.gain.exponentialRampToValueAtTime(0.0001, t + at + d);
      o.connect(e).connect(this.out('ui', 1, 0.15));
      o.start(t + at); o.stop(t + at + d + 0.05);
    };
    switch (kind) {
      case 'hover': tone(2400, 0.03, 'sine', 0.05); break;
      case 'click': tone(1300, 0.05, 'square', 0.06); tone(650, 0.06, 'sine', 0.08); break;
      case 'select': tone(880, 0.07, 'triangle', 0.12); tone(1320, 0.08, 'sine', 0.08, 0.04); break;
      case 'order': tone(520, 0.06, 'square', 0.07); tone(780, 0.09, 'square', 0.07, 0.06); this.radio(0.25, 0.08); break;
      case 'open': this.whoosh(0.25, 0.12, 800, 3000); tone(440, 0.12, 'sine', 0.05, 0, 1.5); break;
      case 'close': this.whoosh(0.2, 0.1, 2500, 600); break;
      case 'confirm': tone(660, 0.1, 'triangle', 0.12); tone(990, 0.16, 'triangle', 0.12, 0.08); break;
      case 'error': tone(180, 0.18, 'sawtooth', 0.08); tone(150, 0.2, 'sawtooth', 0.08, 0.1); break;
      case 'notify': tone(1046, 0.12, 'sine', 0.1); tone(1568, 0.2, 'sine', 0.08, 0.1); break;
      case 'alert': for (let i = 0; i < 3; i++) tone(880, 0.12, 'square', 0.07, i * 0.18); break;
    }
  }

  private whoosh(d: number, g: number, f0: number, f1: number, bus: Bus = 'ui') {
    const ctx = this.ctx!, t = ctx.currentTime;
    const n = this.src(this.noise), f = ctx.createBiquadFilter(), e = ctx.createGain();
    f.type = 'bandpass'; f.Q.value = 1.4; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + d);
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + d * 0.3); e.gain.exponentialRampToValueAtTime(0.0001, t + d);
    n.connect(f).connect(e).connect(this.out(bus, 1, 0.2));
    n.start(t); n.stop(t + d + 0.05);
  }

  /** Short burst of filtered radio static with voice-like formants. */
  radio(d: number, g: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = this.src(this.noise), bp = ctx.createBiquadFilter(), am = ctx.createGain(), e = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 1400 + Math.random() * 900; bp.Q.value = 3;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 7 + Math.random() * 9;
    const lg = ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg).connect(am.gain); am.gain.value = 0.5;
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + 0.02); e.gain.setValueAtTime(g, t + d - 0.03); e.gain.linearRampToValueAtTime(0, t + d);
    n.connect(bp).connect(am).connect(e).connect(this.out('ambient', 1, 0.1));
    n.start(t); lfo.start(t); n.stop(t + d + 0.05); lfo.stop(t + d + 0.05);
  }

  // ------------------------------------------------------------------ SFX
  private distGain(dist: number) { return 1 / (1 + dist * dist * 2.5); }

  launch(power: number, dist: number, heavy = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime, g = this.distGain(dist) * Math.min(1.5, power);
    if (g < 0.02) return;
    const dur = heavy ? 5 : 2.6;
    // Ignition crack
    const c = this.src(this.noise), cf = ctx.createBiquadFilter(), ce = ctx.createGain();
    cf.type = 'highpass'; cf.frequency.value = 900;
    ce.gain.setValueAtTime(g * 0.6, t); ce.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    c.connect(cf).connect(ce).connect(this.out('sfx', 1, 0.4));
    c.start(t); c.stop(t + 0.3);
    // Rocket roar
    const r = this.src(this.brown, 1.2), rf = ctx.createBiquadFilter(), re = ctx.createGain();
    rf.type = 'lowpass'; rf.frequency.setValueAtTime(1800, t); rf.frequency.exponentialRampToValueAtTime(220, t + dur);
    re.gain.setValueAtTime(0, t); re.gain.linearRampToValueAtTime(g * 0.9, t + 0.15); re.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    r.connect(rf).connect(re).connect(this.out('sfx', 1, 0.5));
    r.start(t); r.stop(t + dur + 0.1);
    // Whoosh rising away
    const w = this.src(this.noise), wf = ctx.createBiquadFilter(), we = ctx.createGain();
    wf.type = 'bandpass'; wf.Q.value = 2; wf.frequency.setValueAtTime(400, t); wf.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.6);
    we.gain.setValueAtTime(0, t); we.gain.linearRampToValueAtTime(g * 0.35, t + 0.3); we.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.8);
    w.connect(wf).connect(we).connect(this.out('sfx', 1, 0.6));
    w.start(t); w.stop(t + dur);
  }

  boom(power: number, dist: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    if (now - this.lastBoom < 40) return;
    this.lastBoom = now;
    const t = ctx.currentTime + Math.min(0.8, dist * 0.6), g = this.distGain(dist) * Math.min(1.4, power);
    if (g < 0.02) return;
    const dur = 1.2 + power * 1.4;
    // Sub thump
    const o = ctx.createOscillator(), oe = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
    oe.gain.setValueAtTime(g * 1.1, t); oe.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(oe).connect(this.out('sfx', 1, 0.2));
    o.start(t); o.stop(t + 1);
    // Body
    const n = this.src(this.noise), nf = ctx.createBiquadFilter(), ne = ctx.createGain();
    nf.type = 'lowpass'; nf.frequency.setValueAtTime(4500 / (1 + dist * 4), t); nf.frequency.exponentialRampToValueAtTime(140, t + dur);
    ne.gain.setValueAtTime(g * 0.9, t); ne.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(nf).connect(ne).connect(this.out('sfx', 1, 0.7));
    n.start(t); n.stop(t + dur + 0.1);
    // Debris crackle
    const d = this.src(this.noise, 0.6), df = ctx.createBiquadFilter(), de = ctx.createGain();
    df.type = 'bandpass'; df.frequency.value = 3000; df.Q.value = 0.7;
    de.gain.setValueAtTime(0, t + 0.08); de.gain.linearRampToValueAtTime(g * 0.12, t + 0.2); de.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.8);
    d.connect(df).connect(de).connect(this.out('sfx', 1, 0.5));
    d.start(t); d.stop(t + dur);
  }

  nuke(dist: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime, g = Math.max(0.35, this.distGain(dist * 0.5));
    // Silence-then-flash high tone
    const hi = ctx.createOscillator(), he = ctx.createGain();
    hi.frequency.value = 7000; he.gain.setValueAtTime(g * 0.05, t); he.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
    hi.connect(he).connect(this.out('sfx', 1, 0)); hi.start(t); hi.stop(t + 2.6);
    // Shockwave arrives after a delay
    const t2 = t + 0.9;
    const o = ctx.createOscillator(), oe = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(70, t2); o.frequency.exponentialRampToValueAtTime(18, t2 + 4);
    oe.gain.setValueAtTime(g * 1.6, t2); oe.gain.exponentialRampToValueAtTime(0.0001, t2 + 6);
    o.connect(oe).connect(this.out('sfx', 1, 0.3)); o.start(t2); o.stop(t2 + 6.2);
    const r = this.src(this.brown, 0.5), rf = ctx.createBiquadFilter(), re = ctx.createGain();
    rf.type = 'lowpass'; rf.frequency.setValueAtTime(2200, t2); rf.frequency.exponentialRampToValueAtTime(60, t2 + 14);
    re.gain.setValueAtTime(0, t2); re.gain.linearRampToValueAtTime(g * 1.8, t2 + 0.08); re.gain.exponentialRampToValueAtTime(0.0001, t2 + 15);
    r.connect(rf).connect(re).connect(this.out('sfx', 1, 0.9)); r.start(t2); r.stop(t2 + 15.2);
    const n = this.src(this.noise), nf = ctx.createBiquadFilter(), ne = ctx.createGain();
    nf.type = 'lowpass'; nf.frequency.setValueAtTime(8000, t2); nf.frequency.exponentialRampToValueAtTime(300, t2 + 5);
    ne.gain.setValueAtTime(g * 1.2, t2); ne.gain.exponentialRampToValueAtTime(0.0001, t2 + 6);
    n.connect(nf).connect(ne).connect(this.out('sfx', 1, 1)); n.start(t2); n.stop(t2 + 6.2);
  }

  intercept(dist: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + dist * 0.4, g = this.distGain(dist) * 0.6;
    if (g < 0.02) return;
    const n = this.src(this.noise), nf = ctx.createBiquadFilter(), ne = ctx.createGain();
    nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 0.8;
    ne.gain.setValueAtTime(g, t); ne.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    n.connect(nf).connect(ne).connect(this.out('sfx', 1, 0.9)); n.start(t); n.stop(t + 1);
  }

  shot(power: number, dist: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    if (now - this.lastShot < 70) return;
    this.lastShot = now;
    const t = ctx.currentTime, g = this.distGain(dist * 1.5) * power * 0.35;
    if (g < 0.01) return;
    const n = this.src(this.noise), nf = ctx.createBiquadFilter(), ne = ctx.createGain();
    nf.type = 'lowpass'; nf.frequency.value = 900 + Math.random() * 1500;
    ne.gain.setValueAtTime(g, t); ne.gain.exponentialRampToValueAtTime(0.0001, t + 0.35 + power * 0.4);
    n.connect(nf).connect(ne).connect(this.out('sfx', 1, 0.6)); n.start(t); n.stop(t + 1);
  }

  siren(on: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (on && !this.sirenNode) {
      const osc = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), gain = ctx.createGain(), f = ctx.createBiquadFilter();
      osc.type = 'sawtooth'; osc.frequency.value = 520;
      lfo.frequency.value = 0.12; lg.gain.value = 230; lfo.connect(lg).connect(osc.frequency);
      f.type = 'lowpass'; f.frequency.value = 1500;
      gain.gain.setValueAtTime(0, ctx.currentTime); gain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 2);
      osc.connect(f).connect(gain).connect(this.out('sfx', 1, 1.2));
      osc.start(); lfo.start();
      this.sirenNode = { osc, lfo, gain };
    } else if (!on && this.sirenNode) {
      const s = this.sirenNode;
      this.sirenNode = null;
      s.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2.5);
      s.osc.stop(ctx.currentTime + 2.6); s.lfo.stop(ctx.currentTime + 2.6);
    }
  }

  // ------------------------------------------------------------------ generative score
  setIntensity(v: number) { this.intensity = Math.max(0, Math.min(1, v)); }

  startMusic() {
    if (!this.ctx || this.musicTimer !== null) return;
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 600; filter.Q.value = 2;
    const gain = ctx.createGain(); gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 4);
    filter.connect(gain).connect(this.out('music', 1, 0.9));
    const osc: OscillatorNode[] = [];
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator();
      o.type = i < 3 ? 'sawtooth' : 'triangle';
      o.detune.value = (i % 3 - 1) * 9;
      const og = ctx.createGain(); og.gain.value = i < 3 ? 0.07 : 0.12;
      o.connect(og).connect(filter); o.start();
      osc.push(o);
    }
    // Sub drone
    const sub = ctx.createOscillator(); sub.type = 'sine';
    const sg = ctx.createGain(); sg.gain.value = 0.18;
    sub.connect(sg).connect(this.out('music', 1, 0));
    sub.start(); osc.push(sub);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
    const lg = ctx.createGain(); lg.gain.value = 300;
    lfo.connect(lg).connect(filter.frequency); lfo.start();
    this.pad = { osc, gain, filter };
    const step = () => {
      if (!this.ctx || !this.pad) return;
      const t = this.ctx.currentTime;
      const set = this.intensity > 0.35 ? CHORDS_WAR : CHORDS_CALM;
      const ch = set[this.chord++ % set.length];
      this.pad.osc.forEach((o, i) => {
        if (i === 6) o.frequency.setTargetAtTime(midi(ch[0] - 24), t, 1.5);
        else o.frequency.setTargetAtTime(midi(ch[i % 3] - (i < 3 ? 12 : 0)), t, 1.2);
      });
      this.pad.filter.frequency.setTargetAtTime(500 + this.intensity * 1400, t, 2);
      // Sparse melodic pings
      if (Math.random() < 0.7) this.bell(midi(ch[Math.floor(Math.random() * 3)] + 12 + (Math.random() < 0.3 ? 12 : 0)), t + Math.random() * 3, 0.05);
      // War drums
      if (this.intensity > 0.3) for (let b = 0; b < 4; b++) if (Math.random() < 0.4 + this.intensity * 0.5) this.drum(t + b * 1.6 + (Math.random() < 0.3 ? 0.8 : 0), 0.25 * this.intensity);
      // Radio chatter
      if (Math.random() < 0.25 + this.intensity * 0.4) setTimeout(() => this.radio(0.4 + Math.random() * 1.4, 0.05), Math.random() * 5000);
      if (Math.random() < 0.2) this.morse(t + Math.random() * 4);
    };
    step();
    this.musicTimer = window.setInterval(step, 6400);
  }

  private bell(f: number, t: number, g: number) {
    const ctx = this.ctx!;
    for (const [mul, amp] of [[1, 1], [2.76, 0.4], [5.4, 0.2]]) {
      const o = ctx.createOscillator(), e = ctx.createGain();
      o.frequency.value = f * mul;
      e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g * amp, t + 0.01); e.gain.exponentialRampToValueAtTime(0.0001, t + 4 / mul);
      o.connect(e).connect(this.out('music', 1, 1.4)); o.start(t); o.stop(t + 4.2);
    }
  }

  private drum(t: number, g: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), e = ctx.createGain();
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    o.connect(e).connect(this.out('music', 1, 0.8)); o.start(t); o.stop(t + 0.9);
  }

  private morse(t: number) {
    const ctx = this.ctx!;
    let at = t;
    for (let i = 0; i < 5 + Math.floor(Math.random() * 6); i++) {
      const d = Math.random() < 0.5 ? 0.06 : 0.18;
      const o = ctx.createOscillator(), e = ctx.createGain();
      o.frequency.value = 760;
      e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(0.025, at + 0.005); e.gain.setValueAtTime(0.025, at + d); e.gain.linearRampToValueAtTime(0, at + d + 0.005);
      o.connect(e).connect(this.out('ambient', 1, 0.3)); o.start(at); o.stop(at + d + 0.02);
      at += d + 0.08;
    }
  }
}

export const audio = new AudioEngine();
