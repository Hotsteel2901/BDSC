/**
 * DnBEngine
 * ---------
 * A lookup-scheduled drum & bass sequencer. Every sound is synthesised live:
 * amen-style breaks (kick/snare/ghost/hats/ride/shaker), deep sub + reese basses,
 * filtered pads, plucky arps and one-shot FX. Tracks are declarative data with
 * per-track mood, key and patterns; a lookahead scheduler keeps timing tight.
 */

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];

/**
 * Song arrangement helpers. Every track is a complete ~3-minute piece built
 * from sections; the engine wraps back to the intro after the outro so endless
 * gameplay still works. Layer multipliers are 0..1, `riser` fires a noise sweep
 * on the section's last bar, `sub` enables the combat sub-pulse layer.
 */
const SEC = {
  intro: (bars, o = {}) => ({ name: 'INTRO', bars, drums: 0.55, hats: 0, bass: 0.7, pad: 1, arp: 0, sub: false, energy: 0.72, ...o }),
  build: (bars, o = {}) => ({ name: 'BUILD', bars, drums: 0.85, hats: 0.65, bass: 0.9, pad: 0.85, arp: 0, sub: false, energy: 0.92, riser: true, ...o }),
  drop1: (bars, o = {}) => ({ name: 'DROP 1', bars, drums: 1, hats: 1, bass: 1, pad: 0.9, arp: 1, sub: false, energy: 1.12, ...o }),
  break: (bars, o = {}) => ({ name: 'BREAKDOWN', bars, drums: 0, hats: 0.35, bass: 0.5, pad: 1.1, arp: 1, sub: false, energy: 0.85, riser: true, ...o }),
  drop2: (bars, o = {}) => ({ name: 'DROP 2', bars, drums: 1, hats: 1, bass: 1.05, pad: 0.9, arp: 1, sub: true, energy: 1.25, ...o }),
  outro: (bars, o = {}) => ({ name: 'OUTRO', bars, drums: 0.55, hats: 0.3, bass: 0.65, pad: 1, arp: 0.35, sub: false, energy: 0.75, ...o }),
};

export const TRACKS = [
  {
    id: 'neon',
    name: 'NEON DISTRICT',
    bpm: 174, root: 45, scale: MINOR, mood: 'dark rolling',
    kick:   [1,0,0,0, 0,0,1,0, 0,0,1,0, 0,1,0,0],
    snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],
    ghost:  [0,0,1,0, 0,0,0,1, 0,0,1,0, 0,1,0,0],
    hat:    [1,1,0,1, 1,0,0,1, 1,1,0,1, 1,0,0,1],
    open:   [0,0,0,0, 0,1,0,0, 0,0,0,0, 0,0,1,0],
    ride:   [0,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,0],
    shaker: [1,0,1,1, 1,0,1,1, 1,0,1,1, 1,0,1,1],
    progression: [[0,2,4],[0,2,4],[5,4,2],[3,4,6]].map(a=>a),
    bass:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 4,0,0,0],
    arp:    [0,4,7,12],
    padMix: 0.5, reeseMix: 0.9, subMix: 1.0,
    arrangement: [SEC.intro(8), SEC.build(16), SEC.drop1(32), SEC.break(20), SEC.drop2(32), SEC.outro(24)],
  },
  {
    id: 'substrate',
    name: 'SUBSTRATE',
    bpm: 172, root: 43, scale: DORIAN, mood: 'deep liquid',
    kick:   [1,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0],
    snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    ghost:  [0,0,0,1, 0,0,1,0, 0,0,1,0, 0,0,1,0],
    hat:    [1,0,1,1, 1,0,1,1, 1,0,1,1, 1,0,1,1],
    open:   [0,0,0,0, 0,0,0,0, 0,1,0,0, 0,0,1,0],
    ride:   [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1],
    shaker: [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1],
    progression: [[0,2,4],[3,2,4],[5,4,2],[4,2,0]],
    bass:   [0,0,0,0, 0,0,0,0, 2,0,0,0, 0,0,3,0],
    arp:    [0,4,7,11],
    padMix: 0.75, reeseMix: 0.6, subMix: 1.0,
    arrangement: [SEC.intro(12), SEC.build(16), SEC.drop1(28), SEC.break(24), SEC.drop2(28), SEC.outro(24)],
  },
  {
    id: 'overclock',
    name: 'OVERCLOCK',
    bpm: 176, root: 41, scale: PHRYGIAN, mood: 'neuro techstep',
    kick:   [1,0,0,0, 1,0,1,0, 0,0,1,0, 1,0,1,0],
    snare:  [0,0,0,0, 1,0,0,0, 0,0,0,1, 1,0,0,0],
    ghost:  [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1],
    hat:    [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    open:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    ride:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    shaker: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    progression: [[0,1,4],[0,1,4],[3,1,4],[0,1,6]],
    bass:   [0,0,0,3, 0,0,0,0, 0,0,1,0, 0,0,0,0],
    arp:    [0,1,4,7],
    padMix: 0.25, reeseMix: 1.0, subMix: 0.9,
    arrangement: [SEC.intro(8, { bass: 0.85 }), SEC.build(12), SEC.drop1(36), SEC.break(16), SEC.drop2(36), SEC.outro(24)],
  },
  {
    id: 'ghost',
    name: 'GHOST PROTOCOL',
    bpm: 170, root: 43, scale: MINOR, mood: 'atmospheric',
    kick:   [1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
    snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    ghost:  [0,0,1,0, 0,1,0,0, 0,1,0,0, 0,0,1,1],
    hat:    [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1],
    open:   [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1],
    ride:   [0,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
    shaker: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    progression: [[0,2,4],[4,2,0],[3,5,2],[4,2,6]],
    bass:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,4,0],
    arp:    [0,2,7,12],
    padMix: 1.0, reeseMix: 0.4, subMix: 0.85,
    arrangement: [SEC.intro(16, { drums: 0, bass: 0.55, energy: 0.68 }), SEC.build(16), SEC.drop1(24), SEC.break(32), SEC.drop2(24), SEC.outro(20)],
  },
  {
    id: 'ironrain',
    name: 'IRON RAIN',
    bpm: 175, root: 40, scale: MINOR, mood: 'jump-up hardstep',
    kick:   [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0],
    snare:  [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,0],
    ghost:  [0,1,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,1],
    hat:    [1,1,1,1, 0,1,1,0, 1,1,1,1, 0,1,1,0],
    open:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,1,0,0],
    ride:   [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
    shaker: [0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1],
    progression: [[0,1,4],[0,5,4],[3,1,4],[0,4,6]],
    bass:   [0,0,0,0, 0,0,0,5, 0,0,0,0, 3,0,0,0],
    arp:    [0,3,7,10],
    padMix: 0.35, reeseMix: 1.1, subMix: 1.1,
    arrangement: [SEC.intro(8, { drums: 0.7 }), SEC.build(16), SEC.drop1(32), SEC.break(16, { hats: 0.5 }), SEC.drop2(36, { energy: 1.32 }), SEC.outro(24)],
  },
  {
    id: 'ascension',
    name: 'ASCENSION',
    bpm: 174, root: 48, scale: MINOR, mood: 'euphoric melodic',
    kick:   [1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0],
    snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    ghost:  [0,0,1,0, 0,0,0,1, 0,1,0,0, 0,0,1,0],
    hat:    [1,0,1,1, 1,0,1,1, 1,0,1,1, 1,0,1,1],
    open:   [0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0],
    ride:   [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1],
    shaker: [0,1,0,0, 0,1,0,0, 0,1,0,0, 0,1,0,0],
    progression: [[0,4,7],[5,4,2],[3,5,7],[4,2,0]],
    bass:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    arp:    [0,4,7,12,16],
    padMix: 0.9, reeseMix: 0.5, subMix: 0.9,
    arrangement: [SEC.intro(12, { arp: 0.5, energy: 0.78 }), SEC.build(16, { arp: 0.6 }), SEC.drop1(32), SEC.break(20, { arp: 1.1, pad: 1.15 }), SEC.drop2(32), SEC.outro(20)],
  },
];

export class DnBEngine {
  constructor(audio) {
    this.audio = audio;
    this.ctx = audio.ctx;
    this.bus = audio.musicBus;
    this.track = TRACKS[0];
    this.playing = false;
    this.intensity = 1; // 0.5 ambient .. 1.4 combat
    this._step = 0;
    this._nextTime = 0;
    this._bar = 0;
    this._timer = null;
    this._lookahead = 0.12;
    this._interval = 25;
    this._masterGain = this.ctx.createGain();
    this._masterGain.gain.value = 1.0;
    this._masterGain.connect(this.bus);
    this.reverbSend2 = this.ctx.createGain();
    this.reverbSend2.gain.value = 0.2;
    this._masterGain.connect(this.reverbSend2);
    this.reverbSend2.connect(this.audio.reverbSend);
    this._noise = audio.noise;
    this._pink = audio.noisePink;
    this._riser = null;
    this._lastChord = null;
  }

  setTrack(idOrIndex) {
    let t = typeof idOrIndex === 'number' ? TRACKS[idOrIndex] : TRACKS.find(x => x.id === idOrIndex);
    if (!t) return;
    const wasPlaying = this.playing;
    this.stop();
    this.track = t;
    this._step = 0; this._bar = 0;
    if (wasPlaying) this.start();
    return t;
  }
  nextTrack() {
    const i = TRACKS.indexOf(this.track);
    return this.setTrack(TRACKS[(i + 1) % TRACKS.length].id);
  }

  get stepDuration() { return 60 / this.track.bpm / 4; } // 16th note

  start() {
    if (this.playing) return;
    this.playing = true;
    this._nextTime = this.ctx.currentTime + 0.06;
    this._timer = setInterval(() => this._schedule(), this._interval);
  }
  stop() {
    this.playing = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    if (this._riser) { try { this._riser.stop(); } catch (e) {} this._riser = null; }
  }
  setIntensity(v) { this.intensity = Math.max(0.4, Math.min(1.6, v)); }

  _schedule() {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    while (this._nextTime < now + this._lookahead) {
      this._playStep(this._step, this._nextTime);
      this._nextTime += this.stepDuration;
      this._step = (this._step + 1) % 64;
      if (this._step === 0) this._bar++;
    }
  }

  /** Section covering an absolute bar of the song (wraps after the outro). */
  sectionAt(bar) {
    const arr = this.track.arrangement;
    if (!arr || !arr.length) return { sec: { name: 'LOOP', bars: 1 }, idx: 0 };
    let total = 0;
    for (const s of arr) total += s.bars;
    let b = ((bar % total) + total) % total;
    for (const s of arr) {
      if (b < s.bars) return { sec: s, idx: b, total };
      b -= s.bars;
    }
    return { sec: arr[0], idx: 0, total };
  }

  _playStep(step, t) {
    const tk = this.track;
    const bar = Math.floor(step / 16);          // bar inside the 4-bar phrase
    const s16 = step % 16;
    const absBar = this._bar * 4 + bar;         // bar in the full arrangement
    const { sec, idx } = this.sectionAt(absBar);
    const I = Math.min(1.6, (sec.energy ?? 1) * this.intensity);
    const drumsV = sec.drums ?? 1;
    const hatsV = sec.hats ?? 1;
    const bassV = sec.bass ?? 1;
    const padV = sec.pad ?? 1;
    const arpV = sec.arp ?? 1;

    // drums
    if (tk.kick[s16] && drumsV > 0) this._kick(t, (s16 === 0 ? 1 : 0.9) * drumsV);
    if (tk.snare[s16] && drumsV > 0) this._snare(t, drumsV);
    if (tk.ghost[s16] && drumsV > 0) this._snare(t, 0.28 * drumsV, true);
    if (tk.hat[s16] && hatsV > 0) this._hat(t, (s16 % 2 === 0 ? 0.5 : 0.34) * hatsV);
    if (tk.open[s16] && hatsV > 0) this._openHat(t, hatsV);
    if (tk.ride[s16] && hatsV > 0) this._ride(t, hatsV);
    if (tk.shaker[s16] && hatsV > 0) this._shaker(t, hatsV);

    // fills at end of 4-bar phrase
    if ((step === 60 || step === 62) && drumsV > 0.5) this._snare(t, 0.6 * drumsV, true);

    // bass — one note per bar from the bass pattern
    const bassDeg = tk.bass[s16];
    if (bassV > 0 && ((bassDeg !== undefined && bassDeg !== 0) || (bassDeg === 0 && s16 === 0))) {
      const chord = tk.progression[bar % tk.progression.length];
      const deg = chord[0] + bassDeg;
      this._bass(t, this._degToFreq(deg - 12), tk, I, bassV);
    }

    // sub pulse / arps driven by the arrangement
    if (sec.sub && (s16 === 6 || s16 === 14)) {
      const chord = tk.progression[bar % tk.progression.length];
      this._sub(t, this._degToFreq(chord[0] - 24), 0.9);
    }

    // pad — sustained chord at the start of each bar
    if (padV > 0 && step % 16 === 0) {
      const chord = tk.progression[bar % tk.progression.length];
      this._chord(t, chord, tk, I, padV);
    }

    // arp
    if (arpV > 0 && step % 2 === 0) {
      const chord = tk.progression[bar % tk.progression.length];
      const aidx = Math.floor(step / 2) % tk.arp.length;
      const deg = chord[0] + tk.arp[aidx];
      this._pluck(t, this._degToFreq(deg + 12), I, arpV);
    }

    // riser / sweep on the last bar of a riser section
    if (sec.riser && idx === sec.bars - 1 && s16 === 0) this._startRiser(t, absBar);
  }

  _degToFreq(deg) {
    const scale = this.track.scale;
    const oct = Math.floor(deg / scale.length);
    const idx = ((deg % scale.length) + scale.length) % scale.length;
    const midi = this.track.root + scale[idx] + oct * 12;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // ---- voices ---------------------------------------------------------
  _out(t, gain, pan = 0) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let node = g;
    if (pan) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
    node.connect(this._masterGain);
    return g;
  }

  _kick(t, v = 1) {
    const g = this._out(t, 1.0 * v);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.0 * v, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.09);
    o.connect(g); o.start(t); o.stop(t + 0.3);
    // click
    const cg = this._out(t, 0.5 * v);
    cg.gain.setValueAtTime(0.6 * v, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    const c = this.ctx.createBufferSource(); c.buffer = this._noise; c.playbackRate.value = 2.0;
    const cf = this.ctx.createBiquadFilter(); cf.type='bandpass'; cf.frequency.value=2600; cf.Q.value=1.2;
    c.connect(cf); cf.connect(cg); c.start(t); c.stop(t + 0.03);
  }

  _snare(t, v = 1, ghost = false) {
    const g = this._out(t, 0.8 * v);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * v, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (ghost ? 0.09 : 0.18));
    const n = this.ctx.createBufferSource(); n.buffer = this._noise; n.playbackRate.value = 1.0;
    const nf = this.ctx.createBiquadFilter(); nf.type='bandpass'; nf.frequency.value = ghost?2400:1700; nf.Q.value=0.8;
    n.connect(nf); nf.connect(g); n.start(t); n.stop(t + 0.2);
    if (!ghost) {
      const tg = this._out(t, 0.5 * v);
      tg.gain.setValueAtTime(0.0001, t);
      tg.gain.exponentialRampToValueAtTime(0.6*v, t+0.001);
      tg.gain.exponentialRampToValueAtTime(0.0001, t+0.1);
      const o1 = this.ctx.createOscillator(); o1.type='triangle'; o1.frequency.setValueAtTime(220,t); o1.frequency.exponentialRampToValueAtTime(160,t+0.1);
      const o2 = this.ctx.createOscillator(); o2.type='triangle'; o2.frequency.setValueAtTime(330,t); o2.frequency.exponentialRampToValueAtTime(240,t+0.1);
      o1.connect(tg); o2.connect(tg); o1.start(t);o1.stop(t+0.12);o2.start(t);o2.stop(t+0.12);
    }
  }

  _hat(t, v = 1) {
    const g = this._out(t, 0.22 * v, (Math.random() - 0.5) * 0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.24 * v, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    const n = this.ctx.createBufferSource(); n.buffer = this._noise; n.playbackRate.value = 1.6;
    const f = this.ctx.createBiquadFilter(); f.type='highpass'; f.frequency.value=7500;
    n.connect(f); f.connect(g); n.start(t); n.stop(t + 0.06);
  }
  _openHat(t, v = 1) {
    const g = this._out(t, 0.18 * v, 0.2);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2 * v, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    const n = this.ctx.createBufferSource(); n.buffer = this._noise; n.playbackRate.value = 1.4;
    const f = this.ctx.createBiquadFilter(); f.type='highpass'; f.frequency.value=6500;
    n.connect(f); f.connect(g); n.start(t); n.stop(t + 0.35);
  }
  _ride(t, v = 1) {
    const g = this._out(t, 0.12 * v, -0.2);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14 * v, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    const n = this.ctx.createBufferSource(); n.buffer = this._noise; n.playbackRate.value = 1.2;
    const f = this.ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=9000; f.Q.value=1.5;
    n.connect(f); f.connect(g); n.start(t); n.stop(t + 0.5);
  }
  _shaker(t, v = 1) {
    const g = this._out(t, 0.09 * v, (Math.random()-0.5)*0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1 * v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    const n = this.ctx.createBufferSource(); n.buffer = this._noise; n.playbackRate.value = 1.9;
    const f = this.ctx.createBiquadFilter(); f.type='highpass'; f.frequency.value=5500;
    n.connect(f); f.connect(g); n.start(t); n.stop(t + 0.07);
  }

  _sub(t, freq, v = 1) {
    const g = this._out(t, 0.9 * v);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.9 * v, t + 0.02);
    g.gain.setValueAtTime(0.9 * v, t + 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    const o = this.ctx.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(freq, t);
    o.connect(g); o.start(t); o.stop(t + 0.34);
  }

  _bass(t, freq, tk, I, v = 1) {
    // sub layer
    this._sub(t, freq, tk.subMix * 0.9 * v);
    // reese layer: two detuned saws, lowpassed, short
    const g = this._out(t, 0.5 * tk.reeseMix * Math.min(1.4, I) * v, 0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    const lp = this.ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(240, t + 0.3); lp.Q.value = 6;
    const o1 = this.ctx.createOscillator(); o1.type='sawtooth'; o1.frequency.value = freq * 2;
    const o2 = this.ctx.createOscillator(); o2.type='sawtooth'; o2.frequency.value = freq * 2; o2.detune.value = 14;
    const o3 = this.ctx.createOscillator(); o3.type='square'; o3.frequency.value = freq; o3.detune.value = -8;
    o1.connect(lp); o2.connect(lp); o3.connect(lp); lp.connect(g);
    o1.start(t);o2.start(t);o3.start(t); 
    o1.stop(t+0.34);o2.stop(t+0.34);o3.stop(t+0.34);
  }

  _chord(t, degrees, tk, I, v = 1) {
    const dur = this.stepDuration * 16 * 1.05;
    const g = this._out(t, 0.09 * tk.padMix * Math.min(1.3, I) * v, 0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.1 * tk.padMix * v, t + 0.5);
    g.gain.setValueAtTime(0.1 * tk.padMix * v, t + dur - 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = this.ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value = 2200; lp.Q.value = 1.2;
    lp.connect(g);
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 900;
    lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start(t); lfo.stop(t + dur);
    degrees.forEach((d, i) => {
      const f = this._degToFreq(d + 12);
      for (const det of [-6, 6]) {
        const o = this.ctx.createOscillator(); o.type='sawtooth'; o.frequency.value = f; o.detune.value = det + (i*3);
        const vg = this.ctx.createGain(); vg.gain.value = 0.4;
        o.connect(vg); vg.connect(lp); o.start(t); o.stop(t + dur);
      }
    });
  }

  _pluck(t, freq, I, v = 1) {
    const g = this._out(t, 0.08 * Math.min(1.2, I) * v);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    const lp = this.ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.setValueAtTime(6000, t);
    lp.frequency.exponentialRampToValueAtTime(1500, t + 0.2); lp.Q.value = 3;
    const o = this.ctx.createOscillator(); o.type='square'; o.frequency.value = freq;
    o.connect(lp); lp.connect(g); o.start(t); o.stop(t + 0.24);
  }

  _startRiser(t, bar) {
    if (this._riser) { try { this._riser.stop(t); } catch (e) {} }
    const dur = this.stepDuration * 16;
    const g = this._out(t, 0.0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.14, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
    const n = this.ctx.createBufferSource(); n.buffer = this._pink; n.loop = true;
    const bp = this.ctx.createBiquadFilter(); bp.type='bandpass'; bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(9000, t + dur);
    n.connect(bp); bp.connect(g); n.start(t); n.stop(t + dur + 0.35);
    this._riser = n;
  }
}
