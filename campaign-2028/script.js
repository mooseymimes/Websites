/* GOD 2028 — He's Seen Enough
   The page is a descent. This script:
   - turns the sections into an altimeter and drives the sky colors from scroll
   - makes the Eye follow the cursor
   - throws lightning wherever you click
   - keeps the smite counter honest
   - counts down to Election Day and rules on prayers
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
    questions:    ['#0c0b0d', '#0e0a09', 0,   .25, .2],
    tour:         ['#0b0a0a', '#120a08', 0,   .2,  .3],
    prayer:       ['#0e0a09', '#160b07', 0,   .15, .4],
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
  const jumpList = document.getElementById('jumpList');
  const jumpBtn = document.getElementById('jumpBtn');
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

    const altText = s.el.dataset.alt === 'Infinity' ? '∞' : fmt(s.alt);
    s.el.dataset.label = altText + ' FT — ' + s.name;
    if (jumpList) {
      const jli = document.createElement('li');
      const ja = document.createElement('a');
      ja.href = '#' + s.id;
      const jn = document.createElement('span');
      jn.textContent = s.name;
      const jb = document.createElement('b');
      jb.textContent = altText + ' ft';
      ja.append(jn, jb);
      jli.appendChild(ja);
      jumpList.appendChild(jli);
      s.jump = jli;
    }
  });

  // Section menu (the altimeter rail is hidden on small screens)
  function setJump(open) {
    if (!jumpList || !jumpBtn) return;
    jumpList.hidden = !open;
    jumpBtn.setAttribute('aria-expanded', String(open));
  }
  if (jumpBtn && jumpList) {
    jumpBtn.addEventListener('click', () => setJump(jumpList.hidden));
    jumpList.addEventListener('click', (ev) => { if (ev.target.closest('a')) setJump(false); });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !jumpList.hidden) { setJump(false); jumpBtn.focus(); } });
    document.addEventListener('click', (ev) => { if (!jumpList.hidden && !ev.target.closest('.altimeter')) setJump(false); });
  }

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
      sections.forEach((s, k) => {
        s.tick.classList.toggle('is-active', k === i);
        if (s.jump) s.jump.classList.toggle('is-active', k === i);
      });
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

  /* ---------- Thunder (off until asked for) ---------- */
  const soundBtn = document.getElementById('soundBtn');
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audio = null;
  let soundOn = false;
  if (soundBtn) {
    if (!AudioCtx) soundBtn.hidden = true;
    soundBtn.addEventListener('click', () => {
      soundOn = !soundOn;
      if (soundOn && !audio) audio = new AudioCtx();
      if (soundOn && audio.state === 'suspended') audio.resume();
      soundBtn.setAttribute('aria-pressed', String(soundOn));
      soundBtn.textContent = 'THUNDER: ' + (soundOn ? 'ON' : 'OFF');
      if (soundOn) { thunder(); say('Thunder enabled. Click anywhere. He will take it from there.'); }
    });
  }
  function thunder() {
    if (!soundOn || !audio) return;
    const t0 = audio.currentTime;
    const dur = 2.6;
    const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * dur), audio.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let k = 0; k < data.length; k++) {
      // brown-ish noise: rumbles instead of hissing
      last = (last + .04 * (Math.random() * 2 - 1)) / 1.04;
      data[k] = last * 9;
    }
    const src = audio.createBufferSource();
    src.buffer = buf;
    const lp = audio.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t0);
    lp.frequency.exponentialRampToValueAtTime(90, t0 + dur);
    const gain = audio.createGain();
    gain.gain.setValueAtTime(.0001, t0);
    gain.gain.exponentialRampToValueAtTime(.55, t0 + .03);
    gain.gain.exponentialRampToValueAtTime(.18, t0 + .5);
    gain.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    src.connect(lp).connect(gain).connect(audio.destination);
    src.start(t0);
    src.stop(t0 + dur);
  }

  /* ---------- Lightning on click ---------- */
  let strikes = 0;
  const STRIKE_NOTES = {
    5: 'Five smitings. That is traditionally His job.',
    12: 'You are enjoying this. He has noted that you are enjoying this.',
    25: 'Fine. You are deputized. Support role. Paperwork only.',
    50: 'Fifty. He is no longer angry at them. He is concerned about you.'
  };
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
    thunder();
    smite('whatever you just clicked on');
    strikes++;
    if (STRIKE_NOTES[strikes]) say(STRIKE_NOTES[strikes]);
  }
  flash.addEventListener('animationend', () => flash.classList.remove('on'));
  mainEl.addEventListener('animationend', (e) => { if (e.target === mainEl) mainEl.classList.remove('tremor'); });
  let downX = 0, downY = 0;
  document.addEventListener('pointerdown', (ev) => { downX = ev.clientX; downY = ev.clientY; }, { passive: true });
  // "click", not "pointerdown": a finger starting a scroll should not call down lightning.
  document.addEventListener('click', (ev) => {
    if (ev.button !== 0) return;
    if (ev.target.closest('a, button, input, textarea, select, label, summary, .altimeter, form')) return;
    if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 8) return; // a drag (selecting text), not a click
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
    });
  }

  /* ---------- Countdown to Election Day (Tuesday, November 7, 2028) ---------- */
  const countdown = document.getElementById('countdown');
  if (countdown) {
    const electionDay = new Date(2028, 10, 7);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((electionDay - today) / 864e5);
    const daysEl = document.getElementById('countdownDays');
    const textEl = document.getElementById('countdownText');
    if (days > 1) {
      daysEl.textContent = fmt(days);
    } else if (days === 1) {
      daysEl.textContent = '1';
      textEl.textContent = 'day until Judgment (Election) Day. He would get some sleep, if He slept.';
    } else if (days === 0) {
      daysEl.textContent = 'TODAY.';
      textEl.textContent = 'Judgment (Election) Day. Go vote. He is watching the line.';
    } else {
      daysEl.textContent = 'IT IS DONE.';
      textEl.textContent = 'Judgment (Election) Day was Nov. 7, 2028. He already knew how it went.';
    }
    countdown.hidden = false;
  }

  /* ---------- Prayer line (nothing leaves the browser) ---------- */
  const prayerForm = document.getElementById('prayerForm');
  if (prayerForm) {
    const input = document.getElementById('prayerInput');
    const ruling = document.getElementById('ruling');
    const stamp = document.getElementById('rulingStamp');
    const text = document.getElementById('rulingText');
    const ref = document.getElementById('rulingRef');
    const STAMPS = { denied: 'DENIED', granted: 'GRANTED', pending: 'PENDING', heard: 'HEARD' };
    // First match wins. The first rule is the only one that is not a joke.
    const RULES = [
      [/\b(sick|ill|illness|cancer|dying|died|death|dead|funeral|grief|griev\w*|hospital|surgery|diagnos\w*|depress\w*|anxi\w*|lonely|alone|scared|afraid|hurt\w*|suicid\w*|miss (him|her|them)|heal\w*)\b/,
        'heard', 'He heard that one properly. No bit. He hopes it gets lighter, and that you let somebody help carry it.'],
      [/\b(park|parking|parked|spot)\b/, 'denied', 'This is about parking. That makes eleven billion and one. Denied, with feeling.'],
      [/\b(lottery|lotto|powerball|jackpot|rich|million\w*|billion\w*|money|raise|bitcoin|crypto)\b/, 'denied', 'He has seen what you would do with it. He has seen all the versions. No.'],
      [/\b(team|game|playoff\w*|super ?bowl|world series|championship|score|win tonight|fantasy)\b/, 'denied', 'He does not pick sides in sports. He does, actually. It is not yours.'],
      [/\b(ex|text (me )?back|crush|date|dating|love|boyfriend|girlfriend|marry|wedding)\b/, 'pending', 'He has reviewed the matter. They are thinking about it. Do not text again tonight.'],
      [/\b(boss|work|job|meeting|sync|email|monday|deadline|promotion|interview)\b/, 'granted', 'Granted in part. The meeting will be an email. The email will still be too long.'],
      [/\b(rain|snow|sun|sunny|weather|storm|hurricane|heat|cold)\b/, 'pending', 'Weather requests are handled under the Plague Forecast. See Thursday. Bring a jacket.'],
      [/\b(test|exam|finals?|grade|homework|pass)\b/, 'pending', 'He will help. He also saw how much you studied. Those two facts are related.'],
      [/\b(diet|weight|gym|pizza|cake|dessert|snack)\b/, 'granted', 'Granted. He invented bread. He is not going to pretend otherwise.'],
      [/\b(peace|kind\w*|forgive\w*|thank\w*|grateful|gratitude)\b/, 'granted', 'Granted. That is the first one today that was not about parking. He is moved. Slightly.'],
      [/\b(win|elect\w*|vote|president|campaign|poll\w*)\b/, 'pending', 'He cannot rule on His own election. That would be improper. He checked. With Himself.'],
      [/\b(smite|strike|lightning|revenge|enemy|enemies|neighbor)\b/, 'denied', 'He does the smiting. You do the loving of the neighbor. That was the arrangement.']
    ];
    const FALLBACK = [
      ['pending', 'Received. Filed. Under “We’ll See.”'],
      ['granted', 'Granted, effective Saturday. Everything good is effective Saturday.'],
      ['denied', 'No. But He appreciated the phrasing. Ask again after the election.'],
      ['granted', 'He was going to do that anyway. You are welcome.'],
      ['pending', 'You are number 8,114,203,551 in the queue. He is very fast. Stay near the phone.'],
      ['denied', 'Denied. He would explain, but it involves the next four hundred years.']
    ];
    let prayers = 0;
    prayerForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const said = input.value.trim().toLowerCase();
      let kind, line;
      if (!said) {
        kind = 'pending';
        line = 'He can hear you thinking it. Type it anyway. It is good for you.';
      } else {
        const hit = RULES.find((r) => r[0].test(said));
        const pick = hit ? [hit[1], hit[2]] : FALLBACK[prayers % FALLBACK.length];
        kind = pick[0];
        line = pick[1];
        prayers++;
      }
      ruling.dataset.kind = kind;
      stamp.textContent = STAMPS[kind];
      text.textContent = line;
      ref.textContent = said ? 'Ruling no. ' + fmt(11000000000 + prayers) + ' · Final · Also eternal' : 'No prayer on file';
      ruling.hidden = false;
      ruling.classList.remove('is-new'); void ruling.offsetWidth; ruling.classList.add('is-new');
      if (said) input.select();
    });
  }

  /* ---------- Spread the Word ---------- */
  const shareBtn = document.getElementById('shareBtn');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const data = { title: "GOD 2028 — He's Seen Enough", text: 'He floated down. He is not happy. He is not asking.', url: location.href.split('#')[0] };
      try {
        if (navigator.share) { await navigator.share(data); return; }
        await navigator.clipboard.writeText(data.url);
        say('Link copied. Go forth. Tell two friends, and they shall tell two friends.');
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        say('Could not copy the link. Use word of mouth. It worked before.');
      }
    });
  }

  setSmite();
})();
