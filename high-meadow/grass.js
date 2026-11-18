/* ============================================================================
   grass.js — the meadow itself.

   Every blade is one instance of a tiny tapered strip. Blades are scattered
   over a square patch that tiles the world; the vertex shader wraps each one
   to the copy nearest a point just ahead of the camera, so the grass follows
   you forever without a single buffer being rewritten. Three rings share the
   work: fine blades at your feet, then broader, sparser ones out to the
   middle distance where the ground colour takes over.

   Height, slope, wind, cloud and tree shadow, lighting and haze are all
   worked out per vertex, so the fragment shader is nearly free and the
   enormous overdraw of a meadow stays cheap.

   Exposes window.Grass = { create }
   ========================================================================== */
(function () {
  'use strict';
  const T = window.THREE, A = window.Atmos, TR = window.Terrain;

  function bladeGeometry(segs) {
    const pos = [], idx = [];
    for (let j = 0; j < segs; j++) { const t = j / segs; pos.push(-0.5, t, 0, 0.5, t, 0); }
    pos.push(0, 1, 0);
    for (let j = 0; j < segs - 1; j++) { const a = j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const a = (segs - 1) * 2; idx.push(a, a + 1, a + 2);
    const g = new T.InstancedBufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  function seeds(count, seed) {
    const a = new Float32Array(count * 4);
    let s = seed >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < a.length; i++) a[i] = rnd();
    return new T.InstancedBufferAttribute(a, 4);
  }

  // Shared by blades and flowers: wrap an instance into the patch and stand it on the terrain.
  const PLACE = `
    attribute vec4 aSeed;
    uniform vec2 uCenter;
    uniform float uPatch;
    uniform float uInner;
    uniform highp sampler2D uHeightTex;
    uniform vec3 uGrid;                       // half-width, cell size, samples per side
    void place(out vec3 base, out vec3 tn, out float fade) {
      vec2 rel = mod(aSeed.xy * uPatch - uCenter + 0.5 * uPatch, uPatch) - 0.5 * uPatch;
      vec2 wxz = uCenter + rel;
      float edge = max(abs(rel.x), abs(rel.y)) / (0.5 * uPatch);
      fade = 1.0 - smoothstep(0.72, 1.0, edge);
      vec2 g = clamp((wxz + uGrid.x) / uGrid.y, vec2(0.0), vec2(uGrid.z - 1.001));
      vec2 gi = floor(g), gf = g - gi;
      ivec2 ig = ivec2(gi);
      float h00 = texelFetch(uHeightTex, ig, 0).r, h10 = texelFetch(uHeightTex, ig + ivec2(1, 0), 0).r;
      float h01 = texelFetch(uHeightTex, ig + ivec2(0, 1), 0).r, h11 = texelFetch(uHeightTex, ig + ivec2(1, 1), 0).r;
      base = vec3(wxz.x, mix(mix(h00, h10, gf.x), mix(h01, h11, gf.x), gf.y), wxz.y);
      tn = normalize(vec3(-mix(h10 - h00, h11 - h01, gf.y), uGrid.y, -mix(h01 - h00, h11 - h10, gf.x)));
      float dcam = distance(base, cameraPosition);
      if (uInner > 0.0) fade *= smoothstep(uInner * 0.55, uInner * 1.25, dcam);
      fade *= 1.0 - smoothstep(30.0, 80.0, cameraPosition.y - base.y);      // from high up the ground colour takes over
    }
  `;

  const BLADE_VS = `
    ${A.GLSL}
    ${PLACE}
    uniform float uBladeW;
    uniform float uBladeH;
    uniform vec3 uCamRight;
    varying vec3 vColor;
    varying float vU;
    void main() {
      vec3 base, tn; float fade;
      place(base, tn, fade);
      vec2 wxz = base.xz;
      float r1 = aSeed.z, r2 = aSeed.w;
      float r3 = fract(r1 * 91.7 + r2 * 37.3), r4 = fract(r2 * 57.1 + r1 * 13.9);

      vec4 pn = noiseTex(wxz * 0.045 + vec2(3.0, 7.0));
      float hgt = uBladeH * (0.45 + 0.85 * r1) * (0.55 + 0.95 * pn.r) * fade;
      float ang = r2 * 6.2832;
      vec2 dir = vec2(cos(ang), sin(ang));
      vec2 perp = vec2(-dir.y, dir.x);
      vec2 cr = uCamRight.xz * (dot(perp, uCamRight.xz) < 0.0 ? -1.0 : 1.0);
      vec2 side = normalize(mix(perp, cr, 0.55) + vec2(1e-4, 0.0));

      float gust = noiseTex(wxz * 0.022 - uWindOffset).g * noiseTex(wxz * 0.09 - uWindOffset * 2.7).b;
      float push = (0.10 + 2.6 * gust) * uWindStrength;
      float flutter = sin(uTime * (2.4 + r3 * 2.2) + r4 * 6.2832) * 0.07 * (0.35 + uWindStrength);
      vec2 lean = dir * (0.10 + 0.34 * r3) + uWindDir * (push + flutter);
      float ll = min(dot(lean, lean), 1.0);

      float t = position.y;
      vec3 p = base;
      p.xz += lean * (t * t) * hgt + side * (position.x * uBladeW * (1.0 - 0.9 * t * t) * (0.7 + 0.6 * r4) * min(fade * 3.0, 1.0));
      p.y += hgt * t * (1.0 - 0.32 * ll * t);

      vec3 alb = mix(GRASS_ROOT, GRASS_TIP, t) * grassTint(wxz) * (0.74 + 0.52 * r4);
      alb = mix(alb, alb * vec3(1.5, 1.25, 0.75), smoothstep(0.75, 1.0, r1) * t * 0.7);     // the tallest go to seed

      float farK = smoothstep(15.0, 80.0, distance(base, cameraPosition));
      float occ = mix(mix(0.30, 0.78, farK), 1.0, t);                                     // distant roots would only read as speckle
      float sh = cloudShadow(base) * treeShadow(base);
      float ndl = max(dot(tn, uSunDir), 0.0);
      vec3 sun = sunLight() * sh;
      vec3 V = normalize(cameraPosition - p);
      float back = pow(max(dot(-V, uSunDir), 0.0), 4.0);
      vec3 col = alb * (sun * ndl * mix(0.55, 1.0, t) + skyAmbient() * (0.55 + 0.45 * tn.y) * occ);
      col += alb * vec3(1.3, 1.25, 0.5) * sun * back * t * 1.1;                           // translucency
      col += sun * (0.05 * t * t * t * push) * vec3(0.9, 1.0, 0.7);                        // sheen on bent blades
      vColor = applyAtmosphere(col, p);
      vU = position.x;
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    }
  `;
  const BLADE_FS = `
    varying vec3 vColor;
    varying float vU;
    void main() { gl_FragColor = vec4(vColor * (0.86 + 0.30 * (vU + 0.5)), 1.0); }
  `;

  const FLOWER_VS = `
    ${A.GLSL}
    ${PLACE}
    uniform float uBladeH;
    uniform vec3 uCamRight;
    uniform vec3 uCamUp;
    varying vec3 vColor;
    varying vec3 vHeart;
    varying vec2 vUv;
    void main() {
      vec3 base, tn; float fade;
      place(base, tn, fade);
      vec2 wxz = base.xz;
      float r1 = aSeed.z, r2 = aSeed.w, r3 = fract(r1 * 91.7 + r2 * 37.3);
      // Flowers come in drifts: only where two patches of noise agree.
      float drift = noiseTex(wxz * 0.016 + vec2(41.0, 13.0)).a * 0.6 + noiseTex(wxz * 0.07).r * 0.4;
      fade *= smoothstep(0.50, 0.62, drift + (r3 - 0.5) * 0.12);
      fade *= 1.0 - smoothstep(40.0, 85.0, distance(base, cameraPosition));

      float kind = fract(r2 * 7.0 + noiseTex(wxz * 0.01).g * 2.0);
      vec3 petal = kind < 0.50 ? vec3(0.95, 0.95, 0.90) : (kind < 0.80 ? vec3(1.0, 0.70, 0.05) : vec3(0.50, 0.26, 0.85));
      vHeart = kind < 0.50 ? vec3(1.0, 0.62, 0.04) : petal * 0.55;

      float pn = noiseTex(wxz * 0.045 + vec2(3.0, 7.0)).r;
      float hgt = uBladeH * (0.62 + 0.5 * r1) * (0.55 + 0.95 * pn);
      float gust = noiseTex(wxz * 0.022 - uWindOffset).g * noiseTex(wxz * 0.09 - uWindOffset * 2.7).b;
      float sway = (0.10 + 2.6 * gust) * uWindStrength * 0.6 + sin(uTime * 2.6 + r2 * 6.2832) * 0.05;
      vec3 p = base + vec3(uWindDir.x * sway * hgt, hgt, uWindDir.y * sway * hgt);
      float size = (0.035 + 0.03 * r1) * fade;
      p += (uCamRight * position.x + uCamUp * position.y) * size;

      float sh = cloudShadow(base) * treeShadow(base);
      vec3 light = sunLight() * sh * (0.35 + 0.65 * max(dot(tn, uSunDir), 0.0)) + skyAmbient() * 0.9;
      vColor = petal * light * 0.62;
      vHeart *= light * 0.62;
      vColor = applyAtmosphere(vColor, p);
      vUv = position.xy;
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    }
  `;
  const FLOWER_FS = `
    varying vec3 vColor;
    varying vec3 vHeart;
    varying vec2 vUv;
    void main() {
      float r = length(vUv);
      float a = atan(vUv.y, vUv.x);
      if (r > 0.62 + 0.38 * abs(cos(a * 2.5))) discard;                 // five petals
      gl_FragColor = vec4(mix(vHeart, vColor, smoothstep(0.22, 0.34, r)), 1.0);
    }
  `;

  const LEVELS = {
    low:    [[26, 45000, 0.024, 4, 0], [90, 70000, 0.060, 2, 7], [280, 60000, 0.20, 1, 30]],
    medium: [[28, 110000, 0.021, 4, 0], [95, 150000, 0.052, 2, 8], [290, 130000, 0.17, 1, 32]],
    high:   [[30, 220000, 0.019, 5, 0], [100, 280000, 0.046, 2, 9], [300, 260000, 0.15, 1, 34]],
    ultra:  [[34, 420000, 0.017, 5, 0], [110, 520000, 0.040, 3, 10], [320, 480000, 0.13, 1, 38]],
  };
  const FLOWERS = { low: 5000, medium: 12000, high: 24000, ultra: 40000 };

  function create(heightTex) {
    const group = new T.Group();
    const grid = new T.Vector3(TR.HALF, TR.CELL, TR.GRID);
    const camRight = { value: new T.Vector3(1, 0, 0) }, camUp = { value: new T.Vector3(0, 1, 0) };
    let layers = [];

    function clear() {
      for (const l of layers) { group.remove(l.mesh); l.mesh.geometry.dispose(); l.mesh.material.dispose(); }
      layers = [];
    }
    function setQuality(q) {
      clear();
      (LEVELS[q] || LEVELS.high).forEach(([patch, count, width, segs, inner], i) => {
        const geo = bladeGeometry(segs);
        geo.setAttribute('aSeed', seeds(count, 977 + i * 131));
        geo.instanceCount = count;
        const mat = new T.ShaderMaterial({
          uniforms: Object.assign({}, A.uniforms, {
            uCenter: { value: new T.Vector2() }, uPatch: { value: patch }, uInner: { value: inner },
            uHeightTex: { value: heightTex }, uGrid: { value: grid },
            uBladeW: { value: width }, uBladeH: { value: 0.62 + i * 0.06 }, uCamRight: camRight,
          }),
          vertexShader: BLADE_VS, fragmentShader: BLADE_FS, side: T.DoubleSide,
        });
        const mesh = new T.Mesh(geo, mat);
        mesh.frustumCulled = false;
        group.add(mesh);
        layers.push({ mesh, patch });
      });
      const quad = new T.InstancedBufferGeometry();
      quad.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
      quad.setIndex([0, 1, 2, 0, 2, 3]);
      const n = FLOWERS[q] || FLOWERS.high;
      quad.setAttribute('aSeed', seeds(n, 4242));
      quad.instanceCount = n;
      const fmat = new T.ShaderMaterial({
        uniforms: Object.assign({}, A.uniforms, {
          uCenter: { value: new T.Vector2() }, uPatch: { value: 150 }, uInner: { value: 0 },
          uHeightTex: { value: heightTex }, uGrid: { value: grid },
          uBladeH: { value: 0.62 }, uCamRight: camRight, uCamUp: camUp,
        }),
        vertexShader: FLOWER_VS, fragmentShader: FLOWER_FS, side: T.DoubleSide,
      });
      const flowers = new T.Mesh(quad, fmat);
      flowers.frustumCulled = false;
      group.add(flowers);
      layers.push({ mesh: flowers, patch: 150 });
    }

    const fwd = new T.Vector3();
    function update(camera) {
      group.visible = camera.position.y - TR.heightAt(camera.position.x, camera.position.z) < 150;
      if (!group.visible) return;
      camera.getWorldDirection(fwd);
      camRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
      camUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
      const flat = Math.hypot(fwd.x, fwd.z) || 1;
      const lookDown = 1 - Math.abs(fwd.y);                      // looking at your feet: keep the patch centred
      for (const l of layers) {
        const ahead = l.patch * 0.36 * lookDown;
        l.mesh.material.uniforms.uCenter.value.set(camera.position.x + fwd.x / flat * ahead, camera.position.z + fwd.z / flat * ahead);
      }
    }
    return { group, setQuality, update };
  }

  window.Grass = { create };
})();
