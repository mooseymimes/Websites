/* ============================================================================
   atmosphere.js — sun, sky, clouds, haze and shared lighting.

   One block of GLSL (Atmos.GLSL) is pasted into every shader on the page, so
   the sky dome, the hills, the grass and the trees all agree on the colour of
   the light, the haze between you and the horizon, and where the cloud
   shadows fall: a cloud you see overhead is the cloud shading the grass.

   Exposes window.Atmos = { GLSL, uniforms, sunFromHours, setSun, createSky }
   ========================================================================== */
(function () {
  'use strict';
  const T = window.THREE;
  const DEG = Math.PI / 180;

  /* A small tiling texture of smooth value noise (four independent channels,
     32 lattice cells across). Every fbm in the shaders is built from it, which
     is far cheaper than hashing in GLSL and works in vertex shaders too. */
  function makeNoiseTexture(size = 256, cells = 32) {
    const data = new Uint8Array(size * size * 4);
    let s = 1234567;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let c = 0; c < 4; c++) {
      const lat = new Float32Array(cells * cells);
      for (let i = 0; i < lat.length; i++) lat[i] = rnd();
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const fx = x / size * cells, fy = y / size * cells;
          const ix = Math.floor(fx), iy = Math.floor(fy);
          let tx = fx - ix, ty = fy - iy;
          tx = tx * tx * tx * (tx * (tx * 6 - 15) + 10); ty = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
          const x1 = (ix + 1) % cells, y1 = (iy + 1) % cells;
          const a = lat[iy * cells + ix], b = lat[iy * cells + x1], d = lat[y1 * cells + ix], e = lat[y1 * cells + x1];
          data[(y * size + x) * 4 + c] = Math.round(255 * (a + (b - a) * tx + (d - a) * ty + (a - b - d + e) * tx * ty));
        }
      }
    }
    const tex = new T.DataTexture(data, size, size, T.RGBAFormat);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.magFilter = T.LinearFilter; tex.minFilter = T.LinearMipmapLinearFilter;
    tex.generateMipmaps = true; tex.needsUpdate = true;
    return tex;
  }

  const uniforms = {
    uSunDir: { value: new T.Vector3(0, 1, 0) },
    uSunColor: { value: new T.Color(1, 1, 1) },
    uSunIntensity: { value: 1 },
    uCloudCover: { value: 0.4 },
    uCloudOffset: { value: new T.Vector2() },
    uTime: { value: 0 },
    uFogDensity: { value: 0.00024 },
    uNoise: { value: makeNoiseTexture() },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new T.Matrix4() },
    uShadowStrength: { value: 0 },
    uWindDir: { value: new T.Vector2(1, 0) },
    uWindOffset: { value: new T.Vector2() },
    uWindStrength: { value: 0.5 },
  };

  const GLSL = `
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform float uSunIntensity;
    uniform float uCloudCover;
    uniform vec2 uCloudOffset;
    uniform float uTime;
    uniform float uFogDensity;
    uniform sampler2D uNoise;
    uniform sampler2D uShadowMap;
    uniform mat4 uShadowMatrix;
    uniform float uShadowStrength;
    uniform vec2 uWindDir;
    uniform vec2 uWindOffset;
    uniform float uWindStrength;

    const float CLOUD_H = 900.0;
    const float CLOUD_S = 0.00050;
    const float SUN_GAIN = 3.3;

    vec4 noiseTex(vec2 p) { return textureLod(uNoise, p * 0.03125, 0.0); }
    float fbm3(vec2 p) {
      return (noiseTex(p).r * 0.5 + noiseTex(p * 2.03 + vec2(11.3, 7.1)).g * 0.25
            + noiseTex(p * 4.07 + vec2(3.7, 19.9)).b * 0.125) / 0.875;
    }
    float fbm5(vec2 p) {
      return (noiseTex(p).r * 0.5 + noiseTex(p * 2.03 + vec2(11.3, 7.1)).g * 0.25
            + noiseTex(p * 4.07 + vec2(3.7, 19.9)).b * 0.125 + noiseTex(p * 8.11 + vec2(23.1, 5.3)).a * 0.0625
            + noiseTex(p * 16.3 + vec2(1.9, 29.7)).r * 0.03125) / 0.96875;
    }
    float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }

    void skyPalette(float se, out vec3 zenith, out vec3 horizon, out vec3 horizonSun) {
      float kDay = smoothstep(0.0, 0.42, se);
      float kNight = 1.0 - smoothstep(-0.16, -0.01, se);
      vec3 zD = vec3(0.075, 0.23, 0.68), zT = vec3(0.08, 0.11, 0.30), zN = vec3(0.006, 0.010, 0.026);
      vec3 hD = vec3(0.40, 0.56, 0.78), hT = vec3(0.42, 0.32, 0.40), hN = vec3(0.020, 0.028, 0.055);
      vec3 sD = vec3(0.78, 0.68, 0.54), sT = vec3(1.00, 0.46, 0.16), sN = vec3(0.08, 0.04, 0.05);
      zenith = mix(mix(zT, zD, kDay), zN, kNight);
      horizon = mix(mix(hT, hD, kDay), hN, kNight);
      horizonSun = mix(mix(sT, sD, kDay), sN, kNight);
    }

    vec3 skyAmbient() {
      vec3 z, h, hs;
      skyPalette(uSunDir.y, z, h, hs);
      return z * 0.55 + h * 0.45 + hs * 0.12;
    }

    // Clear-sky colour in a direction: gradient, horizon haze and the glow around the sun.
    vec3 skyBaseG(vec3 d, float glowK) {
      float se = uSunDir.y;
      vec3 zenith, horizon, horizonSun;
      skyPalette(se, zenith, horizon, horizonSun);
      vec2 dxz = normalize(d.xz + vec2(1e-5, 0.0));
      vec2 sxz = normalize(uSunDir.xz + vec2(1e-5, 0.0));
      float toward = 0.5 + 0.5 * dot(dxz, sxz);
      vec3 hor = mix(horizon, horizonSun, pow(toward, 8.0));
      float h = clamp(d.y, 0.0, 1.0);
      vec3 col = mix(hor, zenith, pow(h, 0.45));
      col += hor * 0.08 * exp(-h * 9.0);
      float mu = max(dot(d, uSunDir), 0.0);
      float glowScale = mix(1.4, 0.55, smoothstep(0.0, 0.5, se)) * smoothstep(-0.15, 0.02, se);
      vec3 glowCol = mix(uSunColor, vec3(1.0), 0.1);
      col += glowCol * (pow(mu, 3.0) * 0.022 + pow(mu, 24.0) * 0.14 + pow(mu, 200.0) * 0.45)
             * glowScale * glowK * (1.0 + 1.5 * (1.0 - h) * (1.0 - h));
      return col;
    }
    vec3 skyBase(vec3 d) { return skyBaseG(d, 1.0); }

    float cloudField(vec2 xz, bool fine) {
      vec2 p = xz * CLOUD_S + uCloudOffset;
      float n = fine ? fbm5(p) : fbm3(p);
      float lo = 0.60 - 0.26 * uCloudCover;
      return smoothstep(lo, lo + 0.11, n) * step(0.001, uCloudCover);
    }

    // How much direct sun reaches a point on the ground through the cloud layer.
    float cloudShadow(vec3 wp) {
      float sy = max(uSunDir.y, 0.14);
      vec2 cxz = wp.xz + uSunDir.xz * ((CLOUD_H - wp.y) / sy);
      return 1.0 - 0.78 * cloudField(cxz, false);
    }

    // Tree shadows: a mask of the trees as seen from the sun, blurred by its mip chain.
    float treeShadow(vec3 wp) {
      vec4 sc = uShadowMatrix * vec4(wp, 1.0);
      vec2 e = step(vec2(0.002), sc.xy) * step(sc.xy, vec2(0.998));
      return 1.0 - textureLod(uShadowMap, sc.xy, 1.0).r * uShadowStrength * e.x * e.y;
    }

    vec3 sunLight() { return uSunColor * (uSunIntensity * SUN_GAIN); }

    // Aerial perspective: fade towards the sky colour in the view direction.
    vec3 applyAtmosphere(vec3 col, vec3 wp) {
      vec3 v = wp - cameraPosition;
      float d = length(v);
      v /= max(d, 1e-4);
      float f = 1.0 - exp(-d * uFogDensity);
      vec3 fc = skyBaseG(normalize(vec3(v.x, 0.03 + max(v.y, 0.0) * 0.4, v.z)), 0.35) * 0.92;
      return mix(col, fc, f);
    }

    // Shared large-scale colour variation of the meadow: lush, pale and dry patches.
    vec3 grassTint(vec2 xz) {
      float a = noiseTex(xz * 0.0045).g;
      float b = noiseTex(xz * 0.021 + vec2(5.0, 9.0)).b;
      float c = noiseTex(xz * 0.11).r;
      float dry = smoothstep(0.42, 0.78, a * 0.65 + b * 0.35);
      vec3 t = mix(vec3(0.80, 1.00, 0.72), vec3(1.42, 1.16, 0.62), dry);
      return t * (0.80 + 0.28 * b + 0.14 * c);
    }
    const vec3 GRASS_ROOT = vec3(0.020, 0.062, 0.010);
    const vec3 GRASS_TIP = vec3(0.150, 0.300, 0.040);
  `;

  /* -------------------------------------------------------------- sun */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // 05:00 sunrise in the east, a high arc through the south, 20:00 sunset in the west.
  function sunFromHours(hours) {
    const f = clamp((hours - 5) / 15, 0, 1);
    const elev = (-7 + 70 * Math.sin(Math.PI * f)) * DEG;
    const az = (f - 0.5) * Math.PI * 1.15;
    const ce = Math.cos(elev);
    const dir = new T.Vector3(Math.sin(az) * ce, Math.sin(elev), -Math.cos(az) * ce);
    const s = dir.y;
    const warm = [1.0, 0.40, 0.12], gold = [1.0, 0.74, 0.44], white = [1.0, 0.96, 0.90];
    const color = s < 0.18 ? lerp3(warm, gold, smoothstep(-0.06, 0.18, s)) : lerp3(gold, white, smoothstep(0.18, 0.6, s));
    const intensity = smoothstep(-0.07, 0.08, s) * (0.55 + 0.45 * smoothstep(0.05, 0.5, s));
    return { dir, color, intensity, elevation: elev, hours };
  }

  function setSun(sun) {
    uniforms.uSunDir.value.copy(sun.dir);
    uniforms.uSunColor.value.setRGB(sun.color[0], sun.color[1], sun.color[2]);
    uniforms.uSunIntensity.value = sun.intensity;
  }

  /* ------------------------------------------------------------- dome */
  function createSky(radius = 9000) {
    const material = new T.ShaderMaterial({
      uniforms,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 wp = vec4(position + cameraPosition, 1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
          gl_Position.z = gl_Position.w * 0.99999;
        }
      `,
      fragmentShader: `
        ${GLSL}
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float se = uSunDir.y;
          vec3 col = skyBase(vec3(d.x, max(d.y, 0.0) , d.z));
          float mu = max(dot(d, uSunDir), 0.0);
          col += uSunColor * smoothstep(0.99988, 0.99995, mu) * 26.0 * (0.15 + uSunIntensity) * step(0.0, d.y);

          float night = 1.0 - smoothstep(-0.16, -0.02, se);
          if (night > 0.001 && d.y > 0.0) {
            vec3 sd = d * 220.0;
            vec3 cell = floor(sd);
            vec3 off = vec3(hash13(cell), hash13(cell + 7.13), hash13(cell + 3.71)) - 0.5;
            float dd = length(fract(sd) - 0.5 - off * 0.7);
            float br = hash13(cell + 11.3);
            float tw = 0.75 + 0.25 * sin(uTime * (2.0 + br * 4.0) + br * 40.0);
            col += vec3(0.9, 0.95, 1.0) * smoothstep(0.08, 0.0, dd) * step(0.9, br) * tw * night * 1.2 * smoothstep(0.0, 0.15, d.y);
          }

          if (d.y > 0.004 && uCloudCover > 0.001) {
            float tHit = (CLOUD_H - min(cameraPosition.y, CLOUD_H - 200.0)) / max(d.y, 0.03);
            vec2 cxz = cameraPosition.xz + d.xz * tHit;
            float dens = cloudField(cxz, true);
            if (dens > 0.001) {
              vec3 zenith, horizon, horizonSun;
              skyPalette(se, zenith, horizon, horizonSun);
              vec2 sxz = normalize(uSunDir.xz + vec2(1e-5, 0.0));
              // Thickness towards the sun: thin edges catch the light, thick middles go grey.
              float toSun = cloudField(cxz + sxz * 260.0, true);
              float lit = clamp(1.0 - toSun * 0.85 + (1.0 - dens) * 0.5, 0.0, 1.0);
              vec3 shade = zenith * 0.50 + horizon * 0.55;
              vec3 bright = sunLight() * 0.34 + shade * 0.75;
              vec3 cc = mix(shade * (0.95 - 0.4 * dens), bright, lit);
              float glowScale = mix(1.4, 0.55, smoothstep(0.0, 0.5, se)) * smoothstep(-0.15, 0.02, se);
              cc += uSunColor * pow(mu, 14.0) * 0.28 * glowScale * (1.0 - dens * 0.8);
              float far = 1.0 - exp(-tHit * 0.000055);            // clouds melt into the haze near the horizon
              cc = mix(cc, skyBaseG(vec3(d.x, 0.04, d.z), 0.35), far);
              col = mix(col, cc, dens * smoothstep(0.0, 0.06, d.y));
            }
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: T.BackSide, depthWrite: false, depthTest: true,
    });
    const mesh = new T.Mesh(new T.SphereGeometry(radius, 48, 24), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    return mesh;
  }

  window.Atmos = { GLSL, uniforms, sunFromHours, setSun, createSky };
})();
