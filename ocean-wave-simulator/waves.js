/* ============================================================================
   waves.js — the wave model, shared by the GPU and the CPU.

   The sea is a sum of NW Gerstner waves (GPU Gems 1, ch. 1). The same
   spectrum is evaluated in GLSL (the water's vertex shader) and in JavaScript
   (barrel physics, camera clamp), so barrels sit on exactly the surface that
   is drawn.

   Each wave fades out where the mesh can no longer resolve it: the grid is
   dense near the camera target and coarse far away, and a wave shorter than a
   few cells would only alias. The GPU reads the local cell size from a vertex
   attribute; the CPU recomputes it from the grid warp (Ocean.cellAt).

   Exposes window.OceanWaves = { NW, GLSL, uniforms, buildSpectrum, Sampler }
   ========================================================================== */
(function () {
  'use strict';

  const NW = 8;                       // wave components
  const G = 9.81;
  const TAU = Math.PI * 2;
  const FADE0 = 0.11, FADE1 = 0.3;    // fade a wave once a grid cell exceeds this fraction of its wavelength

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // mulberry32: a tiny seeded RNG so a spectrum is reproducible.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Shared uniform objects: the water material references these directly, so
  // writing the arrays here updates the GPU and the CPU sampler at once.
  const uniforms = {
    uWaveA: { value: new Float32Array(NW * 4) },   // dir.x, dir.z, amplitude, k
    uWaveB: { value: new Float32Array(NW * 4) },   // omega, phase, Q, wavelength
    uWaveTime: { value: 0 },
  };

  const GLSL = `
    #define NW ${NW}
    #define FADE0 ${FADE0}
    #define FADE1 ${FADE1}
    uniform vec4 uWaveA[NW];
    uniform vec4 uWaveB[NW];
    uniform float uWaveTime;

    // p: undisplaced world XZ of a grid vertex. cell: local grid spacing there.
    // disp: Gerstner displacement, nrm: surface normal at the displaced point,
    // jac: Jacobian of the horizontal displacement (< ~0.6 means a folding crest).
    void gerstner(in vec2 p, in float cell, out vec3 disp, out vec3 nrm, out float jac) {
      disp = vec3(0.0);
      vec3 dn = vec3(0.0);
      float jxx = 1.0, jzz = 1.0, jxz = 0.0;
      for (int i = 0; i < NW; i++) {
        vec4 a = uWaveA[i], b = uWaveB[i];
        float fade = 1.0 - smoothstep(b.w * FADE0, b.w * FADE1, cell);
        vec2 D = a.xy;
        float A = a.z * fade, k = a.w, Q = b.z;
        float th = k * dot(D, p) - b.x * uWaveTime + b.y;
        float s = sin(th), c = cos(th);
        disp.xz += Q * A * D * c;
        disp.y += A * s;
        float wa = k * A;
        dn.xz += D * wa * c;
        dn.y += Q * wa * s;
        float qs = Q * wa * s;
        jxx -= qs * D.x * D.x;
        jzz -= qs * D.y * D.y;
        jxz -= qs * D.x * D.y;
      }
      nrm = normalize(vec3(-dn.x, 1.0 - dn.y, -dn.z));
      jac = jxx * jzz - jxz * jxz;
    }
  `;

  /* ------------------------------------------------------------ spectrum */
  // windDir: direction the waves travel toward (radians in the XZ plane).
  // seaState 0..1: calm ripples to a heavy swell. choppiness 0..1: crest sharpness.
  function buildSpectrum(opts = {}) {
    const windDir = opts.windDir ?? 0.7;
    const seaState = clamp(opts.seaState ?? 0.5, 0, 1);
    const chop = clamp(opts.choppiness ?? 0.7, 0, 1);
    const rand = mulberry32(opts.seed ?? 1337);

    const U = 2.5 + 15 * seaState;                     // nominal wind speed, m/s
    const lamMax = clamp(0.55 * U * U, 6, 160);        // dominant wavelength
    const lamMin = 2.4;
    const steep = 0.045 + 0.075 * seaState;            // k·A of each component
    const waves = [];
    for (let i = 0; i < NW; i++) {
      const t = i / (NW - 1);
      const lam = lamMax * Math.pow(lamMin / lamMax, t);
      const k = TAU / lam;
      const spread = 0.35 + 1.2 * t;                   // swell is directional; chop is not
      const ang = windDir + (rand() - 0.5) * spread;
      const amp = steep * lam / TAU * (0.65 + 0.7 * rand());
      waves.push({ dx: Math.cos(ang), dz: Math.sin(ang), amp, k, omega: Math.sqrt(G * k), phase: rand() * TAU, lam, q: 0 });
    }
    // Steepness Q: Σ Q·k·A ranges 0.2..1.4 with the slider; above 1 the crests
    // can fold over where components line up, which is exactly where whitecaps go.
    const qSum = 0.2 + 1.2 * chop;
    for (const w of waves) w.q = qSum / (w.k * w.amp * NW);
    const maxAmp = waves.reduce((s, w) => s + w.amp, 0);
    return { waves, maxAmp, lamMax, windDir, windSpeed: U, seaState, choppiness: chop };
  }

  /* ------------------------------------------------------------- sampler */
  // CPU evaluation of the same waves. surface(x, z, out) answers "where is the
  // water at world (x, z)?" — height, normal, water velocity and Jacobian.
  class Sampler {
    constructor() {
      this.a = uniforms.uWaveA.value;
      this.b = uniforms.uWaveB.value;
      this.maxAmp = 0;
      this.time = 0;
      this.cellAt = () => 0;            // installed by the ocean mesh (grid spacing at x, z)
      this._tmp = { x: 0, z: 0 };
      this._out = { y: 0, nx: 0, ny: 1, nz: 0, vx: 0, vy: 0, vz: 0, jac: 1 };
    }

    setSpectrum(spec) {
      const a = this.a, b = this.b;
      spec.waves.forEach((w, i) => {
        const o = i * 4;
        a[o] = w.dx; a[o + 1] = w.dz; a[o + 2] = w.amp; a[o + 3] = w.k;
        b[o] = w.omega; b[o + 1] = w.phase; b[o + 2] = w.q; b[o + 3] = w.lam;
      });
      this.maxAmp = spec.maxAmp;
    }

    _fade(i, cell) {
      const lam = this.b[i * 4 + 3];
      return 1 - smoothstep(lam * FADE0, lam * FADE1, cell);
    }

    // Horizontal Gerstner displacement at the undisplaced point (px, pz).
    _dispXZ(px, pz, cell, out) {
      const a = this.a, b = this.b, t = this.time;
      let dx = 0, dz = 0;
      for (let i = 0; i < NW; i++) {
        const o = i * 4;
        const A = a[o + 2] * this._fade(i, cell);
        if (A === 0) continue;
        const Dx = a[o], Dz = a[o + 1];
        const th = a[o + 3] * (Dx * px + Dz * pz) - b[o] * t + b[o + 1];
        const c = Math.cos(th) * b[o + 2] * A;
        dx += Dx * c; dz += Dz * c;
      }
      out.x = dx; out.z = dz;
    }

    // Surface at world (x, z). Gerstner waves move points sideways, so first
    // find the grid point that lands at (x, z), then evaluate everything there.
    surface(x, z, out = this._out) {
      const cell = this.cellAt(x, z);
      const tmp = this._tmp;
      let px = x, pz = z;
      for (let it = 0; it < 3; it++) {
        this._dispXZ(px, pz, cell, tmp);
        px = x - tmp.x; pz = z - tmp.z;
      }
      const a = this.a, b = this.b, t = this.time;
      let y = 0, dnx = 0, dny = 0, dnz = 0, vx = 0, vy = 0, vz = 0, jxx = 1, jzz = 1, jxz = 0;
      for (let i = 0; i < NW; i++) {
        const o = i * 4;
        const A = a[o + 2] * this._fade(i, cell);
        if (A === 0) continue;
        const Dx = a[o], Dz = a[o + 1], k = a[o + 3], w = b[o], Q = b[o + 2];
        const th = k * (Dx * px + Dz * pz) - w * t + b[o + 1];
        const s = Math.sin(th), c = Math.cos(th);
        y += A * s;
        const wa = k * A;
        dnx += Dx * wa * c; dnz += Dz * wa * c; dny += Q * wa * s;
        const qs = Q * wa * s;
        jxx -= qs * Dx * Dx; jzz -= qs * Dz * Dz; jxz -= qs * Dx * Dz;
        const vh = Q * A * w * s;                  // d/dt of the displacement
        vx += Dx * vh; vz += Dz * vh; vy -= A * w * c;
      }
      const ny = 1 - dny, inv = 1 / Math.hypot(dnx, ny, dnz);
      out.y = y;
      out.nx = -dnx * inv; out.ny = ny * inv; out.nz = -dnz * inv;
      out.vx = vx; out.vy = vy; out.vz = vz;
      out.jac = jxx * jzz - jxz * jxz;
      return out;
    }

    height(x, z) { return this.surface(x, z, this._out).y; }
  }

  window.OceanWaves = { NW, GLSL, uniforms, buildSpectrum, Sampler, mulberry32, smoothstep, clamp };
})();
