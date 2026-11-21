/**
 * Procedural audio. No sample files: every gunshot, rotor beat, distant shell
 * and gust of wind is synthesised in WebAudio, so the game ships with zero audio
 * assets and still sounds like a battlefield.
 *
 * Everything is spatialised by distance and direction relative to the listener:
 * shots far away lose their crack and keep only the low thump, which is what
 * makes a firefight feel like it is happening around you.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: DynamicsCompressorNode;
  private noise!: AudioBuffer;
  private wind?: { gain: GainNode; filter: BiquadFilterNode };
  private started = false;
  muted = false;

  /** Must be called from a user gesture. */
  start() {
    if (this.started) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.bus = this.ctx.createDynamicsCompressor();
    this.bus.threshold.value = -18;
    this.bus.knee.value = 22;
    this.bus.ratio.value = 8;
    this.bus.attack.value = 0.003;
    this.bus.release.value = 0.25;
    this.master.connect(this.bus).connect(this.ctx.destination);

    // 2 s of white noise is the raw material for every effect
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.startWind();
    this.started = true;
  }

  resume() {
    void this.ctx?.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.85;
  }

  private startWind() {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.6;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.07;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    // slow gusting
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain).connect(gain.gain);
    lfo.start();
    this.wind = { gain, filter };
  }

  /** Distance attenuation + a low-pass that eats the high frequencies with range. */
  private chain(pan: number, dist: number, maxDist: number) {
    if (!this.ctx) return null;
    const g = this.ctx.createGain();
    const k = Math.max(0, 1 - dist / maxDist);
    g.gain.value = k * k;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4000 * (0.25 + k * 0.95) + 220;
    g.connect(lp).connect(p).connect(this.master);
    return { g, lp };
  }

  private burst(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType, when = 0) {
    if (!this.ctx) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.25;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const env = this.ctx.createGain();
    const t = this.ctx.currentTime + when;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(env);
    src.start(t);
    src.stop(t + dur + 0.02);
    return env;
  }

  /** A rifle shot: supersonic crack + body + tail. */
  shot(kind: 'ak' | 'shotgun' | 'sniper' | 'lmg' | 'enemy' | 'tank', dist = 0, pan = 0) {
    if (!this.ctx) return;
    const out = this.chain(pan, dist, 420);
    if (!out) return;
    const near = Math.max(0.2, 1 - dist / 60);
    const table = {
      ak: { body: 1500, thump: 90, dur: 0.22, gain: 0.55, crack: 3200 },
      enemy: { body: 1350, thump: 80, dur: 0.24, gain: 0.5, crack: 3000 },
      shotgun: { body: 900, thump: 60, dur: 0.42, gain: 0.8, crack: 2000 },
      sniper: { body: 1900, thump: 55, dur: 0.55, gain: 0.9, crack: 4200 },
      lmg: { body: 1200, thump: 70, dur: 0.26, gain: 0.65, crack: 2800 },
      tank: { body: 320, thump: 32, dur: 1.1, gain: 1.0, crack: 900 },
    }[kind];
    const body = this.burst(table.dur, table.body * (0.4 + near * 0.7), 1.1, table.gain * near, 'bandpass');
    body?.connect(out.g);
    const thump = this.burst(table.dur * 1.6, table.thump, 0.8, table.gain * 1.3, 'lowpass');
    thump?.connect(out.g);
    // the crack of a supersonic round only exists up close
    if (dist < 90) {
      const crack = this.burst(0.05, table.crack, 2.5, table.gain * 0.6 * (1 - dist / 90), 'highpass');
      crack?.connect(out.g);
    }
    // tail: distant rolling echo
    if (dist > 25) {
      const tail = this.burst(0.9, 420, 0.7, 0.18 * (1 - dist / 400), 'lowpass', 0.06);
      tail?.connect(out.g);
    }
  }

  /** Suppressed crack / bullet snapping past. */
  whiz(pan: number) {
    if (!this.ctx) return;
    this.burst(0.09, 5200, 3, 0.22, 'bandpass')?.connect(this.panNode(pan));
    this.burst(0.16, 1800, 1.2, 0.1, 'bandpass', 0.02)?.connect(this.panNode(pan));
  }

  private panNode(pan: number) {
    const p = this.ctx!.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.master);
    return p;
  }

  impact(pan: number, metal = false) {
    if (!this.ctx) return;
    this.burst(metal ? 0.09 : 0.12, metal ? 2600 : 700, metal ? 4 : 1.4, 0.16, 'bandpass')?.connect(this.panNode(pan));
  }

  explosion(dist = 0, pan = 0) {
    if (!this.ctx) return;
    const out = this.chain(pan, dist, 600);
    if (!out) return;
    this.burst(1.4, 120, 0.6, 1.1, 'lowpass')?.connect(out.g);
    this.burst(0.5, 900, 0.8, 0.5, 'bandpass')?.connect(out.g);
  }

  /** Helicopter rotor: a low periodic whomp, used by the cutscene. */
  rotor(): { set: (rate: number, dist: number) => void; stop: () => void } | null {
    if (!this.ctx) return null;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 26;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    // amplitude modulation = the blade beat
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 17;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    const mod = ctx.createGain();
    mod.gain.value = 0.5;
    lfo.connect(lfoGain).connect(mod.gain);
    osc.connect(lp).connect(gain).connect(mod).connect(this.master);
    osc.start(); lfo.start();
    return {
      set: (rate: number, dist: number) => {
        osc.frequency.value = 22 + rate * 6;
        lfo.frequency.value = 14 + rate * 4;
        gain.gain.value = Math.max(0, 1 - dist / 220) * 0.16;
      },
      stop: () => { osc.stop(); lfo.stop(); },
    };
  }

  /** Distant artillery, far off the map edge — pure atmosphere. */
  distantShell() {
    if (!this.ctx) return;
    const out = this.chain(Math.random() * 2 - 1, 260, 400);
    if (!out) return;
    this.burst(1.8, 70, 0.5, 0.9, 'lowpass')?.connect(out.g);
    window.setTimeout(() => this.burst(2.2, 55, 0.5, 0.55, 'lowpass')?.connect(out.g), 420);
  }

  /** Ambient UI clicks. */
  ui(kind: 'click' | 'hover' | 'open' = 'click') {
    if (!this.ctx) return;
    const g = this.ctx.createGain();
    g.gain.value = kind === 'hover' ? 0.05 : 0.12;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    const t = this.ctx.currentTime;
    osc.frequency.setValueAtTime(kind === 'open' ? 220 : 620, t);
    osc.frequency.exponentialRampToValueAtTime(kind === 'open' ? 140 : 380, t + 0.09);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(g.gain.value, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(env).connect(this.master);
    osc.start(t); osc.stop(t + 0.12);
  }

  /** Heartbeat / low thrum while the squad is nearly dead. */
  heartbeat(intensity: number) {
    if (!this.ctx || intensity <= 0) return;
    const t = this.ctx.currentTime;
    for (const off of [0, 0.22]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(58, t + off);
      osc.frequency.exponentialRampToValueAtTime(38, t + off + 0.16);
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, t + off);
      env.gain.linearRampToValueAtTime(0.22 * intensity, t + off + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.2);
      osc.connect(env).connect(this.master);
      osc.start(t + off); osc.stop(t + off + 0.24);
    }
  }

  /** Wind picks up with the pressure of the fight. */
  setPressure(p: number) {
    if (!this.ctx || !this.wind) return;
    this.wind.gain.gain.value = 0.05 + p * 0.05;
    this.wind.filter.frequency.value = 380 + p * 260;
  }
}
