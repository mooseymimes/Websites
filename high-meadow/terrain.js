/* ============================================================================
   terrain.js — the shape of the land.

   heightAt(x, z) is the single source of truth: layered gradient noise for
   the rolling hills, rising into ridged mountains a few kilometres out. The
   mesh is one grid, uniform (2.5 m cells) across the central square where you
   can walk, then stretching geometrically out to the horizon. The central
   heights are also packed into a float texture so the grass can stand on the
   ground without leaving the GPU.

   Exposes window.Terrain = { heightAt, normalAt, build, HALF, CELL, GRID }
   ========================================================================== */
(function () {
  'use strict';
  const T = window.THREE, A = window.Atmos;

  /* ---------------------------------------------------- gradient noise */
  const perm = new Uint8Array(512);
  (function () {
    let s = 20240611;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  })();
  const GX = [1, -1, 1, -1, 1.4142, -1.4142, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1.4142, -1.4142];
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const X = xi & 255, Y = yi & 255;
    const a = perm[perm[X] + Y] & 7, b = perm[perm[X + 1] + Y] & 7, c = perm[perm[X] + Y + 1] & 7, d = perm[perm[X + 1] + Y + 1] & 7;
    const n00 = GX[a] * xf + GY[a] * yf, n10 = GX[b] * (xf - 1) + GY[b] * yf;
    const n01 = GX[c] * xf + GY[c] * (yf - 1), n11 = GX[d] * (xf - 1) + GY[d] * (yf - 1);
    const nx0 = n00 + (n10 - n00) * u, nx1 = n01 + (n11 - n01) * u;
    return (nx0 + (nx1 - nx0) * v) * 0.7071;              // roughly −1 … 1
  }
  function ridged(x, y, oct) {
    let a = 0.5, s = 0, f = 1;
    for (let i = 0; i < oct; i++) { const n = 1 - Math.abs(noise(x * f + i * 17.1, y * f - i * 9.3)); s += a * n * n; a *= 0.5; f *= 2.1; }
    return s;
  }
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  function heightAt(x, z) {
    let h = 58 * noise(x / 1150 + 3.1, z / 1150 - 1.7)       // the big swells
          + 46 * noise(x / 370 - 7.3, z / 370 + 2.9)          // hills
          + 15 * noise(x / 140 + 11.9, z / 140 + 5.2)         // knolls and hollows
          + 2.4 * noise(x / 47 - 3.3, z / 47 + 8.8)
          + 0.45 * noise(x / 13 + 1.1, z / 13 - 6.6);
    const r = Math.hypot(x, z);
    if (r > 1300) {
      const m = smooth(1300, 4300, r);
      h += m * (90 + 720 * ridged(x / 3100 + 0.6, z / 3100 + 4.2, 4)) + m * 22 * noise(x / 260, z / 260);
    }
    return h;
  }
  function normalAt(x, z, out) {
    const e = 1.25;
    const dx = heightAt(x + e, z) - heightAt(x - e, z), dz = heightAt(x, z + e) - heightAt(x, z - e);
    return out.set(-dx, 2 * e, -dz).normalize();
  }

  /* --------------------------------------------------------------- mesh */
  const CELL = 2.5, INNER = 240, OUTER = 60, GROW = 1.09;
  const HALF = CELL * INNER;                 // 600 m: half-width of the uniform central square
  const GRID = INNER * 2 + 1;                // samples across the central square

  function build() {
    const axis = [];
    for (let i = -INNER; i <= INNER; i++) axis.push(i * CELL);
    let step = CELL, far = HALF;
    for (let i = 0; i < OUTER; i++) { step *= GROW; far += step; axis.push(far); axis.unshift(-far); }
    const n = axis.length;

    const pos = new Float32Array(n * n * 3);
    const heights = new Float32Array(GRID * GRID);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = axis[i], z = axis[j], h = heightAt(x, z), k = (j * n + i) * 3;
        pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
        const ci = i - OUTER, cj = j - OUTER;
        if (ci >= 0 && ci < GRID && cj >= 0 && cj < GRID) heights[cj * GRID + ci] = h;
      }
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let q = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setIndex(new T.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const heightTex = new T.DataTexture(heights, GRID, GRID, T.RedFormat, T.FloatType);
    heightTex.magFilter = heightTex.minFilter = T.NearestFilter;
    heightTex.needsUpdate = true;

    const material = new T.ShaderMaterial({
      uniforms: A.uniforms,
      vertexShader: `
        varying vec3 vW;
        varying vec3 vN;
        void main() {
          vW = position;
          vN = normal;
          gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        ${A.GLSL}
        varying vec3 vW;
        varying vec3 vN;
        void main() {
          vec3 N = normalize(vN);
          vec3 V = normalize(cameraPosition - vW);
          float dist = distance(cameraPosition, vW);

          // Meadow: the colour the grass averages out to when you can no longer see the blades.
          vec3 tint = grassTint(vW.xz);
          float gust = noiseTex(vW.xz * 0.022 - uWindOffset).g * noiseTex(vW.xz * 0.09 - uWindOffset * 2.7).b;
          vec3 meadow = mix(GRASS_ROOT, GRASS_TIP, 0.52) * tint;
          float fine = noiseTex(vW.xz * 0.9).r * 0.6 + noiseTex(vW.xz * 0.23).a * 0.4;
          meadow *= 0.78 + 0.44 * fine;
          meadow *= 1.0 + 0.5 * gust * uWindStrength;                       // gusts brush the grass pale
          meadow *= mix(0.42, 1.0, smoothstep(6.0, 110.0, dist));            // under the blades it is dark

          // Bare rock on steep ground, snow up high (only the far mountains get either).
          float steep = smoothstep(0.30, 0.52, 1.0 - N.y);
          float rn = noiseTex(vW.xz * 0.013).a;
          vec3 rock = mix(vec3(0.16, 0.15, 0.14), vec3(0.30, 0.27, 0.24), rn);
          float alpine = smoothstep(240.0, 420.0, vW.y + rn * 80.0);
          vec3 alb = mix(meadow, mix(vec3(0.20, 0.21, 0.13), rock, 0.6), alpine * 0.8);
          alb = mix(alb, rock, steep);
          float snow = smoothstep(540.0, 720.0, vW.y + rn * 160.0) * (1.0 - 0.75 * steep);
          alb = mix(alb, vec3(0.86, 0.90, 0.96), snow);

          float sh = cloudShadow(vW) * treeShadow(vW);
          float ndl = max(dot(N, uSunDir), 0.0);
          vec3 sun = sunLight() * sh;
          vec3 light = sun * ndl + skyAmbient() * (0.55 + 0.45 * N.y);
          vec3 col = alb * light;
          float back = pow(max(dot(-V, uSunDir), 0.0), 4.0);                  // sun shining through the blades
          col += meadow * vec3(1.3, 1.25, 0.5) * sun * back * 0.55 * (1.0 - alpine) * (1.0 - steep);

          gl_FragColor = vec4(applyAtmosphere(col, vW), 1.0);
        }
      `,
    });
    const mesh = new T.Mesh(geo, material);
    mesh.frustumCulled = false;
    return { mesh, heightTex, extent: far };
  }

  window.Terrain = { heightAt, normalAt, noise, build, HALF, CELL, GRID };
})();
