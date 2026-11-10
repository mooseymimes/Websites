/* ============================================================================
   game.js — Mach Tide: a small arcade jet shooter over open ocean.
   The player's jet sits near z = 0 and flies toward -z; the world streams past.
   ========================================================================== */
(function () {
  'use strict';
  const T = window.THREE;
  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);

  /* ------------------------------------------------------------ tuning */
  const FIELD_X = 22;              // half-width of the playable area
  const FIELD_Y = [2.5, 17];       // altitude limits
  const CRUISE = 220;              // apparent forward speed (ocean / cloud scroll)
  const SPAWN_Z = -750;
  const MAX_MISSILES = 6;
  const HAZE = 0xbfd9ec;

  /* ------------------------------------------------------------ renderer + scene */
  const canvas = $('#scene');
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new T.Scene();
  scene.fog = new T.Fog(HAZE, 250, 1900);
  const camera = new T.PerspectiveCamera(60, 1, 0.5, 6000);

  scene.add(new T.HemisphereLight(0xdcefff, 0x1b4f80, 1.6));
  const sunLight = new T.DirectionalLight(0xfff2d6, 2.2);
  sunLight.position.set(-0.4, 1, -0.6);
  scene.add(sunLight);

  function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const tex = new T.CanvasTexture(c);
    if ('colorSpace' in tex) tex.colorSpace = T.SRGBColorSpace;
    return tex;
  }

  /* ------------------------------------------------------------ sky, sun, ocean, clouds */
  const sky = new T.Mesh(
    new T.SphereGeometry(5000, 24, 16),
    new T.MeshBasicMaterial({
      side: T.BackSide, fog: false, depthWrite: false,
      map: canvasTexture(4, 256, (g, w, h) => {
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#1560b8');
        grad.addColorStop(0.3, '#3d8bd6');
        grad.addColorStop(0.47, '#a8cdea');
        grad.addColorStop(0.5, '#bfd9ec');
        grad.addColorStop(1, '#bfd9ec');
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
      }),
    })
  );
  scene.add(sky);

  const sun = new T.Sprite(new T.SpriteMaterial({
    fog: false, depthWrite: false, transparent: true, blending: T.AdditiveBlending,
    map: canvasTexture(128, 128, (g) => {
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, 'rgba(255,255,240,1)');
      grad.addColorStop(0.18, 'rgba(255,244,200,0.95)');
      grad.addColorStop(0.4, 'rgba(255,220,150,0.25)');
      grad.addColorStop(1, 'rgba(255,220,150,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    }),
  }));
  sun.scale.setScalar(1100);
  scene.add(sun);

  const OCEAN_TILE = 120;
  const oceanTex = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#0c4f8c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 520; i++) {
      const x = Math.random() * w, y = 3 + Math.random() * (h - 6);
      const len = rand(8, 46), light = Math.random() < 0.7;
      g.strokeStyle = light
        ? `rgba(${150 + Math.random() * 100 | 0},215,255,${rand(0.08, 0.5)})`
        : `rgba(2,30,70,${rand(0.15, 0.45)})`;
      g.lineWidth = rand(1, 3);
      for (const ox of [0, -w]) {            // draw twice so strokes wrap horizontally
        g.beginPath();
        g.moveTo(x + ox, y);
        g.quadraticCurveTo(x + ox + len / 2, y - rand(0, 3), x + ox + len, y);
        g.stroke();
      }
    }
  });
  oceanTex.wrapS = oceanTex.wrapT = T.RepeatWrapping;
  oceanTex.repeat.set(8000 / OCEAN_TILE, 8000 / OCEAN_TILE);
  oceanTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const ocean = new T.Mesh(new T.PlaneGeometry(8000, 8000), new T.MeshBasicMaterial({ map: oceanTex }));
  ocean.rotation.x = -Math.PI / 2;
  scene.add(ocean);

  const cloudMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  const puffGeo = new T.SphereGeometry(1, 8, 6);
  const clouds = [];
  function placeCloud(c, z) {
    const side = Math.random() < 0.5 ? -1 : 1;
    c.position.set(side * rand(70, 420), rand(35, 140), z);
  }
  for (let i = 0; i < 18; i++) {
    const c = new T.Group();
    const n = 3 + (Math.random() * 4 | 0);
    for (let j = 0; j < n; j++) {
      const p = new T.Mesh(puffGeo, cloudMat);
      p.position.set(rand(-30, 30), rand(-4, 4), rand(-20, 20));
      p.scale.set(rand(18, 34), rand(7, 12), rand(16, 30));
      c.add(p);
    }
    placeCloud(c, rand(-1900, 0));
    scene.add(c); clouds.push(c);
  }

  /* ------------------------------------------------------------ jets */
  const wingShape = (pts) => {
    const s = new T.Shape();
    pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
    const geo = new T.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);                // shape +y becomes the nose direction (-z)
    return geo;
  };
  const jetGeo = {
    body: new T.CylinderGeometry(0.42, 0.62, 5, 8).rotateX(-Math.PI / 2),
    nose: new T.ConeGeometry(0.42, 2.2, 8).rotateX(-Math.PI / 2),
    canopy: new T.SphereGeometry(1, 10, 8),
    wing: wingShape([[0, 1.6], [3.9, -1.9], [3.9, -2.6], [0, -2.1], [-3.9, -2.6], [-3.9, -1.9]]),
    tail: wingShape([[0, -1.6], [1.9, -2.9], [1.9, -3.4], [0, -3.1], [-1.9, -3.4], [-1.9, -2.9]]),
    fin: new T.BoxGeometry(0.1, 1.5, 1.3),
    burner: new T.SphereGeometry(0.3, 8, 6),
  };
  const burnerMat = new T.MeshBasicMaterial({ color: 0xffa436 });
  const canopyMat = new T.MeshPhongMaterial({ color: 0x10243c, shininess: 90, flatShading: true });

  function makeJet(color, trim) {
    const g = new T.Group();
    const skin = new T.MeshPhongMaterial({ color, flatShading: true, shininess: 30 });
    const trimMat = new T.MeshPhongMaterial({ color: trim, flatShading: true, shininess: 30 });
    const add = (geo, mat, x, y, z) => {
      const m = new T.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m;
    };
    add(jetGeo.body, skin, 0, 0, 0);
    add(jetGeo.nose, trimMat, 0, 0, -3.6);
    add(jetGeo.canopy, canopyMat, 0, 0.38, -1.5).scale.set(0.34, 0.32, 1.1);
    add(jetGeo.wing, skin, 0, -0.1, 0);
    add(jetGeo.tail, trimMat, 0, 0, 0.5);
    add(jetGeo.fin, trimMat, 0.55, 0.8, 2).rotation.z = -0.3;
    add(jetGeo.fin, trimMat, -0.55, 0.8, 2).rotation.z = 0.3;
    g.userData.burners = [add(jetGeo.burner, burnerMat, 0.28, 0, 2.6), add(jetGeo.burner, burnerMat, -0.28, 0, 2.6)];
    return g;
  }

  const player = makeJet(0xdfe6ee, 0x2f6fd0);
  player.position.set(0, 9, 0);
  scene.add(player);

  /* ------------------------------------------------------------ shared effect assets */
  const bulletGeo = new T.BoxGeometry(0.16, 0.16, 6);
  const bulletMat = new T.MeshBasicMaterial({ color: 0xfff27a });
  const shotGeo = new T.SphereGeometry(0.75, 8, 6);
  const shotMat = new T.MeshBasicMaterial({ color: 0xff5a2a });
  const missileGeo = new T.CylinderGeometry(0.16, 0.16, 2.4, 6).rotateX(Math.PI / 2);
  const missileMat = new T.MeshBasicMaterial({ color: 0xffffff });
  const puffMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
  const boomGeo = new T.SphereGeometry(1, 12, 8);

  const ringGeo = (r, seg) => {
    const pts = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2 + Math.PI / seg;
      pts.push(new T.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
    }
    return new T.BufferGeometry().setFromPoints(pts);
  };
  const reticle = new T.LineLoop(ringGeo(3.6, 24), new T.LineBasicMaterial({ color: 0x7dffb0, fog: false }));
  const lockBox = new T.LineLoop(ringGeo(5, 4), new T.LineBasicMaterial({ color: 0xff3b30, fog: false }));
  reticle.visible = lockBox.visible = false;
  scene.add(reticle, lockBox);

  /* ------------------------------------------------------------ audio (tiny synth) */
  let actx = null, muted = false, noiseBuf = null;
  function initAudio() {
    if (actx) { actx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function envelope(vol, dur) {
    const g = actx.createGain();
    g.gain.setValueAtTime(vol, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
    g.connect(actx.destination);
    return g;
  }
  function tone(type, f0, f1, dur, vol) {
    if (!actx || muted) return;
    const o = actx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, actx.currentTime);
    o.frequency.exponentialRampToValueAtTime(f1, actx.currentTime + dur);
    o.connect(envelope(vol, dur));
    o.start(); o.stop(actx.currentTime + dur);
  }
  function noise(dur, vol, cutoff) {
    if (!actx || muted) return;
    const src = actx.createBufferSource();
    src.buffer = noiseBuf;
    const f = actx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cutoff;
    src.connect(f); f.connect(envelope(vol, dur));
    src.start(); src.stop(actx.currentTime + dur);
  }

  /* ------------------------------------------------------------ state */
  const hud = { root: $('#hud'), score: $('#score'), best: $('#best'), hull: $('#hull'), missiles: $('#missiles') };
  const overlay = $('#overlay'), message = $('#message'), startBtn = $('#start'), flash = $('#flash');

  let best = 0;
  try { best = +localStorage.getItem('mach-tide-best') || 0; } catch (e) { /* storage unavailable */ }

  const input = { x: 0, y: 0, fire: false, touch: false };
  const enemies = [], bullets = [], shots = [], missiles = [], booms = [], puffs = [];
  const game = {
    state: 'title', time: 0, score: 0, hull: 100, ammo: MAX_MISSILES,
    spawnIn: 1.5, gunIn: 0, missileIn: 0, reloadIn: 0, shake: 0, flash: 0, lock: null, gunSide: 1,
  };
  const vel = { x: 0, y: 0 };

  function clear(list) {
    list.forEach((o) => scene.remove(o.mesh || o));
    list.length = 0;
  }

  function drawHud() {
    hud.score.textContent = game.score;
    hud.best.textContent = Math.max(best, game.score);
    hud.hull.style.width = Math.max(0, game.hull) + '%';
    hud.hull.classList.toggle('low', game.hull <= 30);
    let pips = '';
    for (let i = 0; i < MAX_MISSILES; i++) pips += `<i class="${i < game.ammo ? 'on' : ''}"></i>`;
    hud.missiles.innerHTML = pips;
  }

  function startGame() {
    initAudio();
    [enemies, bullets, shots, missiles, booms, puffs].forEach(clear);
    Object.assign(game, {
      state: 'playing', time: 0, score: 0, hull: 100, ammo: MAX_MISSILES,
      spawnIn: 1.2, gunIn: 0, missileIn: 0, reloadIn: 0, shake: 0, flash: 0, lock: null,
    });
    input.fire = false;
    player.visible = true;
    overlay.hidden = true;
    hud.root.hidden = false;
    document.body.classList.add('playing');
    drawHud();
  }

  function endGame() {
    game.state = 'over';
    game.lock = null;
    player.visible = false;
    explode(player.position, 16);
    noise(1.4, 0.6, 500);
    const newBest = game.score > best;
    if (newBest) {
      best = game.score;
      try { localStorage.setItem('mach-tide-best', best); } catch (e) { /* storage unavailable */ }
    }
    document.body.classList.remove('playing');
    setTimeout(() => {
      message.textContent = `Shot down.\nScore ${game.score}` + (newBest ? ' — new best!' : `  ·  Best ${best}`);
      startBtn.textContent = 'Fly again';
      overlay.hidden = false;
      startBtn.focus();
    }, 1300);
  }

  /* ------------------------------------------------------------ spawning + effects */
  function spawnEnemy(x, y) {
    const mesh = makeJet(0x6b7078, 0xc8372d);
    mesh.rotation.y = Math.PI;                 // nose toward the player
    mesh.position.set(x, y, SPAWN_Z);
    scene.add(mesh);
    enemies.push({
      mesh, x0: x, y0: y, t: rand(0, 6),
      speed: rand(105, 150) + Math.min(game.time, 120) * 0.4,
      ampX: rand(0, 7), ampY: rand(0, 3), freq: rand(0.8, 1.8),
      fireIn: rand(0.8, 2.2),
    });
  }

  function spawnWave() {
    const x = rand(-FIELD_X + 4, FIELD_X - 4), y = rand(FIELD_Y[0] + 2, FIELD_Y[1] - 2);
    if (Math.random() < 0.3) {
      for (let i = -1; i <= 1; i++) spawnEnemy(clamp(x + i * 7, -FIELD_X, FIELD_X), y + Math.abs(i) * 1.5);
    } else {
      spawnEnemy(x, y);
    }
  }

  function explode(pos, size) {
    for (const [color, scale, life] of [[0xffb347, 1, 0.55], [0xffffff, 0.55, 0.3]]) {
      const mesh = new T.Mesh(boomGeo, new T.MeshBasicMaterial({ color, transparent: true, fog: false }));
      mesh.position.copy(pos);
      scene.add(mesh);
      booms.push({ mesh, size: size * scale, life, age: 0 });
    }
  }

  function killEnemy(i) {
    const e = enemies[i];
    explode(e.mesh.position, 9);
    scene.remove(e.mesh);
    enemies.splice(i, 1);
    if (game.lock === e) game.lock = null;
    game.score += 100;
    noise(0.5, 0.35, 900);
    drawHud();
  }

  function hurt(amount) {
    if (game.state !== 'playing') return;
    game.hull -= amount;
    game.shake = 0.6; game.flash = 1;
    noise(0.3, 0.5, 300);
    drawHud();
    if (game.hull <= 0) endGame();
  }

  function fireMissile() {
    if (game.state !== 'playing' || !game.lock || game.ammo <= 0 || game.missileIn > 0) return;
    const mesh = new T.Mesh(missileGeo, missileMat);
    mesh.position.copy(player.position); mesh.position.y -= 0.6;
    scene.add(mesh);
    missiles.push({ mesh, target: game.lock, vel: new T.Vector3(0, -6, -260), life: 4, puffIn: 0 });
    game.ammo--; game.missileIn = 0.3;
    tone('sawtooth', 500, 90, 0.5, 0.12);
    drawHud();
  }

  /* ------------------------------------------------------------ input */
  window.addEventListener('pointermove', (e) => {
    input.x = clamp((e.clientX / window.innerWidth) * 2 - 1, -1, 1);
    input.y = clamp((e.clientY / window.innerHeight) * 2 - 1, -1, 1);
  });
  canvas.addEventListener('pointerdown', (e) => {
    input.touch = e.pointerType === 'touch';
    input.x = clamp((e.clientX / window.innerWidth) * 2 - 1, -1, 1);
    input.y = clamp((e.clientY / window.innerHeight) * 2 - 1, -1, 1);
    if (e.button === 2) fireMissile(); else input.fire = true;
  });
  window.addEventListener('pointerup', (e) => { if (e.button !== 2) input.fire = false; });
  window.addEventListener('pointercancel', () => { input.fire = false; });
  window.addEventListener('blur', () => { input.fire = false; });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      if (game.state === 'playing') { e.preventDefault(); fireMissile(); }
    } else if (e.code === 'KeyM') {
      muted = !muted;
    }
  });
  startBtn.addEventListener('click', startGame);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  /* ------------------------------------------------------------ simulation */
  const tmp = new T.Vector3();

  function updatePlayer(dt) {
    const p = player.position;
    const tx = input.x * FIELD_X;
    const ty = T.MathUtils.lerp(FIELD_Y[1], FIELD_Y[0], (input.y + 1) / 2);
    const k = 1 - Math.exp(-5 * dt);
    const nx = p.x + (tx - p.x) * k, ny = p.y + (ty - p.y) * k;
    vel.x = (nx - p.x) / dt; vel.y = (ny - p.y) / dt;
    p.x = nx; p.y = ny;
    const ease = 1 - Math.exp(-10 * dt);
    player.rotation.z += (clamp(-vel.x * 0.045, -1.2, 1.2) - player.rotation.z) * ease;
    player.rotation.x += (clamp(vel.y * 0.03, -0.5, 0.5) - player.rotation.x) * ease;
    const flick = 1.6 + Math.random() * 1.2;
    player.userData.burners.forEach((b) => { b.scale.z = flick; });
  }

  function updateCombat(dt) {
    const p = player.position;
    game.time += dt;

    // spawn
    game.spawnIn -= dt;
    if (game.spawnIn <= 0) {
      spawnWave();
      game.spawnIn = Math.max(0.5, 1.6 - game.time * 0.012) * rand(0.7, 1.3);
    }

    // cannon
    game.gunIn -= dt;
    if (input.fire && game.gunIn <= 0) {
      const mesh = new T.Mesh(bulletGeo, bulletMat);
      game.gunSide = -game.gunSide;
      mesh.position.set(p.x + game.gunSide * 0.9, p.y, -5);
      scene.add(mesh); bullets.push(mesh);
      game.gunIn = 0.075;
      tone('square', 620, 180, 0.07, 0.04);
    }

    // missile reload + lock
    game.missileIn -= dt;
    if (game.ammo < MAX_MISSILES) {
      game.reloadIn += dt;
      if (game.reloadIn >= 2.5) { game.reloadIn = 0; game.ammo++; drawHud(); }
    }
    let lock = null, bestD = 10;
    for (const e of enemies) {
      const m = e.mesh.position;
      if (m.z > -30 || m.z < -560) continue;
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d < bestD) { bestD = d; lock = e; }
    }
    if (lock && lock !== game.lock) tone('sine', 1300, 1300, 0.06, 0.06);
    game.lock = lock;
    if (input.touch && input.fire && lock) fireMissile();

    // player bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      const z0 = b.position.z;
      b.position.z -= 650 * dt;
      let hit = false;
      for (let j = enemies.length - 1; j >= 0; j--) {
        const m = enemies[j].mesh.position;
        if (m.z < z0 + 4 && m.z > b.position.z - 4 &&
            Math.abs(m.x - b.position.x) < 4.2 && Math.abs(m.y - b.position.y) < 2.4) {
          killEnemy(j); hit = true; break;
        }
      }
      if (hit || b.position.z < SPAWN_Z) { scene.remove(b); bullets.splice(i, 1); }
    }

    // missiles
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i];
      m.life -= dt;
      const alive = enemies.indexOf(m.target);
      if (alive >= 0) {
        tmp.copy(m.target.mesh.position).sub(m.mesh.position);
        if (tmp.length() < 7) {
          killEnemy(alive);
          scene.remove(m.mesh); missiles.splice(i, 1);
          continue;
        }
        m.vel.lerp(tmp.normalize().multiplyScalar(420), 1 - Math.exp(-7 * dt));
      } else {
        m.vel.lerp(tmp.set(0, 0, -420), 1 - Math.exp(-3 * dt));
      }
      m.mesh.position.addScaledVector(m.vel, dt);
      m.mesh.lookAt(tmp.copy(m.mesh.position).add(m.vel));
      m.puffIn -= dt;
      if (m.puffIn <= 0) {
        m.puffIn = 0.03;
        const puff = new T.Mesh(puffGeo, puffMat);
        puff.position.copy(m.mesh.position);
        puff.scale.setScalar(0.5);
        scene.add(puff); puffs.push({ mesh: puff, age: 0 });
      }
      if (m.life <= 0 || m.mesh.position.z < SPAWN_Z) { scene.remove(m.mesh); missiles.splice(i, 1); }
    }

    // enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i], m = e.mesh.position;
      e.t += dt;
      const px = m.x;
      m.z += e.speed * dt;
      m.x = clamp(e.x0 + Math.sin(e.t * e.freq) * e.ampX, -FIELD_X, FIELD_X);
      m.y = clamp(e.y0 + Math.cos(e.t * e.freq * 1.3) * e.ampY, FIELD_Y[0], FIELD_Y[1] + 2);
      e.mesh.rotation.z = clamp((m.x - px) / dt * 0.06, -1, 1);
      e.fireIn -= dt;
      if (e.fireIn <= 0 && m.z > -520 && m.z < -140) {
        e.fireIn = rand(1.5, 3);
        const mesh = new T.Mesh(shotGeo, shotMat);
        mesh.position.copy(m);
        scene.add(mesh);
        shots.push({ mesh, vel: tmp.copy(p).sub(m).normalize().multiplyScalar(175).clone() });
      }
      if (Math.abs(m.z) < 4 && Math.abs(m.x - p.x) < 5 && Math.abs(m.y - p.y) < 2) {
        killEnemy(i); hurt(30);
      } else if (m.z > 30) {
        if (game.lock === e) game.lock = null;
        scene.remove(e.mesh); enemies.splice(i, 1);
      }
    }

    // enemy shots
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i], m = s.mesh.position;
      const z0 = m.z;
      m.addScaledVector(s.vel, dt);
      if (z0 <= 1 && m.z >= -1 && Math.abs(m.x - p.x) < 2.9 && Math.abs(m.y - p.y) < 1.5) {
        scene.remove(s.mesh); shots.splice(i, 1);
        hurt(15);
      } else if (m.z > 30) {
        scene.remove(s.mesh); shots.splice(i, 1);
      }
    }
  }

  function updateEffects(dt) {
    for (let i = booms.length - 1; i >= 0; i--) {
      const b = booms[i];
      b.age += dt;
      b.mesh.position.z += CRUISE * 0.4 * dt;
      const k = b.age / b.life;
      b.mesh.scale.setScalar(1 + (b.size - 1) * Math.sqrt(Math.min(k, 1)));
      b.mesh.material.opacity = 1 - k;
      if (k >= 1) { scene.remove(b.mesh); b.mesh.material.dispose(); booms.splice(i, 1); }
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const s = puffs[i];
      s.age += dt;
      s.mesh.scale.setScalar(0.5 + s.age * 2.5);
      if (s.age > 0.5) { scene.remove(s.mesh); puffs.splice(i, 1); }
    }

    oceanTex.offset.y = (oceanTex.offset.y + CRUISE * dt / OCEAN_TILE) % 1;
    for (const c of clouds) {
      c.position.z += CRUISE * dt;
      if (c.position.z > 150) placeCloud(c, -1900);
    }

    game.shake = Math.max(0, game.shake - dt * 1.6);
    game.flash = Math.max(0, game.flash - dt * 2.5);
    flash.style.opacity = game.flash;
  }

  function updateCamera() {
    const p = player.position, s = game.shake * 1.2;
    camera.position.set(p.x * 0.72 + rand(-s, s), p.y * 0.8 + 3.2 + rand(-s, s), 16);
    camera.lookAt(p.x * 0.8, p.y * 0.86 + 0.5, -90);
    camera.rotateZ(player.rotation.z * 0.22);
    sky.position.copy(camera.position);
    sun.position.set(camera.position.x - 900, 900, -4200);

    const playing = game.state === 'playing';
    reticle.visible = playing;
    reticle.position.set(p.x, p.y, -110);
    lockBox.visible = playing && !!game.lock;
    if (lockBox.visible) {
      lockBox.position.copy(game.lock.mesh.position);
      lockBox.rotation.z += 0.08;
      lockBox.scale.setScalar(Math.max(1, -lockBox.position.z / 130));   // stay readable at range
    }
  }

  /* ------------------------------------------------------------ loop */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05) || 0.001;
    last = now;
    if (game.state !== 'over') updatePlayer(dt);
    if (game.state === 'playing') updateCombat(dt);
    updateEffects(dt);
    updateCamera();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  hud.best.textContent = best;
  requestAnimationFrame(frame);
})();
