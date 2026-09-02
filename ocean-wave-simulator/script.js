/* ============================================================================
   script.js — renderer, camera, lighting, UI wiring and the frame loop for
   the ocean page. The water lives in ocean.js, the barrels in barrels.js.
   ========================================================================== */
(function () {
  'use strict';
  const T = window.THREE, W = window.OceanWaves, SKY = window.OceanSky, OC = window.Ocean, BR = window.Barrels, AU = window.OceanAudio;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const DEG = Math.PI / 180;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = $('#scene');
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;   // phones: lighter grid, no bloom

  /* ------------------------------------------------------------ renderer */
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(50, 1, 0.3, 12000);
  camera.position.set(0, 7.5, 28);
  const controls = new T.OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.minDistance = 4; controls.maxDistance = 240;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.screenSpacePanning = false;          // panning slides along the sea, never up or down
  controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.8; controls.panSpeed = 0.9;
  controls.target.set(0, 0, 0);

  /* --------------------------------------------------------------- world */
  const sky = SKY.createSky();
  scene.add(sky.mesh);
  const envScene = new T.Scene();
  envScene.add(new T.Mesh(sky.geometry, sky.material));      // same sky, rendered into the environment map
  const pmrem = new T.PMREMGenerator(renderer);
  const sun = new T.DirectionalLight(0xffffff, 3);
  scene.add(sun);

  const foam = new OC.FoamMap(renderer, 256, small ? 512 : 1024);
  const ocean = new OC.Ocean({ segments: small ? 220 : 400, half: 1500, detailSize: small ? 256 : 512, foam, anisotropy: renderer.capabilities.getMaxAnisotropy() });
  scene.add(ocean.mesh);
  const splashes = new OC.Splashes(small ? 1500 : 3000);
  scene.add(splashes.points);
  const world = new BR.World({ water: ocean.sampler, foam, onSplash });
  scene.add(world.casks, world.drums);

  /* ------------------------------------------------------ post-processing */
  const composer = new T.EffectComposer(renderer, new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: small ? 0 : 4 }));
  composer.addPass(new T.RenderPass(scene, camera));
  const bloomPass = new T.UnrealBloomPass(new T.Vector2(1, 1), 0.22, 0.5, 1.0);
  composer.addPass(bloomPass);
  composer.addPass(new T.OutputPass());

  /* --------------------------------------------------------------- state */
  const state = {
    hours: 18.4, seaState: 0.45, choppiness: 0.65, windDeg: 40, clouds: 0.35,
    kind: 'cask', fill: 0.45, follow: false, wireframe: false, bloom: !small, sound: false,
    sun: null, envDirty: true, envAt: -1, envRT: null,
    tween: null, intro: reduceMotion ? 1 : 0, ready: false, fps: 0, time: 0,
  };

  function applySpectrum() {
    const spec = W.buildSpectrum({ windDir: state.windDeg * DEG, seaState: state.seaState, choppiness: state.choppiness, seed: 1337 });
    ocean.setSpectrum(spec);
    world.setWind(Math.cos(state.windDeg * DEG), Math.sin(state.windDeg * DEG), spec.windSpeed);
    AU.setSea(state.seaState);
  }

  function applySun() {
    const s = SKY.sunFromHours(state.hours);
    SKY.setSun(s);
    sun.position.copy(s.dir).multiplyScalar(300);
    sun.color.setRGB(s.color[0], s.color[1], s.color[2]);
    sun.intensity = 0.1 + 3.6 * s.intensity;
    state.sun = s;
    state.envDirty = true;
  }

  // The barrels are lit by an environment map baked from the sky; rebake when the light changes.
  function updateEnvironment(now) {
    if (!state.envDirty || now - state.envAt < 0.25) return;
    SKY.uniforms.uEnvMode.value = 1;
    const rt = pmrem.fromScene(envScene, 0, 1, 8000);
    SKY.uniforms.uEnvMode.value = 0;
    if (state.envRT) state.envRT.dispose();
    state.envRT = rt;
    scene.environment = rt.texture;
    state.envDirty = false;
    state.envAt = now;
  }

  /* -------------------------------------------------------------- camera */
  function tweenTo(pos, target, dur = 1.4) {
    if (reduceMotion) { camera.position.copy(pos); controls.target.copy(target); return; }
    state.tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), t: 0, dur };
  }
  function setView(name) {
    const tg = controls.target.clone();
    tg.y = 0;
    let pos;
    if (name === 'deck') pos = tg.clone().add(new T.Vector3(0, 3.2, 22));
    else if (name === 'aerial') pos = tg.clone().add(new T.Vector3(0, 75, 60));
    else if (name === 'sunward') {
      const d = state.sun.dir.clone(); d.y = 0; d.normalize();
      pos = tg.clone().addScaledVector(d, -40); pos.y = 2.2;
    } else pos = tg.clone().add(new T.Vector3(0, 7.5, 28));
    tweenTo(pos, tg);
  }

  const _cent = new T.Vector3();
  function updateFollow(dt) {
    if (!state.follow || !world.barrels.length || state.tween) return;
    _cent.set(0, 0, 0);
    for (const b of world.barrels) _cent.add(b.p);
    _cent.divideScalar(world.barrels.length);
    const k = 1 - Math.exp(-dt * 1.2);
    const dx = (_cent.x - controls.target.x) * k, dz = (_cent.z - controls.target.z) * k;
    controls.target.x += dx; controls.target.z += dz;
    camera.position.x += dx; camera.position.z += dz;
  }

  /* ---------------------------------------------------------- dropping */
  const ray = new T.Raycaster(), ptr = new T.Vector2(), sea = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3();
  const pickKind = () => state.kind === 'mixed' ? (Math.random() < 0.5 ? 'cask' : 'drum') : state.kind;

  function dropAtPointer(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ptr.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    if (!ray.ray.intersectPlane(sea, hit)) { toast('Aim at the water'); return; }
    if (hit.distanceTo(controls.target) > 150) { toast('Too far out — drop closer'); return; }
    world.drop(hit.x, hit.z, pickKind(), state.fill, 7 + Math.random() * 3);
  }
  function dropNear(n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = 1.5 + Math.random() * (3 + n * 0.8);
      world.drop(controls.target.x + Math.cos(a) * d, controls.target.z + Math.sin(a) * d, pickKind(), state.fill, 7 + Math.random() * 6);
    }
  }
  function onSplash(b, strength, y) {
    splashes.burst(b.p.x, y, b.p.z, strength);
    AU.splash(strength);
  }

  let down = null;
  canvas.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    down = { x: ev.clientX, y: ev.clientY, t: performance.now(), id: ev.pointerId };
    AU.unlock();
  });
  canvas.addEventListener('pointerup', ev => {
    if (!down || ev.pointerId !== down.id) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    if (moved < 8 && performance.now() - down.t < 450) dropAtPointer(ev.clientX, ev.clientY);
    down = null;
  });
  canvas.addEventListener('pointercancel', () => { down = null; });

  /* ------------------------------------------------------------------ UI */
  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
  }
  const fmtTime = h => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60) % 60; return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };
  const compass = deg => {
    // Waves travel toward `deg` in the XZ plane; north is away from the default camera (-Z).
    const dx = Math.cos(deg * DEG), dz = Math.sin(deg * DEG);
    const heading = ((Math.atan2(dx, -dz) / DEG) + 360) % 360;
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(heading / 45) % 8];
  };
  const seaLabel = s => s < 0.12 ? 'calm' : s < 0.3 ? 'light' : s < 0.5 ? 'moderate' : s < 0.7 ? 'rough' : s < 0.86 ? 'very rough' : 'high';

  function updateReadouts() {
    $('#timeValue').textContent = fmtTime(state.hours);
    $('#windValue').textContent = `${Math.round(state.windDeg)}° ${compass(state.windDeg)}`;
    $('#seaValue').textContent = seaLabel(state.seaState);
    $('#fillValue').textContent = `${Math.round(state.fill * 100)}% full`;
  }

  function wireUI() {
    const slider = (id, value, fn) => { const el = $(id); el.value = value; el.addEventListener('input', () => fn(+el.value)); return el; };
    slider('#sea', state.seaState * 100, v => { state.seaState = v / 100; applySpectrum(); updateReadouts(); });
    slider('#chop', state.choppiness * 100, v => { state.choppiness = v / 100; applySpectrum(); });
    slider('#wind', state.windDeg, v => { state.windDeg = v; applySpectrum(); updateReadouts(); });
    slider('#time', state.hours, v => { state.hours = v; applySun(); updateReadouts(); });
    slider('#clouds', state.clouds * 100, v => { state.clouds = v / 100; SKY.uniforms.uCloudCover.value = state.clouds; state.envDirty = true; });
    slider('#fill', state.fill * 100, v => { state.fill = v / 100; updateReadouts(); });

    $('#btnDrop').addEventListener('click', () => { dropNear(1); AU.unlock(); });
    $('#btnDrop10').addEventListener('click', () => { dropNear(10); AU.unlock(); });
    $('#btnClear').addEventListener('click', () => world.clear());
    $$('input[name="kind"]').forEach(r => r.addEventListener('change', () => { if (r.checked) state.kind = r.value; }));
    $$('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

    const toggle = (id, value, fn) => { const el = $(id); el.checked = value; el.addEventListener('change', () => fn(el.checked)); return el; };
    const follow = toggle('#follow', state.follow, v => { state.follow = v; });
    const wire = toggle('#wireframe', state.wireframe, v => { state.wireframe = v; ocean.wireframe = v; });
    toggle('#bloom', state.bloom, v => { state.bloom = v; });
    const sound = toggle('#sound', state.sound, v => { state.sound = v; AU.setEnabled(v); });
    const flip = el => { el.checked = !el.checked; el.dispatchEvent(new Event('change')); };

    const panel = $('#panel'), panelToggle = $('#panelToggle');
    panelToggle.addEventListener('click', () => {
      const open = panel.classList.toggle('is-open');
      panelToggle.setAttribute('aria-expanded', String(open));
    });

    window.addEventListener('keydown', ev => {
      if (ev.target.closest('input, textarea, select, button')) return;
      const k = ev.key.toLowerCase();
      if (k === ' ') { ev.preventDefault(); dropNear(1); AU.unlock(); }
      else if (k === 'b') dropNear(10);
      else if (k === 'c') world.clear();
      else if (k === 'f') flip(follow);
      else if (k === 'w') flip(wire);
      else if (k === 'm') flip(sound);
      else if (k === 'r') setView('default');
      else if (k === '1') setView('deck');
      else if (k === '2') setView('aerial');
      else if (k === '3') setView('sunward');
      else if (k === 'escape') { panel.classList.remove('is-open'); panelToggle.setAttribute('aria-expanded', 'false'); }
    });
  }

  /* ---------------------------------------------------------------- loop */
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight, pr = renderer.getPixelRatio();
    if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) {
      renderer.setSize(w, h, false);
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  let last = performance.now(), frames = 0, fpsAt = 0;
  function frame() {
    requestAnimationFrame(frame);
    resize();
    const nowMs = performance.now();
    const dt = Math.min((nowMs - last) / 1000, 0.05);
    last = nowMs;
    state.time += dt;

    if (state.intro < 1) {
      state.intro = Math.min(1, state.intro + dt / 2.6);
      const e = 1 - Math.pow(1 - state.intro, 3);
      camera.position.set(0, 7.5 + (1 - e) * 30, 28 + (1 - e) * 60);
    }
    if (state.tween) {
      const tw = state.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - Math.pow(-2 * tw.t + 2, 3) / 2;
      camera.position.lerpVectors(tw.p0, tw.p1, e);
      controls.target.lerpVectors(tw.t0, tw.t1, e);
      if (tw.t >= 1) state.tween = null;
    }
    updateFollow(dt);
    controls.update();
    const minY = ocean.maxAmp * 1.25 + 1.0;               // never dip the camera into a wave
    if (camera.position.y < minY) camera.position.y = minY;
    ocean.setCenter(controls.target.x, controls.target.z);
    if (Math.hypot(controls.target.x - foam.center.x, controls.target.z - foam.center.y) > 56) {
      foam.recenter(renderer, Math.round(controls.target.x / 8) * 8, Math.round(controls.target.z / 8) * 8);
    }

    foam.begin();
    world.update(dt);                                     // physics (also paints wakes into the foam map)
    const now = world.time;
    ocean.setTime(now);
    foam.update(renderer, dt);
    ocean.setFoam(foam);
    splashes.update(now, canvas.height / (2 * Math.tan(camera.fov * DEG / 2)));
    SKY.uniforms.uSkyTime.value = now;
    updateEnvironment(now);

    if (state.bloom) composer.render(); else renderer.render(scene, camera);

    frames++;
    if (state.time - fpsAt >= 0.5) {
      state.fps = Math.round(frames / (state.time - fpsAt));
      frames = 0; fpsAt = state.time;
      $('#fpsValue').textContent = state.fps;
      $('#countValue').textContent = world.barrels.length;
    }
    if (!state.ready) { state.ready = true; document.body.classList.add('is-ready'); window.__oceanReady = true; }
  }

  /* ---------------------------------------------------------------- boot */
  const fontsReady = Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise(r => setTimeout(r, 1500))]);
  fontsReady.then(() => {
    SKY.uniforms.uCloudCover.value = state.clouds;
    applySpectrum();
    applySun();
    wireUI();
    updateReadouts();
    window.addEventListener('resize', resize);
    window.__ocean = {
      scene, camera, controls, renderer, ocean, world, foam, splashes, state, setView, applySpectrum, applySun, dropNear,
      drop: (x, z, kind, fill) => world.drop(x, z, kind || pickKind(), fill ?? state.fill),
    };
    frame();
    // A few barrels to start with.
    if (reduceMotion) dropNear(4);
    else { let n = 0; const iv = setInterval(() => { dropNear(1); if (++n >= 4) clearInterval(iv); }, 550); }
  });
})();
