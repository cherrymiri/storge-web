import { noteToFreq } from './melodyTools.js';

const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// 0.1 s of silence (8 kHz mono WAV) — keeps iOS in "playback" mode so the silent switch does not mute the music box
const SILENCE = 'data:audio/wav;base64,' + btoa(String.fromCharCode(82,73,70,70,36,6,0,0,87,65,86,69,102,109,116,32,16,0,0,0,1,0,1,0,64,31,0,0,64,31,0,0,1,0,8,0,100,97,116,97,0,6,0,0) + String.fromCharCode(128).repeat(1536));

/**
 * Web Audio music-box synth. No audio files: each note is a few decaying partials
 * (comb-tine like) plus a tiny pluck transient, through a soft generated reverb.
 * The AudioContext is only created/resumed on the visitor's first gesture.
 */
export class AudioEngine {
  constructor(theme) {
    this.theme = theme;
    this.ctx = null;
    this.stepIndex = 0;
    this.volume = 0.7;
    this.muted = false;
    this.notesPlayed = 0;     // exposed for tests
  }

  /** must be called from inside a user-gesture handler */
  /**
   * Start (or restart) sound. `gesture` = called from a real click / tap / key, the only moments
   * Safari and Chrome allow sound to start; a wheel calls it with gesture = false (that only works
   * where the browser already allows sound, e.g. the Claude app or an "allow auto-play" setting).
   */
  unlock(gesture = true) {
    // Safari can leave a context that was created outside a gesture stuck: inside a real gesture,
    // replace it with a fresh one
    if (this.ctx && gesture && this.ctx.state !== 'running' && this._noGesture) {
      try { this.ctx.close(); } catch { /* already closed */ }
      this.ctx = null;
    }
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this._noGesture = !gesture;
      this.buildGraph();
      this.ctx.addEventListener?.('statechange', () => this.onState?.(this.ctx?.state));
    }
    if (IOS) {
      // iPhone / iPad: with the side switch on silent, Web Audio is muted unless the page asks for
      // "playback" audio (Safari 16.4+), or — older iOS — a media element is playing
      try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
      if (gesture && !this._keepAlive) {
        this._keepAlive = new Audio(SILENCE);
        this._keepAlive.loop = true; this._keepAlive.setAttribute('playsinline', '');
        this._keepAlive.play().catch(() => { this._keepAlive = null; });
      }
    }
    // 'suspended' (Chrome / Safari before a gesture) or 'interrupted' (Safari): ask to run
    if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().then(() => this.onState?.(this.ctx?.state), () => {});
  }

  buildGraph() {
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.25;
    const tone = c.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = 7200; tone.Q.value = 0.3;

    this.dry = c.createGain(); this.dry.gain.value = 0.82;
    this.wet = c.createGain(); this.wet.gain.value = 0.3;
    const verb = c.createConvolver();
    verb.buffer = this.makeImpulse(2.4, 2.6);

    this.bus = c.createGain();
    this.bus.connect(this.dry); this.bus.connect(verb); verb.connect(this.wet);
    this.dry.connect(tone); this.wet.connect(tone);
    tone.connect(comp); comp.connect(this.master); this.master.connect(c.destination);
    // music notes go through their own gain, so they can be cut at the break
    this.musicBus = c.createGain(); this.musicBus.connect(this.bus);
    // effects (the break) bypass the reverb: short and clear
    this.sfx = c.createGain(); this.sfx.gain.value = 1; this.sfx.connect(comp);

    // shared noise buffer for the pluck click
    const n = c.createBuffer(1, Math.floor(c.sampleRate * 0.03), c.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    this.click = n;
  }

  makeImpulse(seconds, decay) {
    const c = this.ctx, len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /** one music-box tine */
  pluck(freq, when, vel = 0.8) {
    const c = this.ctx;
    // [frequency ratio, amplitude, decay seconds]
    const partials = [[1, 1.0, 2.2], [2, 0.22, 1.1], [3.01, 0.07, 0.55], [4.13, 0.06, 0.32], [6.27, 0.035, 0.16]];
    const scale = Math.min(1, 520 / freq) * 0.5 + 0.5;        // higher notes ring a bit shorter
    for (const [ratio, amp, dec] of partials) {
      const f = freq * ratio;
      if (f > 15000) continue;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = c.createGain();
      const peak = 0.16 * vel * amp;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(peak, when + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dec * scale);
      o.connect(g); g.connect(this.musicBus);
      o.start(when); o.stop(when + dec * scale + 0.05);
    }
    const s = c.createBufferSource();
    s.buffer = this.click;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3800;
    const cg = c.createGain(); cg.gain.value = 0.035 * vel;
    s.connect(hp); hp.connect(cg); cg.connect(this.musicBus);
    s.start(when);
  }

  /** advance the theme by one step (called by the crank) */
  playNextStep() {
    if (this.musicStopped) return this.stepIndex;      // after the break the music box is silent
    const t = this.theme;
    const step = t.steps[this.stepIndex % t.steps.length];
    const index = this.stepIndex;
    if (step.note) { (this.playedLog ||= []).push({ theme: t.id, note: step.note, t: performance.now() / 1000 }); if (this.playedLog.length > 200) this.playedLog.shift(); }
    this.stepIndex++;
    if (!this.ctx || this.ctx.state !== 'running') return index;
    const now = this.ctx.currentTime + 0.005;
    const tr = t.transpose || 0, v = t.velocity ?? 0.8;
    if (step.note) { this.pluck(noteToFreq(step.note, tr), now, v); this.notesPlayed++; }
    if (step.bass) this.pluck(noteToFreq(step.bass, tr), now + 0.012, v * 0.55);
    step.chord?.forEach((n, i) => this.pluck(noteToFreq(n, tr), now + 0.02 + i * 0.015, v * 0.45));
    return index;
  }

  /** one step of any theme at an exact time (seconds from now), independent of the 01 step counter.
   *  Used by the 05 crank melody and the 04 repair tones; same music-box tine as 01. */
  playStep(step, theme, delay = 0) {
    if (step.note) {
      this.changedNotes = (this.changedNotes || 0) + (theme.id.startsWith('storge-theme-changed') ? 1 : 0);
      (this.playedLog ||= []).push({ theme: theme.id, note: step.note, t: performance.now() / 1000 + delay });
      if (this.playedLog.length > 200) this.playedLog.shift();
    }
    if (!this.ctx || this.ctx.state !== 'running') return;
    const when = this.ctx.currentTime + Math.max(0.005, delay);
    const tr = theme.transpose || 0, v = step.velocity ?? theme.velocity ?? 0.75;
    if (step.note) { this.pluck(noteToFreq(step.note, tr), when, v); this.notesPlayed++; }
    if (step.bass) this.pluck(noteToFreq(step.bass, tr), when + 0.012, v * 0.6);
    step.chord?.forEach((n, i) => this.pluck(noteToFreq(n, tr), when + 0.02 + i * 0.018, v * 0.4));
  }

  /** "다시 감기": back to the start — the 01 theme from its first note, reverb restored */
  resetForReplay() {
    clearTimeout(this._wetTimer);
    this.stepIndex = 0;
    this.musicStopped = false;
    this.shatterPlayed = 0;
    this.changedNotes = 0;
    this.repairTones = [];
    this.playedLog = [];
    if (this.ctx) {
      const now = this.ctx.currentTime;
      // let anything still ringing fade quickly, then a fresh music bus
      const old = this.musicBus;
      old.gain.cancelScheduledValues(now); old.gain.setTargetAtTime(0, now, 0.03);
      setTimeout(() => { try { old.disconnect(); } catch { /* gone */ } }, 500);
      this.musicBus = this.ctx.createGain(); this.musicBus.connect(this.bus);
      this.wet.gain.cancelScheduledValues(now); this.wet.gain.setTargetAtTime(0.3, now, 0.1);
    }
  }

  /** 03: stop the music box at once (ringing notes and their reverb tail), then silence */
  stopMusic() {
    this.musicStopped = true;
    if (!this.ctx) return;
    const now = this.ctx.currentTime, old = this.musicBus;
    old.gain.cancelScheduledValues(now);
    old.gain.setTargetAtTime(0, now, 0.012);
    this.wet.gain.cancelScheduledValues(now);
    this.wet.gain.setTargetAtTime(0, now, 0.03);                 // cut the reverb tail too
    setTimeout(() => { try { old.disconnect(); } catch { /* already gone */ } }, 600);
    this.musicBus = this.ctx.createGain(); this.musicBus.connect(this.bus);
    clearTimeout(this._wetTimer);
    this._wetTimer = setTimeout(() => { if (this.ctx) this.wet.gain.setTargetAtTime(0.3, this.ctx.currentTime, 0.2); }, 2400);
  }

  /** 03: short, bright glass-like "쨍!" (synthesised, no files) */
  playShatter() {
    this.shatterPlayed = (this.shatterPlayed || 0) + 1;
    if (!this.ctx || this.ctx.state !== 'running') return false;
    const c = this.ctx, t = c.currentTime + 0.01;
    // inharmonic bell/glass partials with very fast attack and short decays
    const parts = [[2637, 1.0, 0.55], [3951, 0.7, 0.42], [5588, 0.5, 0.3], [7040, 0.34, 0.22], [9320, 0.22, 0.14], [1318, 0.35, 0.25]];
    for (const [f, a, d] of parts) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16 * a, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + d + 0.05);
    }
    // crack: a short band-passed noise burst
    const len = Math.floor(c.sampleRate * 0.09), buf = c.createBuffer(1, len, c.sampleRate), d0 = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d0[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    const n = c.createBufferSource(); n.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4800; bp.Q.value = 0.9;
    const ng = c.createGain(); ng.gain.value = 0.5;
    n.connect(bp); bp.connect(ng); ng.connect(this.sfx); n.start(t);
    return true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }
}
