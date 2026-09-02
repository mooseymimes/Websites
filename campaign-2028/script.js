/* GOD 2028 — He's Seen Enough
   The page is a descent. This script:
   - turns the sections into an altimeter and drives the sky colors from scroll
   - makes the Eye follow the cursor
   - throws lightning wherever you click
   - keeps the smite counter honest
   - runs the confession booth and the collection plate (no backend; nothing is sent anywhere)
*/
(function () {
  'use strict';

  const root = document.documentElement;
  const body = document.body;
  const mainEl = document.getElementById('main');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rand = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = (n) => Math.round(n).toLocaleString('en-US');

  /* ---------- Sections & atmosphere ---------- */
  // Per-section sky: [top color, bottom color, clouds, storm, embers]
  const SKY = {
    heaven:       ['#f7ecd2', '#e9d7ab', 1,   0,   0],
    descent:      ['#d3c39c', '#7e8896', .7,  .35, 0],
    candidate:    ['#3a4250', '#1f2530', .15, .9,  0],
    statement:    ['#1c2027', '#12141a', 0,   1,   0],
    planks:       ['#14161c', '#0f1013', 0,   .7,  0],
    forecast:     ['#101116', '#0c0c10', 0,   .5,  .05],
    endorsements: ['#0e0d10', '#0a0a0c', 0,   .3,  .1],
    tour:         ['#0b0a0a', '#120a08', 0,   .2,  .3],
    confession:   ['#100a08', '#1a0c07', 0,   .1,  .5],
    tithe:        ['#1a0c07', '#2a1006', 0,   0,   .8],
    earth:        ['#2a1006', '#000000', 0,   0,   1]
  };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => 'rgb(' + hex(a).map((c, i) => Math.round(lerp(c, hex(b)[i], t))).join(',') + ')';

  const sections = Array.from(document.querySelectorAll('.zone[data-alt]')).map((el) => ({
    el,
    id: el.id,
    name: el.dataset.name,
    alt: el.dataset.alt === 'Infinity' ? 40000 : Number(el.dataset.alt),
    zone: el.dataset.zone,
    sky: SKY[el.id] || SKY.earth,
    top: 0
  }));
  const n = sections.length;

  // Build the altimeter ticks
  const ticks = document.getElementById('altTicks');
  sections.forEach((s, i) => {
    const li = document.createElement('li');
    li.style.top = (i / (n - 1) * 100) + '%';
    const a = document.createElement('a');
    a.href = '#' + s.id;
    a.setAttribute('aria-label', s.name + ', ' + (s.el.dataset.alt === 'Infinity' ? 'infinite' : fmt(s.alt)) + ' feet');
    const label = document.createElement('span');
    label.textContent = (s.el.dataset.alt === 'Infinity' ? '∞' : fmt(s.alt)) + ' · ' + s.name;
    a.appendChild(label);
    li.appendChild(a);
    ticks.appendChild(li);
    s.tick = li;
  });

  const altValue = document.getElementById('altValue');
  const altMarker = document.getElementById('altMarker');
  const wrathFill = document.getElementById('wrathFill');
  let docHeight = 1;

  function measure() {
    sections.forEach((s) => { s.top = s.el.getBoundingClientRect().top + window.scrollY; });
    docHeight = Math.max(1, body.scrollHeight - window.innerHeight);
    update();
  }

  let currentZone = '';
  let currentIdx = -1;
  let ticking = false;

  function update() {
    ticking = false;
    const y = window.scrollY;
    const center = y + window.innerHeight / 2;
    let i = 0;
    for (let k = 0; k < n; k++) if (sections[k].top <= center) i = k;
    const cur = sections[i];
    const next = sections[i + 1];
    const span = next ? (next.top - cur.top) : Math.max(1, body.scrollHeight - cur.top);
    const t = clamp((center - cur.top) / span, 0, 1);

    // Sky
    const a = cur.sky, b = next ? next.sky : cur.sky;
    root.style.setProperty('--sky-a', mix(a[0], b[0], t));
    root.style.setProperty('--sky-b', mix(a[1], b[1], t));
    root.style.setProperty('--clouds', lerp(a[2], b[2], t).toFixed(3));
    root.style.setProperty('--storm', lerp(a[3], b[3], t).toFixed(3));
    root.style.setProperty('--embers', lerp(a[4], b[4], t).toFixed(3));
    const descent = clamp(y / docHeight, 0, 1);
    root.style.setProperty('--descent', descent.toFixed(4));
    wrathFill.style.width = (descent * 100).toFixed(1) + '%';

    // Altitude
    const alt = next ? lerp(cur.alt, next.alt, t) : lerp(cur.alt, 0, t);
    const showInf = (i === 0 && t < .72);
    altValue.textContent = showInf ? '∞' : fmt(Math.max(0, Math.round(alt / 10) * 10));
    altMarker.style.top = ((i + t) / (n - 1) * 100) + '%';

    if (i !== currentIdx) {
      sections.forEach((s, k) => s.tick.classList.toggle('is-active', k === i));
      currentIdx = i;
      document.title = 'GOD 2028 — ' + (showInf ? '∞' : fmt(cur.alt)) + ' FT';
    }
    if (cur.zone !== currentZone) {
      currentZone = cur.zone;
      body.dataset.zone = currentZone;
    }
  }

  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  window.addEventListener('resize', measure);
  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(body);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  measure();

  /* ---------- Reveal on scroll ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } });
  }, { threshold: .25 });
  document.querySelectorAll('.zone--descent, .zone--earth').forEach((el) => io.observe(el));

  const lines = Array.from(document.querySelectorAll('.rant__line'));
  const lio = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const idx = lines.indexOf(e.target);
      e.target.style.transitionDelay = (idx % 4) * 90 + 'ms';
      e.target.classList.add('is-in');
      lio.unobserve(e.target);
    });
  }, { threshold: .6, rootMargin: '0px 0px -10% 0px' });
  lines.forEach((l) => lio.observe(l));

  document.querySelectorAll('.rage').forEach((el) => { el.style.setProperty('--d', (-Math.random() * .3).toFixed(2) + 's'); });

  /* ---------- Ticker: duplicate for a seamless loop ---------- */
  const track = document.getElementById('tickerTrack');
  if (track) track.innerHTML += track.innerHTML;

  /* ---------- The Eye follows you ---------- */
  const eye = document.getElementById('eye');
  const pupil = document.getElementById('pupil');
  const brow = document.querySelector('.eye__brow');
  if (eye && pupil && window.matchMedia('(pointer: fine)').matches) {
    window.addEventListener('pointermove', (ev) => {
      const r = eye.getBoundingClientRect();
      if (r.bottom < -200 || r.top > window.innerHeight + 200) return;
      const cx = r.left + r.width / 2, cy = r.top + r.height * .61;
      const dx = ev.clientX - cx, dy = ev.clientY - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const reach = 13 * Math.min(1, dist / 240);
      pupil.style.transform = 'translate(' + (dx / dist * reach).toFixed(2) + 'px,' + (dy / dist * reach * .6).toFixed(2) + 'px)';
      if (brow) brow.style.transform = 'translateY(' + (Math.min(8, dist / 90)).toFixed(1) + 'px)';
    }, { passive: true });
  }

  /* ---------- Smite counter ---------- */
  const smiteCount = document.getElementById('smiteCount');
  const smiteFooter = document.getElementById('smiteFooter');
  const smiteLatest = document.getElementById('smiteLatest');
  let smitten = 4081;
  const SMITE_TARGETS = [
    'a robocall, Tulsa', 'a reply-all thread, Sacramento', 'a "quick sync," Austin', 'a pothole, Buffalo', 'a fee on a fee, Newark',
    'a scooter left in a doorway', 'a parking prayer (denied)', 'a mattress-store sale', 'a group chat, unnamed', 'a middle seat, row 34',
    'a "per my last email"', 'the phrase "circle back"', 'a hurricane name (reassigned)', 'a checkout-line tip screen', 'a hold-music loop, 41 min',
    'someone microwaving fish, Boise', 'a yacht (seventh)', 'a subscription that would not cancel', 'a check-engine light, ignored since 2019', 'a LinkedIn post about grind'
  ];
  function setSmite() {
    const s = fmt(smitten);
    if (smiteCount) smiteCount.textContent = s;
    if (smiteFooter) smiteFooter.textContent = s;
  }
  function smite(target) {
    smitten += target ? 1 : Math.floor(rand(1, 8));
    if (smiteLatest) smiteLatest.textContent = 'latest: ' + (target || SMITE_TARGETS[Math.floor(Math.random() * SMITE_TARGETS.length)]);
    setSmite();
  }
  (function tickSmite() { setTimeout(() => { smite(); tickSmite(); }, rand(2500, 6500)); })();

  /* ---------- Lightning on click ---------- */
  const flash = document.querySelector('.flash');
  const bolts = document.querySelector('.bolts');
  let lastBolt = 0;

  function boltPath(x0, y0, x1, y1, jitter) {
    const segs = Math.max(6, Math.round(Math.hypot(x1 - x0, y1 - y0) / 40));
    let d = 'M' + x0.toFixed(1) + ' ' + y0.toFixed(1);
    for (let k = 1; k <= segs; k++) {
      const t = k / segs;
      const x = lerp(x0, x1, t) + (k === segs ? 0 : rand(-jitter, jitter));
      const y = lerp(y0, y1, t) + (k === segs ? 0 : rand(-jitter * .4, jitter * .4));
      d += ' L' + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return d;
  }
  function strike(x, y) {
    const now = performance.now();
    if (now - lastBolt < 220) return;
    lastBolt = now;
    const ns = 'http://www.w3.org/2000/svg';
    const main = document.createElementNS(ns, 'path');
    const x0 = x + rand(-160, 160);
    main.setAttribute('d', boltPath(x0, -10, x, y, 26));
    bolts.appendChild(main);
    const branch = document.createElementNS(ns, 'path');
    branch.classList.add('thin');
    const by = rand(.3, .7);
    branch.setAttribute('d', boltPath(lerp(x0, x, by), lerp(-10, y, by), x + rand(-140, 140), y + rand(-60, 40), 18));
    bolts.appendChild(branch);
    setTimeout(() => { main.remove(); branch.remove(); }, 600);
    if (!reduceMotion) {
      root.style.setProperty('--fx', (x / window.innerWidth * 100).toFixed(1) + '%');
      flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on');
      mainEl.classList.remove('tremor'); void mainEl.offsetWidth; mainEl.classList.add('tremor');
    }
    smite('whatever you just clicked on');
  }
  flash.addEventListener('animationend', () => flash.classList.remove('on'));
  mainEl.addEventListener('animationend', (e) => { if (e.target === mainEl) mainEl.classList.remove('tremor'); });
  document.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    if (ev.target.closest('a, button, input, textarea, select, label, .altimeter, form')) return;
    strike(ev.clientX, ev.clientY);
  });

  /* ---------- Toast ---------- */
  const toast = document.getElementById('toast');
  let toastTimer = 0;
  function say(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('on'), 3600);
  }

  /* ---------- Confession booth ---------- */
  const form = document.getElementById('confessForm');
  const boothStatus = document.getElementById('boothStatus');
  if (form) {
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!form.checkValidity()) {
        boothStatus.textContent = 'He noticed the empty fields. He notices everything.';
        form.querySelector(':invalid')?.focus();
        return;
      }
      const roles = form.querySelectorAll('input[name="role"]:checked').length;
      boothStatus.textContent = roles
        ? 'You are forgiven. And enrolled. Expect a call. Not from us.'
        : 'You are forgiven. You are not enrolled. He noticed that too.';
      const btn = form.querySelector('button[type="submit"]');
      btn.textContent = roles ? 'ENROLLED. GO IN PEACE. QUICKLY.' : 'ABSOLVED (PROVISIONALLY)';
      btn.disabled = true;
      say(roles ? 'A yard sign is on its way. It will find you.' : 'Absolution granted. Canvassing still pending.');
    });
  }

  /* ---------- Collection plate ---------- */
  const coins = Array.from(document.querySelectorAll('.coin:not(:disabled)'));
  const plate = document.getElementById('plate');
  const giveBtn = document.getElementById('giveBtn');
  const giveStatus = document.getElementById('giveStatus');
  let chosen = null;

  function dropCoin(fromEl) {
    if (!plate || reduceMotion) return;
    const a = fromEl.getBoundingClientRect(), p = plate.getBoundingClientRect();
    const c = document.createElement('div');
    c.className = 'coin-drop';
    c.style.left = (a.left + a.width / 2 - 22) + 'px';
    c.style.top = (a.top + a.height / 2 - 22) + 'px';
    document.body.appendChild(c);
    const dx = (p.left + p.width / 2 + rand(-80, 80)) - (a.left + a.width / 2);
    const dy = (p.top + p.height / 2) - (a.top + a.height / 2);
    c.animate([
      { transform: 'translate(0,0) rotateX(0)', opacity: 1 },
      { transform: 'translate(' + dx * .5 + 'px,' + (dy * .5 - 90) + 'px) rotateX(360deg)', opacity: 1, offset: .5 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) rotateX(720deg) scale(.6)', opacity: 0 }
    ], { duration: 700, easing: 'cubic-bezier(.3,.8,.4,1)' }).onfinish = () => {
      c.remove();
      plate.classList.remove('is-clink'); void plate.offsetWidth; plate.classList.add('is-clink');
    };
  }
  coins.forEach((btn) => {
    btn.addEventListener('click', () => {
      coins.forEach((b) => b.classList.toggle('is-selected', b === btn));
      chosen = btn.dataset.amount;
      dropCoin(btn);
      giveStatus.textContent = '';
    });
  });
  if (giveBtn) {
    giveBtn.addEventListener('click', () => {
      if (!chosen) {
        giveStatus.textContent = 'He saw you hesitate.';
        say('Pick an amount. He has all day. He has all of the days.');
        return;
      }
      const lines = {
        '$7': 'Seven. One per day. He rested on the seventh; you may not.',
        '$40': 'Forty. He appreciates a theme.',
        '$666': 'Received. He got the joke. He did not laugh.',
        '$2,028': 'The full campaign. He has written your name down. In the good column.',
        '10%': 'Ten percent, as discussed. Finally.'
      };
      giveStatus.textContent = 'Received: ' + chosen + '. ' + (lines[chosen] || 'Received.');
      say('Received. He saw you hesitate. But received.');
      plate.classList.remove('is-clink'); void plate.offsetWidth; plate.classList.add('is-clink');
      smitten += 0; setSmite();
    });
  }

  setSmite();
})();
