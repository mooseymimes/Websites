/* ============================================================================
   barrels.js — barrels: procedural geometry and textures, instanced drawing,
   and a small rigid-body simulation.

   Each barrel is a rigid body. Buoyancy is sampled at fourteen points on its
   hull against the wave surface (height and water velocity from waves.js), so
   a barrel heels on a slope, bobs with the swell, and rolls onto its side the
   way real casks do. Barrels collide with each other as capsules.

   Exposes window.Barrels = { World, KINDS }
   ========================================================================== */
(function () {
  'use strict';
  const T = window.THREE;
  const W = window.OceanWaves;
  const clamp = W.clamp, smoothstep = W.smoothstep;
  const TAU = Math.PI * 2;
  const MAX = 96;                       // per kind
  const RHO = 1000, G = 9.81;           // water density, gravity
  const AIR_DRAG = 1.5;                 // N·s/m on the exposed part
  const ANG_DRAG_AIR = 0.05, ANG_DRAG_WATER = 0.8;   // 1/s

  const KINDS = {
    cask: { R: 0.30, H: 0.90 },
    drum: { R: 0.29, H: 0.88 },
  };
  const DRUM_COLORS = [0x2a5fb0, 0xb8302b, 0xd9a020, 0x2f7a3c, 0x6d6d6d, 0xc45a1e, 0x1f8a8a];

  /* ---------------------------------------------------------- textures */
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function grime(ctx, w, h, rand, n, alpha) {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = rand() < 0.5
        ? `rgba(0,0,0,${(alpha * rand()).toFixed(3)})`
        : `rgba(255,255,255,${(alpha * 0.6 * rand()).toFixed(3)})`;
      ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 3, 1 + rand() * 3);
    }
  }
  function toTexture(canvas) {
    const t = new T.CanvasTexture(canvas);
    t.colorSpace = T.SRGBColorSpace;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  }

  // Oak staves: u runs around the cask, v along it.
  function woodTexture() {
    const w = 512, h = 512, c = makeCanvas(w, h), ctx = c.getContext('2d'), rand = W.mulberry32(5);
    ctx.fillStyle = '#8a5a2e';
    ctx.fillRect(0, 0, w, h);
    const staves = 14, sw = w / staves;
    for (let s = 0; s < staves; s++) {
      const x0 = s * sw, tone = 0.8 + rand() * 0.4;
      const rgb = m => `rgb(${Math.round(168 * tone * m)},${Math.round(108 * tone * m)},${Math.round(56 * tone * m)})`;
      const g = ctx.createLinearGradient(x0, 0, x0 + sw, 0);
      g.addColorStop(0, rgb(0.5)); g.addColorStop(0.12, rgb(0.95)); g.addColorStop(0.5, rgb(1.12));
      g.addColorStop(0.88, rgb(0.95)); g.addColorStop(1, rgb(0.5));
      ctx.fillStyle = g;
      ctx.fillRect(x0, 0, sw + 1, h);
      ctx.strokeStyle = 'rgba(40,20,8,0.28)';
      ctx.lineWidth = 1;
      for (let l = 0; l < 10; l++) {
        const x = x0 + 2 + rand() * (sw - 4), f = 0.01 + rand() * 0.03, ph = rand() * TAU;
        ctx.beginPath();
        for (let y = 0; y <= h; y += 6) ctx.lineTo(x + Math.sin(y * f + ph) * 2, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(15,8,3,0.85)';
      ctx.fillRect(x0 - 1, 0, 2, h);
    }
    ctx.fillStyle = 'rgba(15,8,3,0.85)';
    ctx.fillRect(w - 1, 0, 1, h);
    grime(ctx, w, h, rand, 5000, 0.18);
    return toTexture(c);
  }

  // Cask heads: parallel planks with a darker chime.
  function headTexture() {
    const w = 256, h = 256, c = makeCanvas(w, h), ctx = c.getContext('2d'), rand = W.mulberry32(9);
    ctx.fillStyle = '#5e3a1c';
    ctx.fillRect(0, 0, w, h);
    const planks = 5, ph = h / planks;
    for (let p = 0; p < planks; p++) {
      const y0 = p * ph, tone = 0.8 + rand() * 0.4;
      const rgb = m => `rgb(${Math.round(156 * tone * m)},${Math.round(100 * tone * m)},${Math.round(52 * tone * m)})`;
      const g = ctx.createLinearGradient(0, y0, 0, y0 + ph);
      g.addColorStop(0, rgb(0.55)); g.addColorStop(0.15, rgb(1)); g.addColorStop(0.85, rgb(1)); g.addColorStop(1, rgb(0.55));
      ctx.fillStyle = g;
      ctx.fillRect(0, y0, w, ph + 1);
      ctx.strokeStyle = 'rgba(40,20,8,0.3)';
      ctx.lineWidth = 1;
      for (let l = 0; l < 7; l++) {
        const y = y0 + 3 + rand() * (ph - 6), f = 0.01 + rand() * 0.03, phs = rand() * TAU;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 6) ctx.lineTo(x, y + Math.sin(x * f + phs) * 1.5);
        ctx.stroke();
      }
    }
    const rg = ctx.createRadialGradient(w / 2, h / 2, w * 0.36, w / 2, h / 2, w * 0.5);
    rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
    grime(ctx, w, h, rand, 1500, 0.2);
    return toTexture(c);
  }

  // Painted steel: light grey so the per-instance colour tints it; rust and scratches stay dark.
  function drumTexture() {
    const w = 512, h = 512, c = makeCanvas(w, h), ctx = c.getContext('2d'), rand = W.mulberry32(21);
    ctx.fillStyle = '#d6d6d6';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${(0.06 * rand()).toFixed(3)})` : `rgba(255,255,255,${(0.08 * rand()).toFixed(3)})`;
      ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 10 + rand() * 90);
    }
    ctx.fillStyle = 'rgba(30,30,30,0.55)';
    ctx.fillRect(w * 0.12, h * 0.36, w * 0.28, h * 0.22);
    ctx.fillStyle = 'rgba(215,215,215,0.9)';
    ctx.fillRect(w * 0.15, h * 0.40, w * 0.22, h * 0.04);
    ctx.fillRect(w * 0.15, h * 0.47, w * 0.16, h * 0.03);
    ctx.fillRect(w * 0.15, h * 0.52, w * 0.19, h * 0.03);
    for (let i = 0; i < 60; i++) {
      const edge = rand() < 0.7;
      const y = edge ? (rand() < 0.5 ? rand() * h * 0.12 : h - rand() * h * 0.12) : rand() * h;
      const x = rand() * w, r = 6 + rand() * 30, a = 0.35 + rand() * 0.45;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(70,38,18,${a})`); g.addColorStop(0.6, `rgba(90,50,25,${a * 0.5})`); g.addColorStop(1, 'rgba(90,50,25,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      const x = rand() * w, y = rand() * h;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rand() - 0.5) * 60, y + (rand() - 0.5) * 20); ctx.stroke();
    }
    grime(ctx, w, h, rand, 3000, 0.12);
    return toTexture(c);
  }

  /* ---------------------------------------------------------- geometry */
  function caskGeometry(R, H) {
    const h = H / 2, rEnd = R * 0.86;
    const prof = y => rEnd + (R - rEnd) * (1 - (y / h) * (y / h));
    const pts = [];
    for (let i = 0; i <= 16; i++) { const y = -h + H * i / 16; pts.push(new T.Vector2(prof(y), y)); }
    const parts = [new T.LatheGeometry(pts, 36)], mats = [0];
    for (const s of [-1, 1]) {
      const cap = new T.CircleGeometry(rEnd * 0.985, 36);
      cap.rotateX(s > 0 ? -Math.PI / 2 : Math.PI / 2);
      cap.translate(0, s * (h - 0.015), 0);
      parts.push(cap); mats.push(1);
    }
    for (const f of [-0.84, -0.4, 0.4, 0.84]) {
      const y = f * h, hh = 0.028;
      const hoop = new T.CylinderGeometry(prof(y + hh) + 0.012, prof(y - hh) + 0.012, hh * 2, 36, 1, true);
      hoop.translate(0, y, 0);
      parts.push(hoop); mats.push(2);
    }
    const geo = T.BufferGeometryUtils.mergeGeometries(parts, true);
    geo.groups.forEach((g, i) => { g.materialIndex = mats[i]; });
    return geo;
  }

  function drumGeometry(R, H) {
    const parts = [new T.CylinderGeometry(R, R, H, 36, 1, false)];
    for (const y of [-H / 6, H / 6]) {
      const rib = new T.TorusGeometry(R + 0.004, 0.02, 8, 36);
      rib.rotateX(Math.PI / 2); rib.translate(0, y, 0);
      parts.push(rib);
    }
    for (const s of [-1, 1]) {
      const rim = new T.TorusGeometry(R - 0.004, 0.018, 8, 36);
      rim.rotateX(Math.PI / 2); rim.translate(0, s * (H / 2 - 0.006), 0);
      parts.push(rim);
    }
    const geo = T.BufferGeometryUtils.mergeGeometries(parts, false);
    geo.clearGroups();
    return geo;
  }

  /* ----------------------------------------------------------- physics */
  // Buoyancy sample points in the body frame (y along the barrel's axis).
  function makeSamples(R, H) {
    const h = H / 2, pts = [];
    for (const fy of [-0.55, 0.55]) {
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU + (fy > 0 ? Math.PI / 6 : 0);
        pts.push(new T.Vector3(Math.cos(a) * R * 0.72, fy * h, Math.sin(a) * R * 0.72));
      }
    }
    pts.push(new T.Vector3(0, -0.92 * h, 0), new T.Vector3(0, 0.92 * h, 0));
    return pts;
  }
  const SAMPLES = { cask: makeSamples(KINDS.cask.R, KINDS.cask.H), drum: makeSamples(KINDS.drum.R, KINDS.drum.H) };

  class Barrel {
    constructor(kind, x, y, z, fill, rand) {
      const spec = KINDS[kind];
      this.kind = kind;
      this.R = spec.R;
      this.h = spec.H / 2;
      this.volume = Math.PI * spec.R * spec.R * spec.H;
      this.mass = clamp(fill, 0.1, 0.92) * RHO * this.volume;
      this.p = new T.Vector3(x, y, z);
      this.v = new T.Vector3((rand() - 0.5) * 0.6, -0.5, (rand() - 0.5) * 0.6);
      this.q = new T.Quaternion().setFromEuler(new T.Euler((rand() - 0.5) * 0.8, rand() * TAU, (rand() - 0.5) * 0.8));
      this.w = new T.Vector3((rand() - 0.5) * 3, (rand() - 0.5) * 2, (rand() - 0.5) * 3);
      const iSide = this.mass * (3 * spec.R * spec.R + spec.H * spec.H) / 12, iAxis = this.mass * spec.R * spec.R / 2;
      this.invI = new T.Vector3(1 / iSide, 1 / iAxis, 1 / iSide);
      this.invISide = 1 / iSide;
      this.dragLin = 320;                // N·s/m when fully submerged
      this.dragQuad = 120;               // N·s²/m²
      this.samples = SAMPLES[kind];
      this.sub = 0;                      // submerged fraction, 0..1
      this.wet = false;
      this.relSpeed = 0;
      this.age = 0;
      this.color = new T.Color();
      if (kind === 'drum') this.color.setHex(DRUM_COLORS[Math.floor(rand() * DRUM_COLORS.length)]);
      else { const t = 0.8 + rand() * 0.35; this.color.setRGB(t, t * (0.92 + rand() * 0.1), t * (0.85 + rand() * 0.12)); }
    }
  }

  const _ws = new T.Vector3(), _r = new T.Vector3(), _f = new T.Vector3(), _rel = new T.Vector3(), _tq = new T.Vector3();
  const _F = new T.Vector3(), _TQ = new T.Vector3(), _qi = new T.Quaternion(), _wb = new T.Vector3(), _tb = new T.Vector3(), _dq = new T.Quaternion();
  const _ua = new T.Vector3(), _ub = new T.Vector3(), _a0 = new T.Vector3(), _a1 = new T.Vector3(), _b0 = new T.Vector3(), _b1 = new T.Vector3();
  const _ca = new T.Vector3(), _cb = new T.Vector3(), _n = new T.Vector3(), _ra = new T.Vector3(), _rb = new T.Vector3();
  const _va = new T.Vector3(), _vb = new T.Vector3(), _vrel = new T.Vector3(), _imp = new T.Vector3(), _t = new T.Vector3();
  const _d1 = new T.Vector3(), _d2 = new T.Vector3(), _rr = new T.Vector3();
  const ONE = new T.Vector3(1, 1, 1);

  // Closest points between segments p1q1 and p2q2 (Ericson, Real-Time Collision Detection 5.1.9).
  function closestSegSeg(p1, q1, p2, q2, c1, c2) {
    const d1 = _d1.subVectors(q1, p1), d2 = _d2.subVectors(q2, p2), r = _rr.subVectors(p1, p2);
    const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), EPS = 1e-9;
    let s, t;
    if (a <= EPS && e <= EPS) { s = t = 0; }
    else if (a <= EPS) { s = 0; t = clamp(f / e, 0, 1); }
    else {
      const c = d1.dot(r);
      if (e <= EPS) { t = 0; s = clamp(-c / a, 0, 1); }
      else {
        const b = d1.dot(d2), denom = a * e - b * b;
        s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
        else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
      }
    }
    c1.copy(p1).addScaledVector(d1, s);
    c2.copy(p2).addScaledVector(d2, t);
  }

  function capsuleContact(a, b) {
    const la = a.h - a.R, lb = b.h - b.R;
    _ua.set(0, 1, 0).applyQuaternion(a.q);
    _ub.set(0, 1, 0).applyQuaternion(b.q);
    _a0.copy(a.p).addScaledVector(_ua, -la); _a1.copy(a.p).addScaledVector(_ua, la);
    _b0.copy(b.p).addScaledVector(_ub, -lb); _b1.copy(b.p).addScaledVector(_ub, lb);
    closestSegSeg(_a0, _a1, _b0, _b1, _ca, _cb);
    _n.subVectors(_cb, _ca);
    const d = _n.length(), minD = a.R + b.R;
    if (d >= minD || d < 1e-6) return;
    _n.divideScalar(d);
    const pen = minD - d, wa = 1 / a.mass, wb = 1 / b.mass, wsum = wa + wb;
    a.p.addScaledVector(_n, -pen * 0.6 * wa / wsum);
    b.p.addScaledVector(_n, pen * 0.6 * wb / wsum);
    _ra.subVectors(_ca, a.p); _rb.subVectors(_cb, b.p);
    _va.copy(a.w).cross(_ra).add(a.v);
    _vb.copy(b.w).cross(_rb).add(b.v);
    _vrel.subVectors(_vb, _va);
    const vn = _vrel.dot(_n);
    if (vn >= 0) return;
    const j = -(1 + 0.25) * vn / wsum;
    _imp.copy(_n).multiplyScalar(j);
    a.v.addScaledVector(_imp, -wa); b.v.addScaledVector(_imp, wb);
    a.w.addScaledVector(_tq.crossVectors(_ra, _imp), -a.invISide * 0.5);
    b.w.addScaledVector(_tq.crossVectors(_rb, _imp), b.invISide * 0.5);
    _t.copy(_vrel).addScaledVector(_n, -vn);
    if (_t.lengthSq() > 1e-6) {
      _imp.copy(_t).multiplyScalar(-0.25 / wsum);
      a.v.addScaledVector(_imp, -wa); b.v.addScaledVector(_imp, wb);
    }
  }

  class World {
    constructor({ water, foam, onSplash }) {
      this.water = water;
      this.foam = foam;
      this.onSplash = onSplash;
      this.barrels = [];
      this.rings = [];
      this.time = 0;
      this.wind = new T.Vector3();
      this.rand = Math.random;
      this._surf = { y: 0, nx: 0, ny: 1, nz: 0, vx: 0, vy: 0, vz: 0, jac: 1 };
      this._m = new T.Matrix4();

      const woodMat = new T.MeshStandardMaterial({ map: woodTexture(), roughness: 0.78, metalness: 0.0 });
      const headMat = new T.MeshStandardMaterial({ map: headTexture(), roughness: 0.8, metalness: 0.0 });
      const ironMat = new T.MeshStandardMaterial({ color: 0x3a3533, roughness: 0.55, metalness: 0.85 });
      const paintMat = new T.MeshStandardMaterial({ map: drumTexture(), roughness: 0.5, metalness: 0.2 });
      this.casks = new T.InstancedMesh(caskGeometry(KINDS.cask.R, KINDS.cask.H), [woodMat, headMat, ironMat], MAX);
      this.drums = new T.InstancedMesh(drumGeometry(KINDS.drum.R, KINDS.drum.H), paintMat, MAX);
      for (const m of [this.casks, this.drums]) {
        m.frustumCulled = false;
        m.setColorAt(0, new T.Color(1, 1, 1));
        m.count = 0;
      }
    }

    get count() { return this.barrels.length; }

    // dirX/dirZ: direction the wind blows toward; speed in m/s.
    setWind(dirX, dirZ, speed) { this.wind.set(dirX, 0, dirZ).multiplyScalar(0.2 * speed * speed); }

    drop(x, z, kind = 'cask', fill = 0.45, y = 8) {
      if (!KINDS[kind]) kind = 'cask';
      const same = this.barrels.filter(b => b.kind === kind);
      if (same.length >= MAX) this.barrels.splice(this.barrels.indexOf(same[0]), 1);
      const b = new Barrel(kind, x, y, z, fill, this.rand);
      this.barrels.push(b);
      return b;
    }

    clear() { this.barrels.length = 0; this.rings.length = 0; this._write(); }

    update(dt) {
      const steps = Math.min(8, Math.max(1, Math.ceil(dt / (1 / 120)))), sdt = dt / steps;
      for (let i = 0; i < steps; i++) {
        this.time += sdt;
        this.water.time = this.time;
        this.step(sdt);
      }
      this._foamPass(dt);
      const c = this.foam ? this.foam.center : { x: 0, y: 0 };
      for (let i = this.barrels.length - 1; i >= 0; i--) {
        const b = this.barrels[i], dx = b.p.x - c.x, dz = b.p.z - c.y;
        if (dx * dx + dz * dz > 120 * 120 || b.p.y < -30) this.barrels.splice(i, 1);
      }
      this._write();
    }

    step(dt) {
      const water = this.water, surf = this._surf;
      for (const b of this.barrels) {
        const K = b.samples.length, share = b.volume / K, rs = b.R * 0.45;
        _F.set(0, -b.mass * G, 0);
        _TQ.set(0, 0, 0);
        let sub = 0, rel = 0, nrel = 0;
        for (let i = 0; i < K; i++) {
          _ws.copy(b.samples[i]).applyQuaternion(b.q).add(b.p);
          water.surface(_ws.x, _ws.z, surf);
          const f = smoothstep(-rs, rs, surf.y - _ws.y);
          if (f <= 0) continue;
          sub += f / K;
          _r.copy(_ws).sub(b.p);
          _rel.copy(b.w).cross(_r).add(b.v);              // velocity of this point
          _rel.x -= surf.vx; _rel.y -= surf.vy; _rel.z -= surf.vz;
          const speed = _rel.length();
          rel += speed; nrel++;
          const cd = (b.dragLin + b.dragQuad * speed) * f / K;
          _f.set(0, RHO * G * share * f, 0).addScaledVector(_rel, -cd);
          _F.add(_f);
          _TQ.add(_tq.crossVectors(_r, _f));
        }
        _F.addScaledVector(b.v, -AIR_DRAG * (1 - sub));
        _F.addScaledVector(this.wind, 1 - sub);
        b.v.addScaledVector(_F, dt / b.mass);
        b.p.addScaledVector(b.v, dt);

        // Angular update in the body frame, where the inertia tensor is diagonal.
        _qi.copy(b.q).invert();
        _wb.copy(b.w).applyQuaternion(_qi);
        _tb.copy(_TQ).applyQuaternion(_qi);
        _wb.x += _tb.x * b.invI.x * dt;
        _wb.y += _tb.y * b.invI.y * dt;
        _wb.z += _tb.z * b.invI.z * dt;
        _wb.multiplyScalar(1 / (1 + (ANG_DRAG_AIR + ANG_DRAG_WATER * sub) * dt));
        b.w.copy(_wb).applyQuaternion(b.q);
        _dq.set(b.w.x * dt * 0.5, b.w.y * dt * 0.5, b.w.z * dt * 0.5, 0).multiply(b.q);
        b.q.x += _dq.x; b.q.y += _dq.y; b.q.z += _dq.z; b.q.w += _dq.w;
        b.q.normalize();

        b.sub = sub;
        b.relSpeed = nrel ? rel / nrel : 0;
        b.age += dt;
        if (!b.wet && sub > 0.02) {
          b.wet = true;
          if (b.v.y < -1.2) this._splash(b, -b.v.y);
        } else if (b.wet && sub <= 0 && b.v.y > 1.5) {
          b.wet = false;
        }
      }
      const bs = this.barrels, n = bs.length;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (bs[i].p.distanceToSquared(bs[j].p) > 4) continue;
          capsuleContact(bs[i], bs[j]);
        }
      }
    }

    _splash(b, speed) {
      const s = clamp((speed - 1) / 9, 0, 1);
      const y = this.water.surface(b.p.x, b.p.z, this._surf).y;
      if (this.foam) {
        this.foam.addBlob(b.p.x, b.p.z, 0.5 + 0.7 * s, 0.5 + 0.5 * s);
        this.rings.push({ x: b.p.x, z: b.p.z, t0: this.time, life: 1.0 + 0.8 * s, speed: 1.2 + 1.5 * s, s: 0.4 + 0.8 * s });
      }
      if (this.onSplash) this.onSplash(b, s, y);
    }

    _foamPass(dt) {
      if (!this.foam) return;
      for (const b of this.barrels) {
        if (b.sub <= 0.001) continue;
        const straddle = clamp(1 - Math.abs(b.sub - 0.5) * 1.6, 0.15, 1);   // most foam where the hull cuts the surface
        this.foam.addBlob(b.p.x, b.p.z, b.h * 1.05, dt * (0.1 + 0.35 * Math.min(b.relSpeed, 2.5)) * straddle);
      }
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i], age = this.time - r.t0;
        if (age > r.life) { this.rings.splice(i, 1); continue; }
        const k = 1 - age / r.life;
        this.foam.addRing(r.x, r.z, 0.5 + r.speed * age, r.s * k * k * dt * 3);
      }
    }

    _write() {
      let nc = 0, nd = 0;
      const m = this._m;
      for (const b of this.barrels) {
        m.compose(b.p, b.q, ONE);
        if (b.kind === 'cask') { this.casks.setMatrixAt(nc, m); this.casks.setColorAt(nc, b.color); nc++; }
        else { this.drums.setMatrixAt(nd, m); this.drums.setColorAt(nd, b.color); nd++; }
      }
      this.casks.count = nc; this.drums.count = nd;
      if (nc) { this.casks.instanceMatrix.needsUpdate = true; this.casks.instanceColor.needsUpdate = true; }
      if (nd) { this.drums.instanceMatrix.needsUpdate = true; this.drums.instanceColor.needsUpdate = true; }
    }
  }

  window.Barrels = { World, KINDS, MAX };
})();
