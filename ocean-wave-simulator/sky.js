/* ============================================================================
   sky.js — procedural sky, sun and clouds.

   One GLSL function, skyRadiance(dir, cloudOctaves), gives the colour of the
   sky in any direction. The sky dome draws it directly, the water uses it for
   reflections and horizon fog, and the environment map for the barrels is
   rendered from it. Everything is driven by the sun direction, so the whole
   scene stays consistent as the time of day changes.

   Exposes window.OceanSky = { GLSL, uniforms, sunFromHours, setSun, createSky }
   ========================================================================== */
(function () {
  'use strict';
  const T = window.THREE;
  const DEG = Math.PI / 180;

  const uniforms = {
    uSunDir: { value: new T.Vector3(0, 1, 0) },
    uSunColor: { value: new T.Color(1, 1, 1) },
    uSunIntensity: { value: 1 },
    uCloudCover: { value: 0.35 },
    uSkyTime: { value: 0 },
    uEnvMode: { value: 0 },        // 1 while rendering the environment map
  };

  const GLSL = `
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform float uSunIntensity;
    uniform float uCloudCover;
    uniform float uSkyTime;
    uniform float uEnvMode;

    float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
                 mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float fbm(vec2 p, int oct) {
      float a = 0.5, s = 0.0;
      for (int i = 0; i < 6; i++) {
        if (i >= oct) break;
        s += a * vnoise(p);
        p = p * 2.07 + vec2(31.7, 17.3);
        a *= 0.5;
      }
      return s;
    }

    // Key colours for the current sun height (linear RGB).
    void skyPalette(float se, out vec3 zenith, out vec3 horizon, out vec3 horizonSun) {
      float kDay = smoothstep(0.0, 0.42, se);
      float kNight = 1.0 - smoothstep(-0.16, -0.01, se);
      vec3 zD = vec3(0.08, 0.24, 0.66), zT = vec3(0.08, 0.11, 0.30), zN = vec3(0.006, 0.010, 0.026);
      vec3 hD = vec3(0.34, 0.50, 0.74), hT = vec3(0.40, 0.30, 0.40), hN = vec3(0.020, 0.028, 0.055);
      vec3 sD = vec3(0.72, 0.60, 0.46), sT = vec3(1.00, 0.44, 0.15), sN = vec3(0.08, 0.04, 0.05);
      zenith = mix(mix(zT, zD, kDay), zN, kNight);
      horizon = mix(mix(hT, hD, kDay), hN, kNight);
      horizonSun = mix(mix(sT, sD, kDay), sN, kNight);
    }

    vec3 skyAmbient(float se) {
      vec3 z, h, hs;
      skyPalette(se, z, h, hs);
      return z * 0.5 + h * 0.4 + hs * 0.1;
    }

    vec3 skyRadiance(vec3 d, int cloudOct) {
      float se = uSunDir.y;
      vec3 zenith, horizon, horizonSun;
      skyPalette(se, zenith, horizon, horizonSun);

      vec2 dxz = normalize(d.xz + vec2(1e-5, 0.0));
      vec2 sxz = normalize(uSunDir.xz + vec2(1e-5, 0.0));
      float toward = 0.5 + 0.5 * dot(dxz, sxz);
      vec3 hor = mix(horizon, horizonSun, pow(toward, 8.0));

      float h = clamp(d.y, 0.0, 1.0);
      vec3 col = mix(hor, zenith, pow(h, 0.45));
      col += hor * 0.08 * exp(-h * 9.0);                     // bright haze band on the horizon

      // Glow around the sun: broad, medium and tight lobes, stronger near the horizon.
      float mu = max(dot(d, uSunDir), 0.0);
      float glowScale = mix(1.4, 0.55, smoothstep(0.0, 0.5, se)) * smoothstep(-0.15, 0.02, se);
      vec3 glowCol = mix(uSunColor, vec3(1.0), 0.1);
      col += glowCol * (pow(mu, 3.0) * 0.035 + pow(mu, 24.0) * 0.14 + pow(mu, 200.0) * 0.45)
             * glowScale * (1.0 + 1.5 * (1.0 - h) * (1.0 - h));

      // The sun disc itself (HDR: bloom picks it up).
      float disc = smoothstep(0.99988, 0.99995, mu);
      col += uSunColor * disc * 26.0 * (0.15 + uSunIntensity);

      #ifdef SKY_FULL
      float night = 1.0 - smoothstep(-0.16, -0.02, se);
      if (night > 0.001 && d.y > 0.0) {
        vec3 sd = d * 220.0;
        vec3 cell = floor(sd);
        vec3 fp = fract(sd) - 0.5;
        vec3 off = vec3(hash13(cell), hash13(cell + 7.13), hash13(cell + 3.71)) - 0.5;
        float dd = length(fp - off * 0.7);
        float br = hash13(cell + 11.3);
        float tw = 0.75 + 0.25 * sin(uSkyTime * (2.0 + br * 4.0) + br * 40.0);
        col += vec3(0.9, 0.95, 1.0) * smoothstep(0.08, 0.0, dd) * step(0.9, br) * tw * night * 1.2 * smoothstep(0.0, 0.15, d.y);
      }
      #endif

      // Clouds: a noise layer on a plane high above, lit from the sun's side.
      if (cloudOct > 0 && d.y > 0.005 && uCloudCover > 0.001) {
        float cf = smoothstep(0.0, 0.14, d.y);
        vec2 cp = d.xz / max(d.y, 0.02);
        cp = cp * 0.28 + uSkyTime * vec2(0.010, 0.006);
        float n = fbm(cp, cloudOct);
        float lo = 0.72 - 0.40 * uCloudCover, hi = lo + 0.22;
        float dens = smoothstep(lo, hi, n);
        if (dens > 0.001) {
          float n2 = fbm(cp + sxz * 0.06, cloudOct);
          float lit = clamp(0.5 + (n - n2) * 7.0, 0.0, 1.0);
          vec3 sunLight = uSunColor * uSunIntensity;
          vec3 shade = zenith * 0.55 + horizon * 0.45;
          vec3 bright = sunLight * 0.85 + shade * 0.6;
          vec3 cc = mix(shade * (1.0 - 0.45 * dens), bright, lit * (1.0 - 0.5 * dens));
          cc += glowCol * pow(mu, 6.0) * 0.4 * glowScale * (1.0 - dens);
          col = mix(col, cc, dens * cf);
        }
      }

      // Below the horizon: distant haze normally, dark sea for the environment map.
      if (d.y < 0.0) {
        vec3 sea = mix(hor * 0.8, vec3(0.012, 0.035, 0.06) * (0.4 + 0.6 * smoothstep(0.0, 0.4, se)), uEnvMode);
        col = mix(col, sea, smoothstep(0.0, -0.12, d.y));
      }
      return col;
    }
  `;

  /* -------------------------------------------------------------- sun */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // 05:00 → sunrise on the left, 12:30 → high in front of the camera, 20:00 → sunset on the right.
  function sunFromHours(hours) {
    const f = clamp((hours - 5) / 15, 0, 1);
    const elev = (-7 + 72 * Math.sin(Math.PI * f)) * DEG;
    const az = (f - 0.5) * Math.PI;
    const ce = Math.cos(elev);
    const dir = new T.Vector3(Math.sin(az) * ce, Math.sin(elev), -Math.cos(az) * ce);
    const s = dir.y;
    const warm = [1.0, 0.40, 0.12], gold = [1.0, 0.72, 0.42], white = [1.0, 0.96, 0.90];
    const color = s < 0.18 ? lerp3(warm, gold, smoothstep(-0.06, 0.18, s)) : lerp3(gold, white, smoothstep(0.18, 0.55, s));
    const intensity = smoothstep(-0.07, 0.08, s) * (0.55 + 0.45 * smoothstep(0.05, 0.5, s));
    return { dir, color, intensity, elevation: elev, hours };
  }

  function setSun(sun) {
    uniforms.uSunDir.value.copy(sun.dir);
    uniforms.uSunColor.value.setRGB(sun.color[0], sun.color[1], sun.color[2]);
    uniforms.uSunIntensity.value = sun.intensity;
  }

  /* ------------------------------------------------------------- dome */
  function createSky(radius = 4000) {
    const material = new T.ShaderMaterial({
      uniforms,
      defines: { SKY_FULL: '' },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vDir = wp.xyz - cameraPosition;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        ${GLSL}
        varying vec3 vDir;
        void main() {
          vec3 col = skyRadiance(normalize(vDir), 5);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      side: T.BackSide,
      depthWrite: false,
      fog: false,
    });
    const geometry = new T.SphereGeometry(radius, 48, 24);
    const mesh = new T.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    return { mesh, material, geometry, uniforms };
  }

  window.OceanSky = { GLSL, uniforms, sunFromHours, setSun, createSky };
})();
