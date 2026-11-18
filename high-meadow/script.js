/* ============================================================================
   script.js — renderer, camera, controls, UI wiring and the frame loop.
   The sky lives in atmosphere.js, the land in terrain.js, the meadow in
   grass.js and the groves in trees.js.
   ========================================================================== */
(function () {
  'use strict';
  const T = window.THREE, A = window.Atmos, TR = window.Terrain;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = $('#scene');
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  const params = new URLSearchParams(location.search);

  let renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 required');
  } catch (e) {
    $('#fail').hidden = false;
    document.body.classList.add('is-ready');
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(55, 1, 0.2, 20000);
  camera.rotation.order = 'YXZ';

  const composer = new T.EffectComposer(renderer, new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: small ? 0 : 4 }));
  composer.addPass(new T.RenderPass(scene, camera));
  const bloomPass = new T.UnrealBloomPass(new T.Vector2(1, 1), 0.2, 0.6, 1.0);
  composer.addPass(bloomPass);
  composer.addPass(new T.OutputPass());

  const QUALITIES = ['low', 'medium', 'high', 'ultra'];
  const state = {
    hours: parseFloat(params.get('time')) || 18.5, clouds: 0.4, wind: 0.45, windDeg: 270,
    quality: QUALITIES.includes(params.get('q')) ? params.get('q') : (small ? 'low' : 'high'),
    drift: !reduceMotion, bloom: true,
    x: 0, z: 0, ground: 0, alt: 1.7, altTarget: 1.7, yaw: 0, pitch: -0.03, pitchTarget: null,
    time: 0, sun: null, shadowsDirty: true, ready: false, fps: 60, slowFor: 0, autoTuned: false,
  };
  let grass = null, trees = null;

  /* ----------------------------------------------------------------- world */
  function build() {
    scene.add(A.createSky());
    const terrain = TR.build();
    scene.add(terrain.mesh);
    grass = window.Grass.create(terrain.heightTex);
    scene.add(grass.group);
    trees = window.Trees.create(renderer, {
      count: { low: 900, medium: 1500, high: 2200, ultra: 3000 }[state.quality],
      maskSize: small ? 2048 : 4096,
    });
    scene.add(trees.group);

    // Start on the best nearby vantage point, looking a little to one side of the sun.
    const spot = highGround(0, 0, 150);
    state.x = spot.x; state.z = spot.z;
    state.ground = TR.heightAt(state.x, state.z);
    applySun();
    state.yaw = Math.atan2(-state.sun.dir.x, -state.sun.dir.z) + 0.55;
    applyWind();
    setQuality(state.quality);
  }

  function highGround(cx, cz, radius) {
    let best = { x: cx, z: cz, h: -Infinity };
    for (let z = cz - radius; z <= cz + radius; z += 6) {
      for (let x = cx - radius; x <= cx + radius; x += 6) {
        if (Math.hypot(x, z) > 300) continue;
        const h = TR.heightAt(x, z);
        if (h > best.h) best = { x, z, h };
      }
    }
    return best;
  }

  function applySun() {
    state.sun = A.sunFromHours(state.hours);
    A.setSun(state.sun);
    state.shadowsDirty = true;
    const h = Math.floor(state.hours), m = Math.floor((state.hours - h) * 60);
    $('#timeValue').textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  function applyWind() {
    const a = (state.windDeg + 180) * DEG;                    // the slider is where the wind comes from
    A.uniforms.uWindDir.value.set(Math.sin(a), -Math.cos(a));
    A.uniforms.uWindStrength.value = state.wind * 1.1;
    const names = ['still', 'light air', 'breeze', 'fresh', 'blustery'];
    $('#windValue').textContent = names[Math.min(4, Math.floor(state.wind * 5))];
    $('#windDirValue').textContent = 'from the ' + ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(state.windDeg / 45) % 8];
  }
  function setQuality(q) {
    state.quality = q;
    grass.setQuality(q);
    let blades = 0;
    grass.group.children.forEach((m) => { blades += m.geometry.instanceCount; });
    $('#bladeValue').textContent = blades >= 1e6 ? (blades / 1e6).toFixed(2) + 'M' : Math.round(blades / 1000) + 'k';
    $$('[data-quality]').forEach((b) => b.classList.toggle('is-on', b.dataset.quality === q));
  }

  /* -------------------------------------------------------------- controls */
  const keys = new Set();
  const MOVE = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
  function setDrift(on) { state.drift = on; $('#drift').checked = on; }
  function setView(name) {
    $$('[data-view]').forEach((b) => b.classList.toggle('is-on', b.dataset.view === name));
    if (name === 'meadow') { state.altTarget = 1.7; state.pitchTarget = -0.03; }
    else if (name === 'low') { state.altTarget = 0.42; state.pitchTarget = 0.10; }
    else if (name === 'aerial') { state.altTarget = 120; state.pitchTarget = -0.30; }
    else if (name === 'hilltop') {
      const spot = highGround(state.x, state.z, 220);
      state.x = spot.x; state.z = spot.z; state.ground = spot.h;
      state.altTarget = 2.4; state.pitchTarget = -0.10;
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if (MOVE[e.code]) { keys.add(e.code); setDrift(false); e.preventDefault(); }
    else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.add('Shift');
    else if (e.code === 'KeyG') setDrift(!state.drift);
    else if (e.code.startsWith('Digit')) { const v = ['meadow', 'low', 'hilltop', 'aerial'][+e.code.slice(5) - 1]; if (v) setView(v); }
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code.startsWith('Shift')) keys.delete('Shift'); });
  window.addEventListener('blur', () => keys.clear());

  const pointers = new Map();
  let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.classList.add('is-dragging');
    pinch = 0;
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) {
      const k = 0.0032 * (camera.fov / 55);
      state.yaw -= dx * k;
      state.pitch = clamp(state.pitch - dy * k, -1.45, 1.2);
      state.pitchTarget = null;
    } else if (pointers.size === 2) {                          // pinch: change altitude
      const [a, b] = Array.from(pointers.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) state.altTarget = clamp(state.altTarget * pinch / d, 0.35, 240);
      pinch = d;
    }
  });
  const release = (e) => { pointers.delete(e.pointerId); pinch = 0; if (!pointers.size) canvas.classList.remove('is-dragging'); };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.altTarget = clamp(state.altTarget * Math.exp(e.deltaY * 0.0012), 0.35, 240);
    $$('[data-view]').forEach((b) => b.classList.remove('is-on'));
  }, { passive: false });

  function move(dt) {
    let fx = 0, fz = 0;
    for (const k of keys) { const m = MOVE[k]; if (m) { fx += m[0]; fz += m[1]; } }
    const pace = (1 + state.alt * 0.22) * (keys.has('Shift') ? 3.2 : 1);
    if (state.drift && !reduceMotion) {
      fz = 1;
      // Meander, and turn for home before the edge of the walkable land.
      state.yaw += (Math.sin(state.time * 0.11) * 0.035 + Math.sin(state.time * 0.047 + 2.0) * 0.03) * dt;
      const r = Math.hypot(state.x, state.z);
      if (r > 230) {
        const home = Math.atan2(state.x, state.z);              // yaw that faces the origin
        let d = home - state.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        state.yaw += d * Math.min(1, (r - 230) / 80) * 0.5 * dt;
      }
    }
    const len = Math.hypot(fx, fz);
    if (len > 0) {
      const speed = (state.drift ? 1.5 : 4.2) * pace / len * dt;
      const s = Math.sin(state.yaw), c = Math.cos(state.yaw);
      state.x += (-s * fz + c * fx) * speed;
      state.z += (-c * fz - s * fx) * speed;
    }
    const r = Math.hypot(state.x, state.z);
    if (r > 320) { state.x *= 320 / r; state.z *= 320 / r; }
    if (state.alt < 6) trees.pushOut(state, 0.8);

    const follow = 1 - Math.exp(-dt * (state.alt < 10 ? 9 : 2.5));
    state.ground += (TR.heightAt(state.x, state.z) - state.ground) * follow;
    state.alt += (state.altTarget - state.alt) * (1 - Math.exp(-dt * 2.6));
    if (state.pitchTarget !== null) {
      state.pitch += (state.pitchTarget - state.pitch) * (1 - Math.exp(-dt * 2.6));
      if (Math.abs(state.pitchTarget - state.pitch) < 0.002) state.pitchTarget = null;
    }
    const y = Math.max(state.ground + state.alt, TR.heightAt(state.x, state.z) + 0.3);
    camera.position.set(state.x, y, state.z);
    camera.rotation.set(state.pitch, state.yaw, 0);
    camera.updateMatrixWorld();
  }

  /* -------------------------------------------------------------------- UI */
  $('#time').addEventListener('input', (e) => { state.hours = parseFloat(e.target.value); applySun(); });
  $('#clouds').addEventListener('input', (e) => { state.clouds = e.target.value / 100; A.uniforms.uCloudCover.value = state.clouds; $('#cloudsValue').textContent = e.target.value + '%'; });
  $('#wind').addEventListener('input', (e) => { state.wind = e.target.value / 100; applyWind(); });
  $('#windDir').addEventListener('input', (e) => { state.windDeg = +e.target.value; applyWind(); });
  $('#drift').addEventListener('change', (e) => setDrift(e.target.checked));
  $('#bloom').addEventListener('change', (e) => { state.bloom = e.target.checked; bloomPass.enabled = state.bloom; });
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $$('[data-quality]').forEach((b) => b.addEventListener('click', () => { state.autoTuned = true; setQuality(b.dataset.quality); }));
  $('#panelToggle').addEventListener('click', () => {
    const open = $('#panel').classList.toggle('is-open');
    $('#panelToggle').setAttribute('aria-expanded', String(open));
  });
  $('#time').value = state.hours;
  $('#drift').checked = state.drift;

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w < h ? 68 : 55;                               // wider on portrait phones
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  /* ------------------------------------------------------------ frame loop */
  let last = performance.now(), frames = 0, fpsAt = last;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    state.time += dt;

    const u = A.uniforms, wd = u.uWindDir.value;
    u.uTime.value = state.time;
    u.uWindOffset.value.x += wd.x * dt * (0.03 + 0.16 * state.wind);
    u.uWindOffset.value.y += wd.y * dt * (0.03 + 0.16 * state.wind);
    u.uCloudOffset.value.x -= wd.x * dt * (0.0015 + 0.008 * state.wind);
    u.uCloudOffset.value.y -= wd.y * dt * (0.0015 + 0.008 * state.wind);

    move(dt);
    grass.update(camera);
    if (state.shadowsDirty) { trees.updateShadows(state.sun); state.shadowsDirty = false; }
    bloomPass.strength = 0.16 + 0.14 * (1 - state.sun.intensity);
    composer.render();

    frames++;
    if (now - fpsAt > 500) {
      state.fps = frames * 1000 / (now - fpsAt);
      $('#fpsValue').textContent = Math.round(state.fps);
      // One automatic step down if the default is clearly too heavy for this machine.
      if (!state.autoTuned && state.time > 2) {
        state.slowFor = state.fps < 26 ? state.slowFor + 1 : 0;
        if (state.slowFor >= 5) { state.autoTuned = true; setQuality(state.quality === 'high' ? 'medium' : 'low'); }
      }
      frames = 0; fpsAt = now;
    }
  }

  // Let the loader paint before the heavy lifting.
  requestAnimationFrame(() => setTimeout(() => {
    build();
    A.uniforms.uCloudCover.value = state.clouds;
    setView('meadow');
    resize();
    move(0);
    last = performance.now(); fpsAt = last;
    requestAnimationFrame(frame);
    state.ready = true;
    document.body.classList.add('is-ready');
  }, 30));

  window.HighMeadow = { state, setView, setQuality };
})();
