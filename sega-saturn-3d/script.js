/* ============================================================================
   script.js — scene, lighting, camera, UI wiring and the animation loop for the
   Sega Saturn 3D page. The console itself is built in model.js.
   ========================================================================== */
(function () {
  'use strict';
  const T = window.THREE;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = $('#scene');

  /* ------------------------------------------------------------ renderer */
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;   // phones: cheaper shadows and DPR
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;

  const scene = new T.Scene();
  scene.background = new T.Color(0x090a0f);
  const pmrem = new T.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new T.RoomEnvironment(), 0.04).texture;

  const camera = new T.PerspectiveCamera(34, 1, 0.5, 500);
  const controls = new T.OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 20; controls.maxDistance = 120;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.enablePan = false;
  controls.autoRotateSpeed = 0.7;
  controls.target.set(0, 3.6, 0);

  /* -------------------------------------------------------------- lights */
  const key = new T.DirectionalLight(0xffffff, 2.8);
  key.position.set(18, 30, 20); key.castShadow = true;
  key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  key.shadow.camera.near = 5; key.shadow.camera.far = 90;
  key.shadow.camera.left = key.shadow.camera.bottom = -24;
  key.shadow.camera.right = key.shadow.camera.top = 24;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; key.shadow.radius = 4;
  const fill = new T.DirectionalLight(0x8fb0ff, 0.9); fill.position.set(-24, 14, -8);
  const rim = new T.DirectionalLight(0xb99cff, 1.2); rim.position.set(-6, 10, -30);
  const hemi = new T.HemisphereLight(0x3a4a7a, 0x05060a, 0.5);
  scene.add(key, fill, rim, hemi);

  // Floor: a soft disc that fades into the background and catches the shadow.
  const fc = document.createElement('canvas'); fc.width = fc.height = 512;
  const fx = fc.getContext('2d'), fg = fx.createRadialGradient(256, 256, 40, 256, 256, 256);
  fg.addColorStop(0, '#fff'); fg.addColorStop(0.55, '#777'); fg.addColorStop(1, '#000');
  fx.fillStyle = fg; fx.fillRect(0, 0, 512, 512);
  const floor = new T.Mesh(new T.CircleGeometry(75, 72), new T.MeshStandardMaterial({ color: 0x151722, roughness: 0.92, metalness: 0, transparent: true, alphaMap: new T.CanvasTexture(fc) }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.33; floor.receiveShadow = true;
  scene.add(floor);

  /* --------------------------------------------------------------- state */
  const state = {
    power: false, lidOpen: false, lidAngle: 0, spin: 0, explode: 0, explodeTarget: 0,
    blinkUntil: 0, hotspots: true, autoRotate: !reduceMotion, paused: false, idleTimer: 0,
    tween: null, hover: null, press: null, ready: false, intro: reduceMotion ? 1 : 0,
  };
  let model = null;
  const VIEWS = {
    hero:  { pos: [31, 19, 40], target: [1.5, 3.4, 0] },
    front: { pos: [0, 12, 52], target: [1.5, 3.2, 0] },
    top:   { pos: [1.5, 58, 0.6], target: [1.5, 3, 0] },
    rear:  { pos: [-24, 16, -42], target: [-1.5, 3.4, 0] },
    ports: { pos: [-9, 5.5, 33], target: [-3.5, 2.0, 8] },
  };
  camera.position.set(...VIEWS.hero.pos);

  function tweenTo(pos, target, dur = 1.1) {
    if (reduceMotion) { camera.position.copy(pos); controls.target.copy(target); return; }
    state.tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), t: 0, dur };
  }
  function setView(name) { const v = VIEWS[name]; if (v) tweenTo(new T.Vector3(...v.pos), new T.Vector3(...v.target)); }

  /* ------------------------------------------------------------ hotspots */
  const hsLayer = $('#hotspots'), card = $('#card'), guide = $('#guideList');
  const hsEls = new Map();
  function buildHotspots() {
    model.hotspots.forEach((h, i) => {
      const b = document.createElement('button');
      b.className = 'hotspot'; b.type = 'button'; b.dataset.id = h.id;
      b.innerHTML = `<span class="hotspot__dot">${i + 1}</span><span class="hotspot__label">${h.title}</span>`;
      b.addEventListener('click', () => focusHotspot(h));
      hsLayer.appendChild(b); hsEls.set(h.id, b);
      const li = document.createElement('li');
      li.innerHTML = `<button type="button" class="guide__item"><span class="guide__num">${i + 1}</span>${h.title}</button>`;
      li.firstChild.addEventListener('click', () => focusHotspot(h));
      guide.appendChild(li);
    });
  }
  const _wp = new T.Vector3(), _q = new T.Quaternion(), _n = new T.Vector3(), _v = new T.Vector3();
  function focusHotspot(h) {
    h.anchor.getWorldPosition(_wp); h.anchor.parent.getWorldQuaternion(_q);
    _n.copy(h.normal).applyQuaternion(_q);
    const dir = _n.clone().add(new T.Vector3(0, 0.6, 0)).normalize();
    tweenTo(_wp.clone().addScaledVector(dir, 22), _wp.clone());
    $('.card__title', card).textContent = h.title;
    $('.card__body', card).textContent = h.body;
    card.hidden = false;
    hsEls.forEach((el, id) => el.classList.toggle('is-active', id === h.id));
  }
  function updateHotspots() {
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    for (const h of model.hotspots) {
      const el = hsEls.get(h.id);
      if (!state.hotspots) { el.hidden = true; continue; }
      h.anchor.getWorldPosition(_wp); h.anchor.parent.getWorldQuaternion(_q);
      _n.copy(h.normal).applyQuaternion(_q);
      const facing = _n.dot(_v.copy(camera.position).sub(_wp).normalize());
      _v.copy(_wp).project(camera);
      const visible = facing > 0.1 && _v.z < 1 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05;
      el.hidden = !visible;
      if (!visible) continue;
      el.style.transform = `translate(${((_v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - _v.y) / 2 * hgt).toFixed(1)}px)`;
      el.style.opacity = Math.min(1, (facing - 0.1) * 3).toFixed(2);
    }
  }

  /* ---------------------------------------------------------- interaction */
  const ray = new T.Raycaster(), ptr = new T.Vector2();
  let downAt = null;
  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(model.interactives, false)[0];
    return hit ? hit.object : null;
  }
  canvas.addEventListener('pointerdown', ev => { downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', ev => {
    if (!downAt || !model) return;
    const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
    if (moved < 6 && performance.now() - downAt.t < 500) { const o = pick(ev); if (o) doAction(o.userData.action, o); }
    downAt = null;
  });
  canvas.addEventListener('pointermove', ev => {
    if (!model || ev.pointerType === 'touch') return;
    const o = pick(ev);
    if (o !== state.hover) {
      if (state.hover) state.hover.scale.setScalar(1);
      state.hover = o; canvas.style.cursor = o ? 'pointer' : '';
      if (o && o.userData.action !== 'lid') o.scale.setScalar(1.05);
    }
  });
  controls.addEventListener('start', () => { state.paused = true; clearTimeout(state.idleTimer); });
  controls.addEventListener('end', () => { state.idleTimer = setTimeout(() => { state.paused = false; }, 3500); });

  function doAction(action, mesh) {
    const now = performance.now() / 1000;
    if (action === 'power') {
      state.power = !state.power;
      if (state.power && !state.lidOpen) state.blinkUntil = now + 4.5;
    } else if (action === 'reset') {
      if (state.power) state.blinkUntil = now + 2.5;
    } else if (action === 'open' || action === 'lid') {
      state.lidOpen = !state.lidOpen;
      if (!state.lidOpen && state.power) state.blinkUntil = now + 4;
    }
    if (mesh && action !== 'lid') state.press = { mesh, until: now + 0.14 };
    syncUI();
  }
  function syncUI() {
    $('#btnPower').setAttribute('aria-pressed', String(state.power));
    $('#btnOpen').setAttribute('aria-pressed', String(state.lidOpen));
    $('#btnOpen .btn__text').textContent = state.lidOpen ? 'Close lid' : 'Open lid';
    $('#ledPower').classList.toggle('is-on', state.power);
    document.body.classList.toggle('is-powered', state.power);
  }

  /* ------------------------------------------------------------------ UI */
  function wireUI() {
    $('#btnPower').addEventListener('click', () => doAction('power', model.interactives[0]));
    $('#btnReset').addEventListener('click', () => doAction('reset', model.interactives[2]));
    $('#btnOpen').addEventListener('click', () => doAction('open', model.interactives[1]));
    $$('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
    const ar = $('#autoRotate'); ar.checked = state.autoRotate;
    ar.addEventListener('change', () => { state.autoRotate = ar.checked; });
    $('#wireframe').addEventListener('change', ev => model.setWireframe(ev.target.checked));
    $('#explode').addEventListener('input', ev => { state.explodeTarget = ev.target.value / 100; });
    const ht = $('#hotspotsToggle'); ht.checked = state.hotspots;
    ht.addEventListener('change', () => { state.hotspots = ht.checked; if (!ht.checked) card.hidden = true; });
    $$('input[name="finish"]').forEach(r => r.addEventListener('change', () => { if (r.checked) model.setVariant(r.value); }));
    $('.card__close', card).addEventListener('click', () => { card.hidden = true; hsEls.forEach(el => el.classList.remove('is-active')); });
    const panel = $('#panel'), toggle = $('#panelToggle');
    toggle.addEventListener('click', () => {
      const open = panel.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    window.addEventListener('keydown', ev => {
      if (ev.target.closest('input, textarea')) return;
      const k = ev.key.toLowerCase();
      if (k === 'escape') { card.hidden = true; panel.classList.remove('is-open'); }
      else if (k === 'p') doAction('power', model.interactives[0]);
      else if (k === 'o') doAction('open', model.interactives[1]);
      else if (k === 'r') setView('hero');
      else if (k === 'e') { state.explodeTarget = state.explodeTarget > 0.5 ? 0 : 1; $('#explode').value = state.explodeTarget * 100; }
    });
  }

  /* --------------------------------------------------------------- loop */
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
  }
  const clock = new T.Clock();
  function frame() {
    requestAnimationFrame(frame);
    resize();
    const dt = Math.min(clock.getDelta(), 0.05), now = performance.now() / 1000;

    if (state.intro < 1) {
      state.intro = Math.min(1, state.intro + dt / 1.6);
      const e = 1 - Math.pow(1 - state.intro, 3);
      model.group.position.y = (1 - e) * -2.5; model.group.rotation.y = (1 - e) * -0.7;
    }
    if (state.tween) {
      const tw = state.tween; tw.t = Math.min(1, tw.t + dt / tw.dur);
      const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - Math.pow(-2 * tw.t + 2, 3) / 2;
      camera.position.lerpVectors(tw.p0, tw.p1, e); controls.target.lerpVectors(tw.t0, tw.t1, e);
      if (tw.t >= 1) state.tween = null;
    }
    controls.autoRotate = state.autoRotate && !state.paused && !state.tween && state.intro >= 1;
    controls.update();

    // Lid hinge, disc spin, exploded view.
    const lidTarget = state.lidOpen ? 1.26 : 0;
    state.lidAngle += (lidTarget - state.lidAngle) * Math.min(1, dt * 5.5);
    model.setLidAngle(state.lidAngle);
    const spinTarget = state.power && !state.lidOpen ? 13 : 0;
    state.spin += (spinTarget - state.spin) * Math.min(1, dt * 1.8);
    model.spinner.rotation.y += state.spin * dt;
    state.explode += (state.explodeTarget - state.explode) * Math.min(1, dt * 4);
    model.setExplode(state.explode);
    if (state.press) {
      const m = state.press.mesh, active = now < state.press.until;
      m.position.y = m.userData.restY === undefined ? (m.userData.restY = m.position.y) : m.userData.restY - (active ? 0.09 : 0);
      if (!active) { state.press = null; }
    }

    // LEDs.
    model.setPowerLed(state.power);
    let access = false;
    if (state.power && !state.lidOpen) {
      if (now < state.blinkUntil) access = (now * 9) % 2 < 1.1;
      else access = (now % 3.3) < 0.09;
    }
    model.setAccessLed(access);
    $('#ledAccess').classList.toggle('is-on', access);

    updateHotspots();
    renderer.render(scene, camera);
    if (!state.ready) { state.ready = true; document.body.classList.add('is-ready'); window.__saturnReady = true; }
  }

  /* ---------------------------------------------------------------- boot */
  const fontsReady = Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise(r => setTimeout(r, 1500))]);
  fontsReady.then(() => {
    model = window.SaturnModel.build();
    scene.add(model.group);
    buildHotspots(); wireUI(); syncUI();
    // Web fonts may land after the 1.5 s grace period: redraw the canvas labels when they do.
    if (document.fonts) document.fonts.ready.then(() => model.refreshLabels());
    window.addEventListener('resize', resize);
    window.__saturn = { model, scene, camera, controls, state, setView, doAction, setVariant: v => model.setVariant(v), setExplode: t => { state.explodeTarget = t; }, setLid: o => { state.lidOpen = o; syncUI(); } };
    frame();
  });
})();
