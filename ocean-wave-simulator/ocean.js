/* ============================================================================
   ocean.js — the water surface, the foam map and splash particles.

   Ocean     a warped grid (dense near the camera target, coarse far away) that
             the water shader displaces with the shared Gerstner waves and
             shades with sky reflection, sun glitter, crest scattering, foam
             and horizon fog.
   FoamMap   a top-down render target covering the area around the barrels.
             Barrel wakes and splash rings are painted into it every frame and
             it slowly fades, so foam lingers and trails.
   Splashes  a pool of droplets on ballistic paths, evaluated in the vertex
             shader from their launch time.

   Exposes window.Ocean = { Ocean, FoamMap, Splashes }
   ========================================================================== */
(function () {
  'use strict';
  const T = window.THREE;
  const W = window.OceanWaves;
  const SKY = window.OceanSky;
  const TAU = Math.PI * 2;
  const clamp = W.clamp;

  /* ----------------------------------------------------------- grid warp */
  // Grid coordinate u ∈ [-1, 1] maps to world offset half·warp(u): cells are
  // about 0.26 m across at the centre and ~25 m at the edge, 1.5 km out.
  const WARP_A = 0.035;
  const warp = u => u * (WARP_A + (1 - WARP_A) * u * u);
  const warpSlope = u => WARP_A + 3 * (1 - WARP_A) * u * u;
  function unwarp(x) {
    const s = x < 0 ? -1 : 1, ax = Math.abs(x);
    if (ax >= 1) return s;
    let u = Math.min(1, ax < WARP_A ? ax / WARP_A : Math.cbrt(ax / (1 - WARP_A)));
    for (let i = 0; i < 5; i++) u = clamp(u - (warp(u) - ax) / warpSlope(u), 0, 1);
    return s * u;
  }

  function buildGrid(segments, half) {
    const n = segments + 1, du = 2 / segments;
    const pos = new Float32Array(n * n * 3), cell = new Float32Array(n * n);
    let k = 0, c = 0;
    for (let j = 0; j < n; j++) {
      const v = j * du - 1, z = half * warp(v), sz = warpSlope(v);
      for (let i = 0; i < n; i++) {
        const u = i * du - 1;
        pos[k++] = half * warp(u); pos[k++] = 0; pos[k++] = z;
        cell[c++] = half * du * Math.max(warpSlope(u), sz);
      }
    }
    const idx = new Uint32Array(segments * segments * 6);
    let q = 0;
    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < segments; i++) {
        const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1;
        idx[q++] = a; idx[q++] = cc; idx[q++] = b;
        idx[q++] = b; idx[q++] = cc; idx[q++] = d;
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('aCell', new T.BufferAttribute(cell, 1));
    g.setIndex(new T.BufferAttribute(idx, 1));
    g.boundingSphere = new T.Sphere(new T.Vector3(), half * 2);
    return g;
  }

  /* ------------------------------------------------------ detail texture */
  // A tiling normal map of small ripples (sum of sines with integer wave
  // vectors, so it repeats seamlessly) plus periodic value noise in alpha
  // that breaks up the foam edges.
  function makeDetailTexture(size, anisotropy) {
    const rand = W.mulberry32(2024);
    const comps = [];
    while (comps.length < 30) {
      const m = Math.round((rand() * 2 - 1) * 12), n = Math.round((rand() * 2 - 1) * 12);
      const kk = Math.hypot(m, n);
      if (kk < 1.5) continue;
      comps.push({ kx: m * TAU, ky: n * TAU, amp: (0.6 + rand() * 0.8) / Math.pow(kk, 1.6), ph: rand() * TAU });
    }
    const N = size * size, gx = new Float32Array(N), gz = new Float32Array(N);
    let sq = 0;
    for (let j = 0, p = 0; j < size; j++) {
      const v = j / size;
      for (let i = 0; i < size; i++, p++) {
        const u = i / size;
        let dx = 0, dz = 0;
        for (let c = 0; c < comps.length; c++) {
          const w = comps[c];
          const cs = Math.cos(w.kx * u + w.ky * v + w.ph) * w.amp;
          dx += w.kx * cs; dz += w.ky * cs;
        }
        gx[p] = dx; gz[p] = dz; sq += dx * dx + dz * dz;
      }
    }
    const scale = 0.55 / Math.sqrt(sq / (N * 2));          // RMS slope 0.55 before the shader scales it

    const ihash = (x, y, s) => {
      let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s + 1, 1274126177)) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
    const vnoise = (x, y, period, s) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const m = (i, j) => ihash(((i % period) + period) % period, ((j % period) + period) % period, s);
      return (m(xi, yi) * (1 - sx) + m(xi + 1, yi) * sx) * (1 - sy) + (m(xi, yi + 1) * (1 - sx) + m(xi + 1, yi + 1) * sx) * sy;
    };

    const data = new Uint8Array(N * 4);
    for (let j = 0, p = 0; j < size; j++) {
      for (let i = 0; i < size; i++, p++) {
        const nx = -gx[p] * scale, nz = -gz[p] * scale, inv = 1 / Math.hypot(nx, 1, nz);
        const u = i / size, v = j / size;
        let noise = 0, amp = 0.5, per = 12;
        for (let o = 0; o < 4; o++) { noise += amp * vnoise(u * per, v * per, per, o); amp *= 0.5; per *= 2; }
        data[p * 4] = (nx * inv * 0.5 + 0.5) * 255;
        data[p * 4 + 1] = (nz * inv * 0.5 + 0.5) * 255;
        data[p * 4 + 2] = inv * 255;
        data[p * 4 + 3] = clamp(noise / 0.9375, 0, 1) * 255;
      }
    }
    const tex = new T.DataTexture(data, size, size, T.RGBAFormat, T.UnsignedByteType);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.minFilter = T.LinearMipmapLinearFilter;
    tex.magFilter = T.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = anisotropy || 1;
    tex.needsUpdate = true;
    return tex;
  }

  /* --------------------------------------------------------- shaders */
  const VERT = `
    ${W.GLSL}
    attribute float aCell;
    varying vec3 vWorld;
    varying vec3 vNormal;
    varying float vJac;
    void main() {
      vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
      vec3 disp, nrm;
      float jac;
      gerstner(wp.xz, aCell, disp, nrm, jac);
      vec3 w = vec3(wp.x + disp.x, disp.y, wp.z + disp.z);
      vWorld = w;
      vNormal = nrm;
      vJac = jac;
      gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
    }
  `;

  const FRAG = `
    ${SKY.GLSL}
    uniform sampler2D uDetail;
    uniform sampler2D uFoam;
    uniform vec4 uFoamArea;        // centre.x, centre.z, 1/size, enabled
    uniform float uMaxAmp;
    uniform float uTime;
    uniform vec3 uDeepColor;
    uniform vec3 uShallowColor;
    uniform vec3 uFoamColor;
    uniform float uDetailScale;
    uniform float uDetailStrength;
    uniform vec2 uFoamCrest;
    uniform float uWhitecap;
    uniform float uFogDensity;
    varying vec3 vWorld;
    varying vec3 vNormal;
    varying float vJac;

    void main() {
      vec3 toCam = cameraPosition - vWorld;
      float dist = length(toCam);
      vec3 V = toCam / dist;

      // Small ripples: two scrolling samples of the tiling normal map.
      float inv = 1.0 / uDetailScale;
      vec2 uv1 = vWorld.xz * inv + uTime * vec2(0.021, 0.013);
      vec2 uv2 = vWorld.xz * inv * 0.41 + uTime * vec2(-0.011, 0.017);
      uv2 = vec2(uv2.x * 0.8 - uv2.y * 0.6, uv2.x * 0.6 + uv2.y * 0.8);
      vec4 d1 = texture2D(uDetail, uv1);
      vec4 d2 = texture2D(uDetail, uv2);
      float d3 = texture2D(uDetail, uv1 * 2.7 + vec2(0.31, 0.17)).a;
      vec2 dn = (d1.xy * 2.0 - 1.0) * 0.7 + (d2.xy * 2.0 - 1.0) * 0.5;
      float detailAmt = uDetailStrength / (1.0 + dist * 0.012);
      vec3 N = normalize(vec3(vNormal.x + dn.x * detailAmt, vNormal.y, vNormal.z + dn.y * detailAmt));
      float noise = d1.a * 0.4 + d2.a * 0.3 + d3 * 0.3;

      float se = uSunDir.y;
      vec3 ambient = skyAmbient(se);
      vec3 sunLight = uSunColor * uSunIntensity;
      float NdL = max(dot(N, uSunDir), 0.0);
      float NdV = max(dot(N, V), 0.0);
      float fresnel = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);

      // Sky reflection: analytic, so it always matches the dome.
      vec3 R = reflect(-V, N);
      R.y = max(R.y, 0.02);
      vec3 refl = skyRadiance(normalize(R), 2);

      // Sun glitter: a tight lobe on the rippled normal plus a broad soft one.
      vec3 H = normalize(V + uSunDir);
      float NdH = max(dot(N, H), 0.0);
      vec3 specCol = sunLight * (pow(NdH, 500.0) * 5.0 + pow(NdH, 48.0) * 0.06) * (0.35 + 1.3 * fresnel);

      // Water body: deep colour lit by the sky, plus light scattered through crests.
      float crest = clamp(vWorld.y / max(uMaxAmp, 0.15) * 0.5 + 0.5, 0.0, 1.0);
      float fwd = pow(max(dot(V, -uSunDir), 0.0), 3.0);
      float sss = crest * crest * (0.35 + fwd) * (1.0 - 0.5 * NdV);
      vec3 body = uDeepColor * (ambient * 1.3 + sunLight * NdL * 0.35)
                + uShallowColor * (sunLight * sss * 0.65 + ambient * crest * 0.18);

      // Foam: painted wakes and splashes, plus whitecaps where crests fold over.
      vec2 fuv = (vWorld.xz - uFoamArea.xy) * uFoamArea.z;
      float inArea = step(max(abs(fuv.x), abs(fuv.y)), 0.495) * uFoamArea.w;
      float accum = texture2D(uFoam, vec2(fuv.x, -fuv.y) + 0.5).r * inArea;
      float whitecap = (1.0 - smoothstep(uFoamCrest.x, uFoamCrest.y, vJac)) * uWhitecap * smoothstep(0.3, 0.75, crest) / (1.0 + dist * 0.01);
      float foam = clamp(accum * 1.3 + whitecap, 0.0, 1.0);
      float foamMask = smoothstep(0.55, 0.85, foam * 0.7 + noise * 0.55);
      vec3 foamCol = uFoamColor * (ambient * 0.9 + sunLight * (0.25 + 0.75 * NdL));

      vec3 col = mix(body, refl, fresnel) + specCol * (1.0 - foamMask * 0.7);
      col = mix(col, foamCol, foamMask);

      // Aerial perspective; the far edge of the grid dissolves into the horizon.
      float fog = 1.0 - exp(-dist * uFogDensity);
      fog = 1.0 - (1.0 - fog) * (1.0 - smoothstep(600.0, 1450.0, dist));
      vec3 fogCol = skyRadiance(normalize(vec3(-V.x, 0.0, -V.z + 1e-4)), 0);
      col = mix(col, fogCol, fog);

      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;

  /* ----------------------------------------------------------- Ocean */
  class Ocean {
    constructor({ segments = 400, half = 1500, detailSize = 512, foam, anisotropy = 8 } = {}) {
      this.half = half;
      this.segments = segments;
      this.du = 2 / segments;
      this.center = new T.Vector2(0, 0);
      this.maxAmp = 0;
      this.sampler = new W.Sampler();
      this.sampler.cellAt = (x, z) => this.cellAt(x, z);
      this.detail = makeDetailTexture(detailSize, anisotropy);
      this.uniforms = Object.assign({}, W.uniforms, SKY.uniforms, {
        uDetail: { value: this.detail },
        uFoam: { value: foam ? foam.texture : null },
        uFoamArea: { value: new T.Vector4(0, 0, foam ? 1 / foam.size : 0, foam ? 1 : 0) },
        uMaxAmp: { value: 1 },
        uTime: { value: 0 },
        uDeepColor: { value: new T.Color(0.004, 0.036, 0.072) },
        uShallowColor: { value: new T.Color(0.03, 0.30, 0.30) },
        uFoamColor: { value: new T.Color(0.92, 0.95, 0.97) },
        uDetailScale: { value: 9.0 },
        uDetailStrength: { value: 0.42 },
        uFoamCrest: { value: new T.Vector2(0.5, 0.95) },
        uWhitecap: { value: 0.5 },
        uFogDensity: { value: 0.0008 },
      });
      this.material = new T.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG });
      this.mesh = new T.Mesh(buildGrid(segments, half), this.material);
      this.mesh.frustumCulled = false;
    }

    // Local grid cell size at world (x, z) — the same value the vertex attribute holds.
    cellAt(x, z) {
      const u = unwarp((x - this.center.x) / this.half), v = unwarp((z - this.center.y) / this.half);
      return this.half * this.du * Math.max(warpSlope(u), warpSlope(v));
    }

    setSpectrum(spec) {
      this.sampler.setSpectrum(spec);
      this.maxAmp = spec.maxAmp;
      this.uniforms.uMaxAmp.value = spec.maxAmp;
      this.uniforms.uWhitecap.value = W.smoothstep(0.2, 0.85, spec.seaState) * 0.65;
    }

    setTime(t) {
      W.uniforms.uWaveTime.value = t;
      this.sampler.time = t;
      this.uniforms.uTime.value = t;
    }

    // The mesh follows the camera target in 6 m steps so the dense part of the grid stays in view.
    setCenter(x, z) {
      const s = 6, sx = Math.round(x / s) * s, sz = Math.round(z / s) * s;
      if (sx !== this.center.x || sz !== this.center.y) {
        this.center.set(sx, sz);
        this.mesh.position.set(sx, 0, sz);
      }
    }

    setFoam(foam) {
      this.uniforms.uFoam.value = foam.texture;
      this.uniforms.uFoamArea.value.set(foam.center.x, foam.center.y, 1 / foam.size, 1);
    }

    set wireframe(v) { this.material.wireframe = v; }
    get wireframe() { return this.material.wireframe; }

    surfaceAt(x, z, out) { return this.sampler.surface(x, z, out); }
  }

  /* --------------------------------------------------------- FoamMap */
  const MAX_BLOBS = 256, MAX_RINGS = 64;

  function radialTexture(size, profile) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d'), img = ctx.createImageData(size, size), d = img.data;
    for (let j = 0, p = 0; j < size; j++) {
      for (let i = 0; i < size; i++, p += 4) {
        const x = (i + 0.5) / size * 2 - 1, y = (j + 0.5) / size * 2 - 1;
        d[p] = d[p + 1] = d[p + 2] = 255;
        d[p + 3] = clamp(profile(Math.hypot(x, y)), 0, 1) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new T.CanvasTexture(c);
    tex.minFilter = tex.magFilter = T.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  class FoamMap {
    constructor(renderer, size = 256, res = 1024) {
      this.size = size;
      this.res = res;
      this.center = new T.Vector2(0, 0);
      this.decayRate = 0.75;                         // per second
      this.float = !!renderer.capabilities.isWebGL2 &&
        (renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float'));
      const opts = {
        type: this.float ? T.HalfFloatType : T.UnsignedByteType, format: T.RGBAFormat,
        minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      };
      this.rt = new T.WebGLRenderTarget(res, res, opts);
      this.rt2 = new T.WebGLRenderTarget(res, res, opts);

      this.camera = new T.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0.1, 50);
      this.camera.position.set(0, 10, 0);
      this.camera.rotation.x = -Math.PI / 2;         // looks straight down; +x right, -z up

      this.scene = new T.Scene();
      // Fade pass. Float targets: dst *= (1 - a). Byte targets: dst -= k (else small values never clear).
      this.decayMat = new T.MeshBasicMaterial({
        color: 0x000000, transparent: true, depthTest: false, depthWrite: false, blending: T.CustomBlending,
        blendEquationAlpha: T.AddEquation, blendSrcAlpha: T.ZeroFactor, blendDstAlpha: T.OneFactor,
      });
      if (this.float) {
        this.decayMat.blendEquation = T.AddEquation;
        this.decayMat.blendSrc = T.ZeroFactor;
        this.decayMat.blendDst = T.OneMinusSrcAlphaFactor;
      } else {
        this.decayMat.blendEquation = T.ReverseSubtractEquation;
        this.decayMat.blendSrc = T.OneFactor;
        this.decayMat.blendDst = T.OneFactor;
      }
      const flat = new T.PlaneGeometry(1, 1);
      flat.rotateX(-Math.PI / 2);
      this.decay = new T.Mesh(flat, this.decayMat);
      this.decay.scale.set(size * 1.02, 1, size * 1.02);
      this.decay.renderOrder = -10;
      this.decay.frustumCulled = false;

      const spriteMat = map => new T.MeshBasicMaterial({ map, transparent: true, blending: T.AdditiveBlending, depthTest: false, depthWrite: false });
      this.blobs = new T.InstancedMesh(flat, spriteMat(radialTexture(64, r => Math.exp(-r * r * 3.2) * (1 - Math.max(0, (r - 0.6) / 0.4)))), MAX_BLOBS);
      this.rings = new T.InstancedMesh(flat, spriteMat(radialTexture(128, r => Math.exp(-Math.pow((r - 0.7) / 0.08, 2)))), MAX_RINGS);
      for (const m of [this.blobs, this.rings]) {
        m.frustumCulled = false;
        m.setColorAt(0, new T.Color(1, 1, 1));
        m.count = 0;
      }
      this.blobs.renderOrder = 0;
      this.rings.renderOrder = 1;
      this.scene.add(this.decay, this.blobs, this.rings);

      // Copy pass used when the covered area moves.
      this.copyScene = new T.Scene();
      this.copyMat = new T.MeshBasicMaterial({ map: this.rt.texture, blending: T.NoBlending, depthTest: false, depthWrite: false });
      this.copy = new T.Mesh(flat, this.copyMat);
      this.copy.scale.set(size, 1, size);
      this.copy.frustumCulled = false;
      this.copyScene.add(this.copy);

      this._m = new T.Matrix4();
      this._c = new T.Color();
      this.blobCount = 0;
      this.ringCount = 0;
      this.decayAcc = 0;

      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(this.rt); renderer.clear();
      renderer.setRenderTarget(this.rt2); renderer.clear();
      renderer.setRenderTarget(prev);
    }

    get texture() { return this.rt.texture; }

    begin() { this.blobCount = 0; this.ringCount = 0; }

    _add(mesh, i, x, z, r, s) {
      const m = this._m;
      m.makeScale(2 * r, 1, 2 * r);
      m.setPosition(x, 0, z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, this._c.setScalar(s));
    }
    addBlob(x, z, r, s) { if (this.blobCount < MAX_BLOBS) this._add(this.blobs, this.blobCount++, x, z, r, s); }
    addRing(x, z, r, s) { if (this.ringCount < MAX_RINGS) this._add(this.rings, this.ringCount++, x, z, r, s); }

    update(renderer, dt) {
      if (this.float) {
        this.decayMat.opacity = 1 - Math.exp(-this.decayRate * dt);
        this.decay.visible = true;
      } else {
        this.decayAcc += dt * this.decayRate * 0.45;
        this.decay.visible = this.decayAcc >= 2 / 255;
        if (this.decay.visible) { this.decayMat.color.setScalar(this.decayAcc); this.decayAcc = 0; }
      }
      this.blobs.count = this.blobCount;
      this.rings.count = this.ringCount;
      if (this.blobCount) { this.blobs.instanceMatrix.needsUpdate = true; this.blobs.instanceColor.needsUpdate = true; }
      if (this.ringCount) { this.rings.instanceMatrix.needsUpdate = true; this.rings.instanceColor.needsUpdate = true; }

      const prev = renderer.getRenderTarget(), autoClear = renderer.autoClear;
      renderer.setRenderTarget(this.rt);
      renderer.autoClear = false;
      renderer.render(this.scene, this.camera);
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(prev);
    }

    // Move the covered area, carrying the existing foam along.
    recenter(renderer, x, z) {
      const texel = this.size / this.res;
      x = Math.round(x / texel) * texel;
      z = Math.round(z / texel) * texel;
      if (x === this.center.x && z === this.center.y) return;
      this.copy.position.set(this.center.x, 0, this.center.y);
      this.copyMat.map = this.rt.texture;
      this.center.set(x, z);
      this.camera.position.set(x, 10, z);
      this.decay.position.set(x, 0, z);
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(this.rt2);
      renderer.clear();
      renderer.render(this.copyScene, this.camera);
      renderer.setRenderTarget(prev);
      const t = this.rt; this.rt = this.rt2; this.rt2 = t;
    }
  }

  /* -------------------------------------------------------- Splashes */
  class Splashes {
    constructor(max = 3000) {
      this.max = max;
      this.head = 0;
      this.time = 0;
      const g = new T.BufferGeometry();
      this.aPos = new T.BufferAttribute(new Float32Array(max * 3), 3);
      this.aVel = new T.BufferAttribute(new Float32Array(max * 4), 4);
      this.aMeta = new T.BufferAttribute(new Float32Array(max * 3), 3);
      for (let i = 0; i < max; i++) this.aMeta.array[i * 3] = -1e9;         // never born
      g.setAttribute('position', this.aPos);
      g.setAttribute('aVel', this.aVel);
      g.setAttribute('aMeta', this.aMeta);
      g.boundingSphere = new T.Sphere(new T.Vector3(), 1e5);
      this.uniforms = Object.assign({}, SKY.uniforms, { uTime: { value: 0 }, uScale: { value: 500 } });
      const material = new T.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: `
          ${SKY.GLSL}
          attribute vec4 aVel;
          attribute vec3 aMeta;
          uniform float uTime;
          uniform float uScale;
          varying float vFade;
          varying float vSeed;
          varying vec3 vLight;
          void main() {
            float age = uTime - aMeta.x;
            float life = aVel.w;
            if (age < 0.0 || age > life) {
              gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
              gl_PointSize = 0.0;
              vFade = 0.0; vSeed = 0.0; vLight = vec3(0.0);
              return;
            }
            vec3 p = position + aVel.xyz * age + vec3(0.0, -4.6 * age * age, 0.0);
            float t = age / life;
            vFade = (1.0 - t) * min(1.0, age * 10.0);
            vSeed = aMeta.z;
            vLight = skyAmbient(uSunDir.y) * 1.6 + uSunColor * uSunIntensity * 0.9;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = min(aMeta.y * (1.0 + t * 0.8) * uScale / max(-mv.z, 0.2), 48.0);
          }
        `,
        fragmentShader: `
          varying float vFade;
          varying float vSeed;
          varying vec3 vLight;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float r2 = dot(c, c);
            if (r2 > 0.25) discard;
            float a = smoothstep(0.25, 0.02, r2) * vFade * 0.7;
            vec3 col = mix(vec3(0.72, 0.84, 0.94), vec3(1.0), vSeed) * vLight;
            gl_FragColor = vec4(col, a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
        transparent: true, depthWrite: false, depthTest: true, blending: T.NormalBlending,
      });
      this.points = new T.Points(g, material);
      this.points.frustumCulled = false;
      this.points.renderOrder = 5;
    }

    burst(x, y, z, strength, count) {
      const n = count || Math.round(50 + 170 * strength);
      const P = this.aPos.array, V = this.aVel.array, M = this.aMeta.array, r = Math.random;
      for (let i = 0; i < n; i++) {
        const k = this.head;
        this.head = (this.head + 1) % this.max;
        const ang = r() * TAU, rad = r() * 0.4, crown = r() < 0.35;
        const up = crown ? 0.8 + r() * (1.5 + 2.5 * strength) : 1.2 + r() * (3.0 + 6.0 * strength);
        const out = crown ? 1.0 + r() * (1.5 + 4.0 * strength) : 0.2 + r() * (0.8 + 2.0 * strength);
        P[k * 3] = x + Math.cos(ang) * rad; P[k * 3 + 1] = y + 0.05; P[k * 3 + 2] = z + Math.sin(ang) * rad;
        V[k * 4] = Math.cos(ang) * out; V[k * 4 + 1] = up; V[k * 4 + 2] = Math.sin(ang) * out;
        V[k * 4 + 3] = 0.5 + r() * (0.7 + 0.6 * strength);
        M[k * 3] = this.time; M[k * 3 + 1] = (0.03 + r() * 0.07) * (1 + strength * 0.5); M[k * 3 + 2] = r();
      }
      this.aPos.needsUpdate = this.aVel.needsUpdate = this.aMeta.needsUpdate = true;
    }

    // pixelScale: drawing-buffer height / (2·tan(fov/2)) — converts metres to pixels at 1 m.
    update(time, pixelScale) {
      this.time = time;
      this.uniforms.uTime.value = time;
      this.uniforms.uScale.value = pixelScale;
    }
  }

  window.Ocean = { Ocean, FoamMap, Splashes };
})();
