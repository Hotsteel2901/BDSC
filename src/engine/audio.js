/**
 * AudioEngine
 * -----------
 * A fully procedural audio system built on the Web Audio API. No sample files:
 * every weapon report, impact, footstep, explosion and UI blip is synthesised at
 * runtime. Provides a routed mixer (sfx / music / ui), a convolution reverb built
 * from a generated impulse response, a compressor bus, and simple ducking so the
 * soundtrack breathes under heavy combat.
 */
export class AudioEngine {
  constructor() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    this.ready = false;
    this.masterVol = 0.85;
    this.sfxVol = 0.9;
    this.musicVol = 0.7;
    this.uiVol = 0.8;

    // master chain
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVol;
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.knee.value = 22;
    this.compressor.ratio.value = 4.5;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.22;
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.master.connect(this.compressor);
    this.compressor.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);

    // buses
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVol;
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicVol;
    this.uiBus = this.ctx.createGain();
    this.uiBus.gain.value = this.uiVol;

    // reverb
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(2.6, 2.4);
    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = 0.22;
    this.reverbOut = this.ctx.createGain();
    this.reverbOut.gain.value = 1.0;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.reverbOut);

    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.uiBus.connect(this.master);
    this.sfxBus.connect(this.reverbSend);
    this.musicBus.connect(this.reverbSend);
    this.reverbOut.connect(this.master);

    this.noise = this._makeNoise(2.0);
    this.noisePink = this._makePinkNoise(2.0);

    this._ambience = null;
    this.ready = true;
  }

  resume() {
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolumes({ master, sfx, music, ui }) {
    if (master != null) { this.masterVol = master; this.master.gain.value = master; }
    if (sfx != null) { this.sfxVol = sfx; this.sfxBus.gain.value = sfx; }
    if (music != null) { this.musicVol = music; this.musicBus.gain.value = music; }
    if (ui != null) { this.uiVol = ui; this.uiBus.gain.value = ui; }
  }

  duckMusic(amount = 0.45, time = 0.5) {
    const now = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(now);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, now);
    this.musicBus.gain.linearRampToValueAtTime(Math.max(0.05, this.musicVol * (1 - amount)), now + 0.08);
    this.musicBus.gain.linearRampToValueAtTime(this.musicVol, now + time);
  }

  // ---- buffer helpers -------------------------------------------------
  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  _makePinkNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886*b0 + w*0.0555179; b1 = 0.99332*b1 + w*0.0750759;
      b2 = 0.96900*b2 + w*0.1538520; b3 = 0.86650*b3 + w*0.3104856;
      b4 = 0.55000*b4 + w*0.5329522; b5 = -0.7616*b5 - w*0.0168980;
      d[i] = (b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11;
      b6 = w*0.115926;
    }
    return buf;
  }
  _makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  _env(gainNode, t0, a, d, peak, sus, rel, dur) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak * sus), t0 + a + d);
    g.setValueAtTime(Math.max(0.0002, peak * sus), t0 + Math.max(a + d, dur));
    g.exponentialRampToValueAtTime(0.0001, t0 + Math.max(a + d, dur) + rel);
  }

  // ---- primitives -----------------------------------------------------
  _osc(type, freq, t0, dur, gainNode, { detune = 0, glideTo = null } = {}) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (glideTo != null) o.frequency.exponentialRampToValueAtTime(Math.max(0.01, glideTo), t0 + dur);
    if (detune) o.detune.value = detune;
    o.connect(gainNode);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  _noiseSrc(buffer, t0, dur, playbackRate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.playbackRate.value = playbackRate;
    s.start(t0);
    s.stop(t0 + dur + 0.05);
    return s;
  }

  _filter(type, freq, q = 1) {
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  }

  _out(bus, gain = 1, pan = 0) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let node = g;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p); node = p;
    }
    node.connect(bus);
    return g;
  }

  // ---- weapon sfx -----------------------------------------------------
  gunshot(kind = 'rifle', distance = 0) {
    const t0 = this.ctx.currentTime;
    const bus = this.sfxBus;
    const gain = 1 / (1 + distance * 0.008);
    const cfg = {
      pistol:   { f: 260, dur: 0.16, nf: 2400, ng: 0.7, body: 180 },
      rifle:    { f: 190, dur: 0.20, nf: 3000, ng: 0.85, body: 140 },
      smg:      { f: 300, dur: 0.10, nf: 3600, ng: 0.55, body: 220 },
      shotgun:  { f: 120, dur: 0.34, nf: 1700, ng: 1.05, body: 90 },
      sniper:   { f: 150, dur: 0.40, nf: 2100, ng: 1.0, body: 110 },
      plasma:   { f: 520, dur: 0.22, nf: 4200, ng: 0.5, body: 320 },
      turret:   { f: 220, dur: 0.14, nf: 2600, ng: 0.6, body: 160 },
    }[kind] || { f: 220, dur: 0.18, nf: 2800, ng: 0.7, body: 150 };

    // transient click
    const clickG = this._out(bus, 0.5 * gain);
    this._noiseSrc(this.noise, t0, 0.012).connect(this._filter('highpass', 4000, 1).connect(clickG));

    // body thump
    const bodyG = this._out(bus, 0.9 * gain);
    this._env(bodyG, t0, 0.001, 0.03, 1, 0.4, cfg.dur, cfg.dur * 0.4);
    this._osc('sine', cfg.body, t0, cfg.dur * 0.6, bodyG, { glideTo: cfg.body * 0.4 });
    this._osc('triangle', cfg.body * 1.5, t0, cfg.dur * 0.5, bodyG, { glideTo: cfg.body * 0.6 });

    // blast noise
    const nG = this._out(bus, cfg.ng * gain);
    this._env(nG, t0, 0.001, 0.02, 1, 0.25, cfg.dur, cfg.dur);
    const nf = this._filter('bandpass', cfg.nf, 0.8);
    const src = this._noiseSrc(this.noise, t0, cfg.dur + 0.05, 1.4);
    src.connect(nf); nf.connect(nG);

    // tail
    const tailG = this._out(bus, 0.25 * gain);
    this._env(tailG, t0 + 0.02, 0.02, 0.08, 1, 0.1, cfg.dur * 2, cfg.dur * 2);
    this._noiseSrc(this.noisePink, t0 + 0.02, cfg.dur * 2 + 0.1, 1).connect(this._filter('lowpass', 1200).connect(tailG));
  }

  dryFire() {
    const t0 = this.ctx.currentTime;
    const g = this._out(this.sfxBus, 0.4);
    this._env(g, t0, 0.001, 0.01, 1, 0.1, 0.03, 0.02);
    this._noiseSrc(this.noise, t0, 0.05).connect(this._filter('highpass', 2500, 2).connect(g));
  }

  reload(stage = 0) {
    const t0 = this.ctx.currentTime + stage * 0.12;
    const g = this._out(this.sfxBus, 0.5);
    const f = this._filter('bandpass', stage % 2 ? 1400 : 3200, 4);
    this._noiseSrc(this.noise, t0, 0.09).connect(f.connect(g));
    this._env(g, t0, 0.001, 0.02, 1, 0.15, 0.1, 0.08);
    const g2 = this._out(this.sfxBus, 0.35);
    this._osc('square', stage % 2 ? 220 : 330, t0, 0.06, g2, { glideTo: 120 });
    this._env(g2, t0, 0.001, 0.02, 0.6, 0.1, 0.06, 0.05);
  }

  shellDrop() {
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const tt = t0 + i * 0.09 + Math.random() * 0.03;
      const g = this._out(this.sfxBus, 0.22);
      this._osc('triangle', 1800 + Math.random() * 900, tt, 0.09, g, { glideTo: 700 });
      this._env(g, tt, 0.001, 0.01, 0.8, 0.05, 0.09, 0.07);
    }
  }

  // ---- impact / damage ------------------------------------------------
  impact(surface = 'concrete', distance = 0) {
    const t0 = this.ctx.currentTime;
    const gain = 1 / (1 + distance * 0.01);
    const cfg = {
      concrete: { f: 900, q: 1.6, dur: 0.14, tone: 300 },
      metal:    { f: 2600, q: 6, dur: 0.22, tone: 1400 },
      glass:    { f: 5200, q: 3, dur: 0.18, tone: 3600 },
      wood:     { f: 700, q: 2, dur: 0.12, tone: 250 },
      flesh:    { f: 380, q: 1, dur: 0.10, tone: 180 },
      dirt:     { f: 500, q: 1, dur: 0.10, tone: 160 },
      shield:   { f: 3000, q: 8, dur: 0.20, tone: 2200 },
    }[surface] || { f: 900, q: 1.5, dur: 0.12, tone: 300 };
    const g = this._out(this.sfxBus, 0.55 * gain);
    this._env(g, t0, 0.001, 0.01, 1, 0.15, cfg.dur, cfg.dur);
    this._noiseSrc(this.noise, t0, cfg.dur + 0.03).connect(this._filter('bandpass', cfg.f, cfg.q).connect(g));
    const tg = this._out(this.sfxBus, 0.3 * gain);
    this._osc(surface === 'metal' ? 'square' : 'triangle', cfg.tone, t0, cfg.dur, tg, { glideTo: cfg.tone * 0.5 });
    this._env(tg, t0, 0.001, 0.01, 0.7, 0.1, cfg.dur, cfg.dur);
  }

  hurt(severity = 1) {
    const t0 = this.ctx.currentTime;
    const g = this._out(this.sfxBus, 0.6);
    this._env(g, t0, 0.001, 0.02, 1, 0.3, 0.2, 0.18);
    this._osc('sawtooth', 160, t0, 0.22, g, { glideTo: 70 });
    const g2 = this._out(this.sfxBus, 0.3);
    this._env(g2, t0, 0.001, 0.02, 0.8, 0.2, 0.15, 0.14);
    this._noiseSrc(this.noisePink, t0, 0.2).connect(this._filter('lowpass', 900).connect(g2));
  }

  headshot() {
    const t0 = this.ctx.currentTime;
    const g = this._out(this.sfxBus, 0.6);
    this._env(g, t0, 0.001, 0.01, 1, 0.2, 0.14, 0.12);
    this._osc('square', 1400, t0, 0.12, g, { glideTo: 600 });
    this._osc('sine', 2400, t0, 0.10, g, { glideTo: 900 });
  }

  killConfirm() {
    const t0 = this.ctx.currentTime;
    [660, 990, 1480].forEach((f, i) => {
      const g = this._out(this.uiBus, 0.28);
      this._env(g, t0 + i * 0.05, 0.002, 0.02, 1, 0.4, 0.14, 0.12);
      this._osc('triangle', f, t0 + i * 0.05, 0.16, g);
    });
  }

  enemyDeath(kind = 'grunt') {
    const t0 = this.ctx.currentTime;
    const g = this._out(this.sfxBus, 0.55);
    this._env(g, t0, 0.005, 0.05, 1, 0.2, 0.4, 0.38);
    this._osc('sawtooth', 220, t0, 0.4, g, { glideTo: 40 });
    const g2 = this._out(this.sfxBus, 0.35);
    this._env(g2, t0, 0.003, 0.03, 1, 0.2, 0.3, 0.28);
    this._noiseSrc(this.noise, t0, 0.35).connect(this._filter('lowpass', 1400, 2).connect(g2));
    // small digital "power down" arp for robots
    if (kind === 'drone' || kind === 'turret' || kind === 'robot') {
      [900, 700, 520, 360].forEach((f, i) => {
        const gg = this._out(this.sfxBus, 0.2);
        this._env(gg, t0 + i * 0.06, 0.001, 0.02, 0.8, 0.2, 0.1, 0.09);
        this._osc('square', f, t0 + i * 0.06, 0.12, gg);
      });
    }
  }

  // ---- melee (sword) ---------------------------------------------------
  swordSwing(variant = 0) {
    const t0 = this.ctx.currentTime;
    // whoosh: bandpassed noise sweeping up then down (the blade slicing air)
    const g = this._out(this.sfxBus, 0.55);
    this._env(g, t0, 0.015, 0.05, 1, 0.4, 0.14, 0.12);
    const base = variant === 1 ? 700 : variant === 2 ? 1100 : 900;
    const bp = this._filter('bandpass', base, 5);
    bp.frequency.setValueAtTime(base * 0.5, t0);
    bp.frequency.exponentialRampToValueAtTime(base * 3.2, t0 + 0.11);
    bp.frequency.exponentialRampToValueAtTime(base * 0.6, t0 + 0.30);
    this._noiseSrc(this.noise, t0, 0.34, 1.25).connect(bp);
    bp.connect(g);
    // metallic edge shimmer
    const g2 = this._out(this.sfxBus, 0.14);
    this._env(g2, t0 + 0.03, 0.005, 0.02, 0.8, 0.2, 0.16, 0.14);
    this._osc('triangle', 2200 + variant * 300, t0 + 0.03, 0.18, g2, { glideTo: 900 + variant * 200 });
  }

  /** Blade biting flesh/armour — the satisfying "chop" transient. */
  swordHit(kind = 'flesh', power = 1) {
    const t0 = this.ctx.currentTime;
    // sharp attack transient
    const click = this._out(this.sfxBus, 0.5 * power);
    this._env(click, t0, 0.001, 0.006, 1, 0.2, 0.05, 0.04);
    this._noiseSrc(this.noise, t0, 0.06).connect(this._filter('highpass', 3500, 1).connect(click));
    if (kind === 'head') {
      const g = this._out(this.sfxBus, 0.7);
      this._env(g, t0, 0.001, 0.02, 1, 0.2, 0.18, 0.16);
      this._osc('square', 1500, t0, 0.14, g, { glideTo: 480 });
      this._noiseSrc(this.noise, t0, 0.14).connect(this._filter('bandpass', 2600, 3).connect(g));
    }
    // wet body + crunch
    const body = this._out(this.sfxBus, 0.6 * power);
    this._env(body, t0, 0.001, 0.015, 1, 0.25, 0.16, 0.14);
    this._osc('sawtooth', 250, t0, 0.16, body, { glideTo: 85 });
    this._noiseSrc(this.noisePink, t0, 0.2).connect(this._filter('lowpass', 1200, 1).connect(body));
    // metallic ring (blade resonance)
    const ring = this._out(this.sfxBus, 0.22 * power);
    this._env(ring, t0, 0.001, 0.01, 0.8, 0.15, 0.22, 0.2);
    this._osc('triangle', 3200, t0, 0.24, ring, { glideTo: 1600 });
    this._osc('triangle', 4780, t0, 0.22, ring, { glideTo: 2400 });
  }

  /** Air swing that connects with nothing. */
  swordMiss() {
    const t0 = this.ctx.currentTime;
    const g = this._out(this.sfxBus, 0.2);
    this._env(g, t0, 0.01, 0.03, 1, 0.3, 0.10, 0.09);
    this._noiseSrc(this.noise, t0, 0.14, 1.4).connect(this._filter('bandpass', 2200, 4).connect(g));
  }

  /** Big finishing sting for a melee kill. */
  swordKill() {
    const t0 = this.ctx.currentTime;
    const g = this._out(this.sfxBus, 0.8);
    this._env(g, t0, 0.002, 0.05, 1, 0.25, 0.5, 0.45);
    this._osc('sine', 150, t0, 0.5, g, { glideTo: 40 });
    const g2 = this._out(this.sfxBus, 0.32);
    this._env(g2, t0, 0.001, 0.02, 1, 0.2, 0.3, 0.28);
    this._noiseSrc(this.noise, t0, 0.3).connect(this._filter('lowpass', 1600, 2).connect(g2));
    [1180, 1760, 2640].forEach((f, i) => {
      const gg = this._out(this.sfxBus, 0.18);
      this._env(gg, t0 + i * 0.04, 0.001, 0.01, 0.8, 0.2, 0.12, 0.11);
      this._osc('triangle', f, t0 + i * 0.04, 0.16, gg, { glideTo: f * 0.6 });
    });
  }

  explosion(scale = 1) {
    const t0 = this.ctx.currentTime;
    const g = this._out(this.sfxBus, 0.9 * scale);
    this._env(g, t0, 0.001, 0.04, 1, 0.35, 0.7 * scale, 0.7 * scale);
    this._osc('sine', 90, t0, 0.6 * scale, g, { glideTo: 28 });
    const g2 = this._out(this.sfxBus, 0.8 * scale);
    this._env(g2, t0, 0.001, 0.03, 1, 0.2, 0.5 * scale, 0.6 * scale);
    this._noiseSrc(this.noise, t0, 0.9 * scale, 0.6).connect(this._filter('lowpass', 2200, 1).connect(g2));
    const g3 = this._out(this.sfxBus, 0.4 * scale);
    this._env(g3, t0, 0.001, 0.02, 1, 0.1, 0.25, 0.5);
    this._noiseSrc(this.noisePink, t0, 1.2 * scale).connect(this._filter('highpass', 3000).connect(g3));
    // debris
    for (let i = 0; i < 5; i++) {
      const tt = t0 + 0.15 + Math.random() * 0.5 * scale;
      const gg = this._out(this.sfxBus, 0.1 * scale);
      this._osc('triangle', 400 + Math.random() * 1200, tt, 0.1, gg, { glideTo: 200 });
      this._env(gg, tt, 0.001, 0.01, 0.6, 0.1, 0.12, 0.1);
    }
  }

  grenadeBounce() {
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const g = this._out(this.sfxBus, 0.25);
      this._osc('square', 700 - i * 200, t0 + i * 0.12, 0.07, g, { glideTo: 300 });
      this._env(g, t0 + i * 0.12, 0.001, 0.01, 0.6, 0.05, 0.07, 0.06);
    }
  }

  // ---- movement -------------------------------------------------------
  footstep(surface = 'concrete', hard = false) {
    const t0 = this.ctx.currentTime;
    const cfg = {
      concrete: { f: 800, dur: 0.08, tone: 120 },
      metal: { f: 2200, dur: 0.12, tone: 400 },
      dirt: { f: 500, dur: 0.07, tone: 90 },
      grass: { f: 1600, dur: 0.09, tone: 130 },
      wood: { f: 700, dur: 0.09, tone: 160 },
    }[surface] || { f: 800, dur: 0.08, tone: 120 };
    const g = this._out(this.sfxBus, hard ? 0.32 : 0.18);
    this._env(g, t0, 0.001, 0.008, 1, 0.1, cfg.dur, cfg.dur);
    this._noiseSrc(this.noise, t0, cfg.dur + 0.02, 1).connect(this._filter('bandpass', cfg.f, 1.2).connect(g));
    const tg = this._out(this.sfxBus, hard ? 0.18 : 0.1);
    this._osc('triangle', cfg.tone, t0, cfg.dur, tg, { glideTo: cfg.tone * 0.6 });
    this._env(tg, t0, 0.001, 0.008, 0.7, 0.1, cfg.dur, cfg.dur);
  }

  jump() {
    const t0 = this.ctx.currentTime;
    const g = this._out(this.sfxBus, 0.25);
    this._env(g, t0, 0.002, 0.02, 1, 0.2, 0.1, 0.08);
    this._noiseSrc(this.noisePink, t0, 0.12).connect(this._filter('lowpass', 1400).connect(g));
  }
  land(hard = false) {
    const t0 = this.ctx.currentTime;
    const g = this._out(this.sfxBus, hard ? 0.5 : 0.3);
    this._env(g, t0, 0.001, 0.02, 1, 0.15, 0.16, 0.14);
    this._osc('sine', hard ? 110 : 150, t0, 0.18, g, { glideTo: 60 });
    this._noiseSrc(this.noise, t0, 0.16).connect(this._filter('bandpass', 900, 1).connect(g));
  }

  // ---- UI / pickups / misc -------------------------------------------
  uiClick() { this._blip(880, 0.05, 0.2, 'square'); }
  uiHover() { this._blip(1320, 0.03, 0.10, 'triangle'); }
  uiError() { this._blip(180, 0.16, 0.3, 'sawtooth'); }
  _blip(f, dur, gain, type) {
    const t0 = this.ctx.currentTime;
    const g = this._out(this.uiBus, gain);
    this._env(g, t0, 0.001, 0.01, 1, 0.3, dur, dur);
    this._osc(type, f, t0, dur, g);
  }

  pickup(kind = 'ammo') {
    const t0 = this.ctx.currentTime;
    const notes = kind === 'health' ? [523, 659, 784] : kind === 'armor' ? [392, 523, 659] : [880, 1175];
    notes.forEach((f, i) => {
      const g = this._out(this.uiBus, 0.25);
      this._env(g, t0 + i * 0.06, 0.002, 0.02, 1, 0.4, 0.16, 0.14);
      this._osc('triangle', f, t0 + i * 0.06, 0.18, g);
    });
  }

  alarm() {
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const g = this._out(this.sfxBus, 0.28);
      const tt = t0 + i * 0.28;
      this._osc('sawtooth', 440, tt, 0.26, g, { glideTo: 880 });
      this._osc('sawtooth', 452, tt, 0.26, g, { glideTo: 892 });
      this._env(g, tt, 0.01, 0.05, 0.8, 0.7, 0.26, 0.05);
    }
  }

  radio() {
    const t0 = this.ctx.currentTime;
    const g = this._out(this.sfxBus, 0.16);
    this._noiseSrc(this.noise, t0, 0.25, 1).connect(this._filter('bandpass', 1800, 1.5).connect(g));
    this._env(g, t0, 0.005, 0.02, 1, 0.6, 0.25, 0.1);
  }

  spawnWarp() {
    const t0 = this.ctx.currentTime;
    const g = this._out(this.sfxBus, 0.4);
    this._env(g, t0, 0.3, 0.1, 1, 0.4, 0.5, 0.5);
    this._osc('sawtooth', 80, t0, 0.8, g, { glideTo: 900 });
    const g2 = this._out(this.sfxBus, 0.25);
    this._env(g2, t0, 0.3, 0.1, 1, 0.3, 0.4, 0.5);
    this._osc('square', 120, t0, 0.8, g2, { glideTo: 1400 });
  }

  lowHealth() {
    const t0 = this.ctx.currentTime;
    const g = this._out(this.sfxBus, 0.3);
    this._env(g, t0, 0.01, 0.1, 1, 0.5, 0.5, 0.4);
    this._osc('sine', 60, t0, 0.7, g);
    this._osc('sine', 61.5, t0, 0.7, g);
  }

  // ---- ambience -------------------------------------------------------
  startAmbience() {
    if (this._ambience) return;
    const t0 = this.ctx.currentTime;
    const g = this._out(this.sfxBus, 0.10);
    // low city rumble
    const rumble = this.ctx.createBufferSource();
    rumble.buffer = this.noisePink; rumble.loop = true;
    const lp = this._filter('lowpass', 140, 0.7);
    rumble.connect(lp); lp.connect(g);
    rumble.start(t0);
    // wind
    const windG = this._out(this.sfxBus, 0.05);
    const wind = this.ctx.createBufferSource();
    wind.buffer = this.noisePink; wind.loop = true;
    const bp = this._filter('bandpass', 600, 0.6);
    wind.connect(bp); bp.connect(windG);
    wind.start(t0);
    // slow LFO on wind
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 0.04;
    lfo.connect(lfoG); lfoG.connect(windG.gain);
    lfo.start(t0);
    this._ambience = { rumble, wind, lfo, g, windG };
  }
  stopAmbience() {
    if (!this._ambience) return;
    try { this._ambience.rumble.stop(); this._ambience.wind.stop(); this._ambience.lfo.stop(); } catch (e) {}
    this._ambience = null;
  }

  /** Spatial helper: convert a world position relative to camera into gain/pan. */
  spatial(pos, camPos, dir) {
    const dx = pos.x - camPos.x, dy = pos.y - camPos.y, dz = pos.z - camPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let pan = 0;
    if (dist > 0.001 && dir) {
      const rx = dz, rz = -dx;
      const rl = Math.hypot(rx, rz) || 1;
      pan = Math.max(-1, Math.min(1, (rx / rl) * 1));
    }
    return { dist, gain: 1 / (1 + dist * 0.01), pan };
  }
}
