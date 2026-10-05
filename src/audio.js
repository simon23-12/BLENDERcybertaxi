// WebAudio: looping synthwave soundtrack (rendered offline), live engine/wind/impact/ui sounds.
import { clamp } from './util.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.musicVol = 0.7; this.sfxVol = 0.8;
    this.ready = false;
    this.musicBuf = null;
    this.fetching = null;
  }

  /** download + decode music early (does not need the user gesture for fetch) */
  prefetch(url, onProgress) {
    if (this.fetching) return this.fetching;
    this.fetching = fetch(url).then(async (r) => {
      const total = +r.headers.get('content-length') || 3.3e6;
      const reader = r.body?.getReader?.();
      if (!reader) return r.arrayBuffer();
      const chunks = []; let got = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress?.(got / total); }
      const buf = new Uint8Array(got); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
      return buf.buffer;
    }).then((ab) => { this.raw = ab; return ab; }).catch(() => null);
    return this.fetching;
  }

  /** call inside a user gesture */
  async start() {
    if (this.ctx) { try { await this.ctx.resume(); } catch (_) {} return; }
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) {}
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    try { await ctx.resume(); } catch (_) {}
    // iOS: unlock with a tiny silent buffer
    const b = ctx.createBuffer(1, 1, 22050); const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
    this.master = ctx.createGain(); this.master.gain.value = 1;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.musicGain = ctx.createGain(); this.musicGain.gain.value = 0; this.musicGain.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxVol; this.sfx.connect(this.master);
    // shared noise buffer
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = nb;
    this._engine();
    this.ready = true;
    // music
    const ab = this.raw || await this.fetching;
    if (ab) {
      try {
        this.musicBuf = await new Promise((res, rej) => ctx.decodeAudioData(ab.slice(0), res, rej));
        const src = ctx.createBufferSource(); src.buffer = this.musicBuf; src.loop = true; src.connect(this.musicGain); src.start(0.05);
        this.musicSrc = src;
        this.musicGain.gain.setValueAtTime(0, ctx.currentTime);
        this.musicGain.gain.linearRampToValueAtTime(this.musicVol, ctx.currentTime + 4);
      } catch (e) { console.warn('music decode failed', e); }
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend(); else ctx.resume();
    });
  }

  setMusic(v) { this.musicVol = v; if (this.ctx && this.musicGain) this.musicGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }
  setSfx(v) { this.sfxVol = v; if (this.ctx && this.sfx) this.sfx.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }

  _engine() {
    const c = this.ctx;
    const g = this.engGain = c.createGain(); g.gain.value = 0; g.connect(this.sfx);
    // turbine: two detuned saws + sub
    this.o1 = c.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = c.createOscillator(); this.o2.type = 'sawtooth'; this.o2.detune.value = 9;
    this.o3 = c.createOscillator(); this.o3.type = 'sine';
    this.eLP = c.createBiquadFilter(); this.eLP.type = 'lowpass'; this.eLP.frequency.value = 400; this.eLP.Q.value = 3;
    const og = c.createGain(); og.gain.value = 0.16;
    this.o1.connect(og); this.o2.connect(og); og.connect(this.eLP); this.eLP.connect(g);
    const sg = c.createGain(); sg.gain.value = 0.35; this.o3.connect(sg); sg.connect(g);
    // whine
    this.o4 = c.createOscillator(); this.o4.type = 'triangle';
    this.whineG = c.createGain(); this.whineG.gain.value = 0;
    this.o4.connect(this.whineG); this.whineG.connect(g);
    // wind
    this.windSrc = c.createBufferSource(); this.windSrc.buffer = this.noise; this.windSrc.loop = true;
    this.windBP = c.createBiquadFilter(); this.windBP.type = 'bandpass'; this.windBP.frequency.value = 700; this.windBP.Q.value = 0.6;
    this.windG = c.createGain(); this.windG.gain.value = 0;
    this.windSrc.connect(this.windBP); this.windBP.connect(this.windG); this.windG.connect(this.sfx);
    [this.o1, this.o2, this.o3, this.o4, this.windSrc].forEach((n) => n.start());
  }

  /** per frame: speed in m/s, gas/brake 0..1, boost 0..1 */
  update(speed, gas, brake, boost, nearMiss = 0) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const s = clamp(speed / 118, 0, 1);
    const f = 48 + s * 70 + gas * 14;
    this.o1.frequency.setTargetAtTime(f, t, 0.06);
    this.o2.frequency.setTargetAtTime(f * 1.005, t, 0.06);
    this.o3.frequency.setTargetAtTime(f * 0.5, t, 0.06);
    this.eLP.frequency.setTargetAtTime(220 + s * 900 + gas * 500, t, 0.08);
    this.engGain.gain.setTargetAtTime(0.38 + s * 0.3 + boost * 0.15, t, 0.1);
    this.o4.frequency.setTargetAtTime(520 + s * 900 + boost * 400, t, 0.1);
    this.whineG.gain.setTargetAtTime(0.012 + boost * 0.03 + s * 0.02, t, 0.12);
    this.windBP.frequency.setTargetAtTime(500 + s * 1800, t, 0.1);
    this.windG.gain.setTargetAtTime(Math.pow(s, 1.6) * 0.55, t, 0.15);
  }

  _burst({ dur = 0.3, freq = 1200, q = 0.7, gain = 0.5, type = 'bandpass', pan = 0, slide = 0 }) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur); f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    src.connect(f); f.connect(g); if (p) { p.pan.value = pan; g.connect(p); p.connect(this.sfx); } else g.connect(this.sfx);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  _tone(freq, t0, dur, { type = 'triangle', gain = 0.2, slideTo = 0, delay = 0 } = {}) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + t0;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }

  impact(strength) {
    const s = clamp(strength / 40, 0.15, 1);
    this._burst({ dur: 0.35, freq: 900, q: 0.8, gain: 0.5 * s, type: 'lowpass', slide: 0.2 });
    this._tone(110, 0, 0.3, { type: 'sine', gain: 0.5 * s, slideTo: 38 });
    this._burst({ dur: 0.12, freq: 4200, q: 1.2, gain: 0.18 * s, type: 'highpass' });
  }
  whoosh(pan, amt) { this._burst({ dur: 0.55, freq: 500, q: 0.9, gain: 0.22 * amt, type: 'bandpass', pan, slide: 5 }); }
  chime(up = true) {
    const base = up ? [523, 659, 784, 1047] : [784, 659, 523, 392];
    base.forEach((f, i) => this._tone(f, i * 0.09, 0.5, { type: 'triangle', gain: 0.16 }));
  }
  cash() { [880, 1175, 1568].forEach((f, i) => this._tone(f, i * 0.07, 0.4, { type: 'square', gain: 0.07 })); }
  click() { this._tone(900, 0, 0.06, { type: 'square', gain: 0.05 }); }
  board() { this._tone(300, 0, 0.5, { type: 'sine', gain: 0.18, slideTo: 900 }); }
}
