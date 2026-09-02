/* ============================================================================
   audio.js — synthesized sound: a breathing wash of filtered noise for the
   sea, and a noise burst plus a low "plop" for each splash. No audio files.
   The context is created lazily on a user gesture, as browsers require.

   Exposes window.OceanAudio (a single instance).
   ========================================================================== */
(function () {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  class OceanAudio {
    constructor() {
      this.ctx = null;
      this.enabled = false;
      this.sea = 0.5;
    }

    _ensure() {
      if (this.ctx) return true;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const ctx = this.ctx = new AC();
      const master = this.master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);

      // Four seconds of pinkish noise, looped.
      const len = ctx.sampleRate * 4, buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        let b0 = 0, b1 = 0;
        for (let i = 0; i < len; i++) {
          const w = Math.random() * 2 - 1;
          b0 = 0.99 * b0 + w * 0.05;
          b1 = 0.96 * b1 + w * 0.2;
          d[i] = (b0 * 3 + b1 + w * 0.15) * 0.4;
        }
      }
      this.noiseBuf = buf;
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;

      const lp = this.lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.6;
      const swell = this.swell = ctx.createGain();
      swell.gain.value = 0.6;
      src.connect(lp); lp.connect(swell); swell.connect(master);

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 0.5;
      const hiss = this.hiss = ctx.createGain();
      hiss.gain.value = 0.1;
      src.connect(bp); bp.connect(hiss); hiss.connect(master);

      // Slow modulation: the sea breathes.
      const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
      lfo.frequency.value = 0.09; lfoG.gain.value = 0.25;
      lfo.connect(lfoG); lfoG.connect(swell.gain);
      const lfo2 = ctx.createOscillator(), lfo2G = ctx.createGain();
      lfo2.frequency.value = 0.053; lfo2G.gain.value = 180;
      lfo2.connect(lfo2G); lfo2G.connect(lp.frequency);

      src.start(); lfo.start(); lfo2.start();
      this.setSea(this.sea);
      return true;
    }

    // Call from any user gesture so a suspended context can start.
    unlock() {
      if (!this.enabled) return;
      if (this._ensure() && this.ctx.state === 'suspended') this.ctx.resume();
    }

    setEnabled(on) {
      this.enabled = on;
      if (on) {
        if (!this._ensure()) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.setTargetAtTime(0.8, t, 0.4);
      } else if (this.ctx) {
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.setTargetAtTime(0, t, 0.25);
      }
    }

    setSea(s) {
      this.sea = s;
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.swell.gain.setTargetAtTime(0.3 + 0.6 * s, t, 0.5);
      this.lp.frequency.setTargetAtTime(260 + 700 * s, t, 0.5);
      this.hiss.gain.setTargetAtTime(0.04 + 0.16 * s, t, 0.5);
    }

    splash(strength) {
      if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
      const ctx = this.ctx, t = ctx.currentTime, s = clamp(strength, 0, 1);

      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(1800 + 800 * s, t);
      bp.frequency.exponentialRampToValueAtTime(220, t + 0.45 + 0.3 * s);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5 + 0.7 * s, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6 + 0.5 * s);
      src.connect(bp); bp.connect(g); g.connect(this.master);
      src.start(t, Math.random() * 3);
      src.stop(t + 1.4);

      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(190 + 60 * s, t);
      o.frequency.exponentialRampToValueAtTime(60, t + 0.3);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.35 + 0.35 * s, t + 0.015);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(og); og.connect(this.master);
      o.start(t); o.stop(t + 0.4);
    }
  }

  window.OceanAudio = new OceanAudio();
})();
