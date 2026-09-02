/* ============================================================================
   model.js — procedural Sega Saturn (Model 1, 1995) built from primitives.

   Everything is generated at runtime: no external meshes or textures.
   Units are centimetres. +Y is up, +Z is the front of the console.

   Exposes window.SaturnModel = { build(opts) -> model }
   The returned model has: group, parts, materials, labels, hotspots,
   surfacePoint(), setVariant(), setExplode(), setLid(), setWireframe()
   ========================================================================== */
(function () {
  'use strict';

  const T = window.THREE;

  /* ---------------------------------------------------------------- dims */
  const DIM = {
    W: 26.0,          // width  (x)
    D: 23.0,          // depth  (z)
    baseH: 3.1,       // lower shell height
    shellTop: 5.2,    // upper shell height above the base (flat part)
    edgeR: 1.45,      // radius of the rounded top edge of the upper shell
    cornerR: 2.4,     // plan-view corner radius
    slopeZ0: 5.6,     // where the top starts sloping toward the front
    slopeDrop: 2.55,  // how far the front edge drops
    well: { x: 0, z: -1.9, w: 17.0, d: 13.6, r: 2.0, depth: 2.05 },
    lid:  { x: 0, z: -1.9, w: 18.4, d: 15.0, r: 2.7, thick: 0.42, bevel: 0.32 },
    cart: { z: -10.7, w: 9.6, d: 1.8, h: 0.42 },
  };
  DIM.totalH = DIM.baseH + DIM.shellTop;

  /* ------------------------------------------------------------- helpers */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // Signed distance to a rounded rectangle centred at the origin.
  function sdRR(px, pz, hx, hz, r) {
    const qx = Math.abs(px) - hx + r, qz = Math.abs(pz) - hz + r;
    return Math.min(Math.max(qx, qz), 0) + Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) - r;
  }

  // Height of the upper shell's top surface (relative to the shell bottom),
  // before the rounded edge band is applied. Flat, then a C1-smooth ramp.
  function topY(z) {
    const { shellTop, slopeZ0, slopeDrop, D } = DIM;
    if (z <= slopeZ0) return shellTop;
    const t = clamp((z - slopeZ0) / (D / 2 - slopeZ0), 0, 1);
    const a = 0.38;                       // fraction of the run used to ease in
    const m = slopeDrop / (1 - a / 2);    // slope of the linear part
    const drop = t < a ? m * t * t / (2 * a) : m * (t - a / 2);
    return shellTop - drop;
  }

  // Shell surface height (relative to shell bottom) including the edge band.
  function shellY(x, z) {
    const d = sdRR(x, z, DIM.W / 2, DIM.D / 2, DIM.cornerR);
    const t = topY(z), r = DIM.edgeR;
    if (d >= 0) return 0;
    if (d > -r) return t - r + Math.sqrt(Math.max(0, r * r - (d + r) * (d + r)));
    return t;
  }

  // World-space point + normal on the upper shell (x, z in console coords).
  function surfacePoint(x, z) {
    const e = 0.02;
    const y = shellY(x, z);
    const dx = (shellY(x + e, z) - shellY(x - e, z)) / (2 * e);
    const dz = (shellY(x, z + e) - shellY(x, z - e)) / (2 * e);
    const n = new T.Vector3(-dx, 1, -dz).normalize();
    return { point: new T.Vector3(x, y + DIM.baseH, z), normal: n, slope: Math.atan2(n.z, n.y) };
  }

  function roundedRectShape(w, h, r, cx = 0, cy = 0) {
    const s = new T.Shape();
    addRoundedRect(s, cx - w / 2, cy - h / 2, w, h, r);
    return s;
  }
  function addRoundedRect(path, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    path.moveTo(x + r, y);
    path.lineTo(x + w - r, y);
    path.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
    path.lineTo(x + w, y + h - r);
    path.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
    path.lineTo(x + r, y + h);
    path.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
    path.lineTo(x, y + r);
    path.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
    path.closePath();
  }

  // Extrude a 2D shape (u -> x, v -> z) upward. Result sits on y = 0 with
  // rounded (bevelled) top and bottom edges; total height = depth + 2*bevel.
  // bevelOffset pulls the bevel inward so the footprint equals the shape outline.
  function flatExtrude(shape, { depth = 0.4, bevel = 0.2, bevelSegments = 5, curveSegments = 24 } = {}) {
    const g = new T.ExtrudeGeometry(shape, {
      depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
      bevelOffset: -bevel, bevelSegments, curveSegments, steps: 1,
    });
    g.rotateX(Math.PI / 2);                 // (u, v, e) -> (u, -e, v)
    g.translate(0, depth + bevel, 0);
    return T.BufferGeometryUtils.toCreasedNormals(g, Math.PI / 5);
  }

  // Heightfield mesh of the upper shell: rounded edges, sloped front, and a
  // sunken well where the CD lid sits. Grid vertices just outside the footprint
  // are snapped onto its outline at y = 0, which forms the vertical outer wall;
  // vertices on either side of the well outline are snapped onto it too, so the
  // opening is a clean curve with a small filleted lip rather than a staircase.
  function buildShellGeometry() {
    const { W, D, cornerR, well } = DIM;
    const m = 0.4, nx = 190, nz = 170;
    const x0 = -W / 2 - m, x1 = W / 2 + m, z0 = -D / 2 - m, z1 = D / 2 + m;
    const cell = Math.max((x1 - x0) / nx, (z1 - z0) / nz), band = cell * 1.5, lipR = 0.55;
    const floorY = DIM.shellTop - well.depth;
    const outer = (x, z) => sdRR(x, z, W / 2, D / 2, cornerR);
    const inner = (x, z) => sdRR(x - well.x, z - well.z, well.w / 2, well.d / 2, well.r);
    const snap = (x, z, sdf, d) => {           // move (x, z) onto the sdf's zero contour
      const e = 1e-3;
      const gx = (sdf(x + e, z) - sdf(x - e, z)) / (2 * e), gz = (sdf(x, z + e) - sdf(x, z - e)) / (2 * e);
      return [x - d * gx, z - d * gz];
    };
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
    let k = 0;
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        let x = x0 + (x1 - x0) * i / nx, z = z0 + (z1 - z0) * j / nz, y;
        const d = outer(x, z);
        if (d > 0) {
          [x, z] = snap(x, z, outer, d); y = 0;
        } else {
          const dw = inner(x, z);
          if (dw < 0) {
            if (dw > -band) [x, z] = snap(x, z, inner, dw);
            y = floorY;
          } else {
            if (dw < band) [x, z] = snap(x, z, inner, dw);
            const t = shellY(x, z), dl = Math.min(dw, lipR);
            y = dw < lipR ? t - lipR + Math.sqrt(Math.max(0, lipR * lipR - (lipR - dl) * (lipR - dl))) : t;
          }
        }
        pos[k++] = x; pos[k++] = y; pos[k++] = z;
      }
    }
    const idx = new Uint32Array(nx * nz * 6);
    let q = 0;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d2 = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d2;
      }
    }
    let g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setIndex(new T.BufferAttribute(idx, 1));
    g = T.BufferGeometryUtils.toCreasedNormals(g, Math.PI / 3);
    g.computeBoundingSphere();
    return g;
  }

  /* --------------------------------------------------------------- labels */
  // Text drawn to a canvas and mapped onto a thin plane. Kept in a registry so
  // colour variants can redraw them.
  const labelRegistry = [];
  function makeLabel(text, o = {}) {
    const opt = Object.assign({
      width: 4, aspect: 4.5, color: '#d2d4da', weight: 700, italic: false,
      family: "'Exo 2', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
      spacing: 0.08, stripes: false, skew: 0, mono: false, opacity: 1,
    }, o);
    const cw = 1024, ch = Math.round(cw / opt.aspect);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const tex = new T.CanvasTexture(canvas);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.minFilter = T.LinearMipmapLinearFilter;
    const draw = (color) => {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, cw, ch);
      ctx.save();
      const fam = opt.mono ? "'Space Mono', 'SFMono-Regular', Menlo, Consolas, monospace" : opt.family;
      let size = ch * 0.78;
      ctx.font = `${opt.italic ? 'italic ' : ''}${opt.weight} ${size}px ${fam}`;
      ctx.letterSpacing = `${Math.round(size * opt.spacing)}px`;
      let wText = ctx.measureText(text).width;
      if (wText > cw * 0.94) { size *= (cw * 0.94) / wText; ctx.font = `${opt.italic ? 'italic ' : ''}${opt.weight} ${size}px ${fam}`; ctx.letterSpacing = `${Math.round(size * opt.spacing)}px`; }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.globalAlpha = opt.opacity;
      ctx.translate(cw / 2, ch / 2);
      if (opt.skew) ctx.transform(1, 0, -opt.skew, 1, 0, 0);
      ctx.fillText(text, 0, size * 0.04);
      if (opt.stripes) {            // SEGA-style horizontal cuts through the letters
        ctx.globalCompositeOperation = 'destination-out';
        for (let i = -1; i <= 1; i++) ctx.fillRect(-cw / 2, i * size * 0.22 - size * 0.028, cw, size * 0.056);
      }
      ctx.restore();
      tex.needsUpdate = true;
    };
    draw(opt.color);
    const mat = new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new T.Mesh(new T.PlaneGeometry(opt.width, opt.width / opt.aspect), mat);
    mesh.renderOrder = 2;
    mesh.userData.isLabel = true;
    labelRegistry.push({ draw, opt });
    return mesh;
  }
  function recolorLabels(color) { labelRegistry.forEach(l => l.draw(color)); }

  /* ------------------------------------------------------------ materials */
  const VARIANTS = {
    black:    { name: 'Black · NA/EU Model 1', shell: 0x14141a, base: 0x0e0e12, lid: 0x15151b, button: 0x1c1c22, trim: 0x25262c, label: '#eef0f4', glass: 0 },
    grey:     { name: 'Grey · Japanese Model 1', shell: 0xb7bac2, base: 0xa4a7af, lid: 0xbcbfc7, button: 0x3a55b0, trim: 0x8c9099, label: '#262b3d', glass: 0 },
    skeleton: { name: 'Skeleton · "This is Cool"', shell: 0x9aa3b4, base: 0x8b94a5, lid: 0xa3acbd, button: 0x6d7a95, trim: 0x59606e, label: '#f2f4f8', glass: 1 },
  };

  function makeMaterials() {
    const M = {};
    M.shell = new T.MeshPhysicalMaterial({ color: 0x14141a, roughness: 0.46, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.32, envMapIntensity: 0.9 });
    M.lid = new T.MeshPhysicalMaterial({ color: 0x15151b, roughness: 0.38, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 1.0 });
    M.base = new T.MeshStandardMaterial({ color: 0x0e0e12, roughness: 0.74, metalness: 0, envMapIntensity: 0.6 });
    M.button = new T.MeshPhysicalMaterial({ color: 0x1c1c22, roughness: 0.5, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.4 });
    M.trim = new T.MeshStandardMaterial({ color: 0x25262c, roughness: 0.62, metalness: 0.05 });
    M.recess = new T.MeshStandardMaterial({ color: 0x050507, roughness: 0.96, metalness: 0 });
    M.tray = new T.MeshStandardMaterial({ color: 0x0b0b0f, roughness: 0.9, metalness: 0 });
    M.silver = new T.MeshStandardMaterial({ color: 0xd9dbe0, roughness: 0.26, metalness: 0.95 });
    M.gold = new T.MeshStandardMaterial({ color: 0xd4a94a, roughness: 0.35, metalness: 0.9 });
    M.rubber = new T.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.95, metalness: 0 });
    M.discBody = new T.MeshPhysicalMaterial({ color: 0xc9ccd6, roughness: 0.18, metalness: 0.8, iridescence: 0.9, iridescenceIOR: 1.6, iridescenceThicknessRange: [120, 480] });
    M.ledGreen = new T.MeshStandardMaterial({ color: 0x173a20, roughness: 0.3, emissive: 0x3dff7a, emissiveIntensity: 0 });
    M.ledRed = new T.MeshStandardMaterial({ color: 0x3a1414, roughness: 0.3, emissive: 0xff3b2f, emissiveIntensity: 0 });
    return M;
  }

  function applyVariant(M, v) {
    M.shell.color.setHex(v.shell); M.base.color.setHex(v.base); M.lid.color.setHex(v.lid);
    M.button.color.setHex(v.button); M.trim.color.setHex(v.trim);
    for (const m of [M.shell, M.lid, M.base, M.button]) {
      const glass = v.glass && m !== M.button;
      m.transparent = false;
      m.transmission = glass ? 0.86 : 0;
      m.thickness = glass ? 1.6 : 0;
      m.ior = 1.42;
      m.attenuationColor = new T.Color(0x7c8699);
      m.attenuationDistance = glass ? 5.5 : Infinity;
      m.roughness = glass ? 0.18 : (m === M.base ? 0.74 : m === M.lid ? 0.38 : m === M.shell ? 0.46 : 0.5);
      if (m === M.button && v.glass) { m.transparent = true; m.opacity = 0.82; } else m.opacity = 1;
      m.needsUpdate = true;
    }
    recolorLabels(v.label);
  }

  /* ----------------------------------------------------------------- lid */
  function buildLid(M) {
    const L = DIM.lid;
    const pivot = new T.Group();                       // hinge along the back edge
    pivot.position.set(L.x, DIM.baseH + DIM.shellTop + 0.03, L.z - L.d / 2);
    const topH = L.thick + 2 * L.bevel;                // total lid height

    const body = new T.Mesh(flatExtrude(roundedRectShape(L.w, L.d, L.r, 0, L.d / 2), { depth: L.thick, bevel: L.bevel, bevelSegments: 6 }), M.lid);
    body.userData.action = 'lid';
    body.castShadow = true; body.receiveShadow = true;
    pivot.add(body);

    // Raised swoosh: a rounded plate with a wavy front edge.
    const inset = 0.95, rc = L.r - inset, hu = L.w / 2 - inset;
    const crest = new T.Shape();
    crest.moveTo(-hu, 6.0);
    crest.bezierCurveTo(-3.6, 6.3, 2.4, 11.4, hu, 8.4);
    crest.lineTo(hu, inset + rc);
    crest.absarc(hu - rc, inset + rc, rc, 0, -Math.PI / 2, true);
    crest.lineTo(-hu + rc, inset);
    crest.absarc(-hu + rc, inset + rc, rc, -Math.PI / 2, -Math.PI, true);
    crest.lineTo(-hu, 6.0);
    const crestMesh = new T.Mesh(flatExtrude(crest, { depth: 0.1, bevel: 0.2, bevelSegments: 5, curveSegments: 40 }), M.lid);
    crestMesh.position.y = topH - 0.02;
    crestMesh.castShadow = true;
    pivot.add(crestMesh);
    const crestTop = topH - 0.02 + 0.1 + 0.4;

    // Chrome planet-and-ring emblem.
    const emblem = new T.Group();
    emblem.position.set(0, crestTop + 0.05, 4.1);
    const planet = new T.Mesh(new T.SphereGeometry(0.62, 40, 28), M.silver);
    planet.position.y = 0.42; planet.castShadow = true;
    const ring = new T.Mesh(new T.TorusGeometry(1.12, 0.105, 16, 72), M.silver);
    ring.position.y = 0.42; ring.rotation.set(Math.PI / 2 - 0.42, 0, -0.28); ring.castShadow = true;
    emblem.add(planet, ring);
    pivot.add(emblem);

    // "SEGA SATURN" wordmark and the three speed marks.
    const word = makeLabel('SEGA SATURN', { width: 9.4, aspect: 8.0, italic: true, weight: 900, spacing: 0.12, skew: 0.18 });
    word.rotation.x = -Math.PI / 2; word.position.set(0, topH + 0.012, 11.35);
    pivot.add(word);
    for (let i = 0; i < 3; i++) {
      const slash = new T.Mesh(new T.BoxGeometry(0.34, 0.07, 1.05), M.trim);
      slash.position.set(-0.95 + i * 0.95, topH + 0.02, 13.05);
      slash.rotation.y = -0.62;
      pivot.add(slash);
    }
    pivot.userData.emblemAnchor = emblem;
    return { pivot, body, topH };
  }

  /* ---------------------------------------------- well, tray, disc, cart */
  function buildInterior(M) {
    const Wl = DIM.well, floorY = DIM.baseH + DIM.shellTop - Wl.depth;
    const g = new T.Group();

    // Circular tray recess and spindle.
    const tray = new T.Mesh(new T.CylinderGeometry(6.45, 6.45, 0.1, 72), M.tray);
    tray.position.set(Wl.x, floorY + 0.05, Wl.z); tray.receiveShadow = true;
    const hub = new T.Mesh(new T.CylinderGeometry(1.15, 1.25, 0.55, 40), M.silver);
    hub.position.set(Wl.x, floorY + 0.38, Wl.z); hub.castShadow = true;
    const clamp = new T.Mesh(new T.CylinderGeometry(0.42, 0.52, 0.5, 24), M.trim);
    clamp.position.set(Wl.x, floorY + 0.9, Wl.z);
    const lens = new T.Mesh(new T.CylinderGeometry(0.28, 0.28, 0.12, 20), new T.MeshStandardMaterial({ color: 0x4d5fbf, roughness: 0.1, metalness: 0.4 }));
    lens.position.set(Wl.x + 3.4, floorY + 0.16, Wl.z + 0.9);
    g.add(tray, hub, clamp, lens);

    // The disc (spins around its own axis).
    const spinner = new T.Group();
    spinner.position.set(Wl.x, floorY + 0.72, Wl.z);
    const discBody = new T.Mesh(new T.CylinderGeometry(6.0, 6.0, 0.12, 96, 1, true), M.discBody);
    const under = new T.Mesh(new T.RingGeometry(0.75, 6.0, 96), M.discBody);
    under.rotation.x = Math.PI / 2; under.position.y = -0.06;
    const labelTex = makeDiscTexture();
    const face = new T.Mesh(new T.RingGeometry(0.75, 6.0, 96), new T.MeshStandardMaterial({ map: labelTex, roughness: 0.55, metalness: 0.05 }));
    face.rotation.x = -Math.PI / 2; face.position.y = 0.061;
    face.castShadow = true;
    spinner.add(discBody, under, face);
    g.add(spinner);

    // Cartridge slot housing at the back.
    const C = DIM.cart;
    const cart = new T.Group();
    const bezel = new T.Mesh(new T.RoundedBoxGeometry(C.w, C.h + 1.3, C.d, 3, 0.2), M.trim);
    bezel.position.set(0, DIM.baseH + DIM.shellTop + C.h - (C.h + 1.3) / 2, C.z);
    bezel.castShadow = true; bezel.receiveShadow = true;
    const slot = new T.Mesh(new T.BoxGeometry(C.w - 1.7, 0.4, 0.5), M.recess);
    slot.position.set(0, DIM.baseH + DIM.shellTop + C.h - 0.16, C.z + 0.05);
    const door = new T.Mesh(new T.BoxGeometry(C.w - 1.9, 0.08, 0.36), M.button);
    door.position.set(0, DIM.baseH + DIM.shellTop + C.h - 0.3, C.z + 0.05);
    const cartLabel = makeLabel('CARTRIDGE', { width: 2.6, aspect: 9, mono: true, weight: 700, spacing: 0.2, opacity: 0.85 });
    cartLabel.rotation.x = -Math.PI / 2; cartLabel.position.set(0, DIM.baseH + DIM.shellTop + C.h + 0.012, C.z + 0.72);
    cart.add(bezel, slot, door, cartLabel);

    return { group: g, spinner, cart };
  }

  function makeDiscTexture() {
    const s = 1024, c = document.createElement('canvas'); c.width = c.height = s;
    const x = c.getContext('2d'), m = s / 2;
    const grad = x.createRadialGradient(m, m, s * 0.08, m, m, s * 0.5);
    grad.addColorStop(0, '#1b2a6b'); grad.addColorStop(0.55, '#0f1a4a'); grad.addColorStop(1, '#070c24');
    x.fillStyle = grad; x.fillRect(0, 0, s, s);
    x.strokeStyle = 'rgba(255,255,255,0.18)'; x.lineWidth = 3;
    for (const r of [0.16, 0.44, 0.47]) { x.beginPath(); x.arc(m, m, s * r, 0, Math.PI * 2); x.stroke(); }
    x.fillStyle = '#eef1ff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = "italic 800 92px 'Exo 2', 'Segoe UI', Arial, sans-serif";
    x.fillText('SEGA SATURN', m, m - s * 0.27);
    x.font = "700 40px 'Space Mono', Menlo, monospace";
    x.fillStyle = 'rgba(238,241,255,0.75)';
    x.fillText('DEMO DISC  ·  1995  ·  NTSC-U', m, m + s * 0.28);
    x.fillText('T-00000  ·  FOR USE WITH SEGA SATURN ONLY', m, m + s * 0.33);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }

  /* ----------------------------------------------------- front controls */
  // Places an object flush on the upper shell at console coords (x, z).
  function seat(obj, x, z, lift = 0) {
    const sp = surfacePoint(x, z);
    obj.position.copy(sp.point).addScaledVector(sp.normal, lift);
    obj.rotation.set(sp.slope, 0, 0);
    return sp;
  }
  function seatLabel(label, x, z) {
    const sp = surfacePoint(x, z);
    label.position.copy(sp.point).addScaledVector(sp.normal, 0.015);
    label.rotation.set(sp.slope - Math.PI / 2, 0, 0);
    return sp;
  }

  function ovalButton(M, rx, rz, h) {
    const geo = new T.CylinderGeometry(1, 1, h, 56);
    geo.scale(rx, 1, rz);
    const m = new T.Mesh(geo, M.button);
    m.castShadow = true;
    return m;
  }

  function buildControls(M) {
    const g = new T.Group(), buttons = new T.Group(), leds = {};
    const zBtn = 8.5;

    const power = ovalButton(M, 1.3, 0.78, 0.3);
    seat(power, -8.7, zBtn, 0.02); power.rotation.y = 0.55;
    power.userData.action = 'power';
    const open = ovalButton(M, 1.3, 0.78, 0.3);
    seat(open, 8.7, zBtn, 0.02); open.rotation.y = -0.55;
    open.userData.action = 'open';
    const reset = new T.Mesh(new T.RoundedBoxGeometry(2.4, 0.24, 0.72, 2, 0.11), M.button);
    seat(reset, -1.4, zBtn + 0.1, 0.02); reset.castShadow = true;
    reset.userData.action = 'reset';
    buttons.add(power, open, reset);

    const lPower = makeLabel('POWER', { width: 2.0, aspect: 6, mono: true, weight: 700, spacing: 0.22 });
    seatLabel(lPower, -6.05, 9.5);
    const lReset = makeLabel('RESET', { width: 1.85, aspect: 6, mono: true, weight: 700, spacing: 0.22 });
    seatLabel(lReset, -1.4, 9.6);
    const lAccess = makeLabel('ACCESS', { width: 2.25, aspect: 6, mono: true, weight: 700, spacing: 0.22 });
    seatLabel(lAccess, 4.35, 9.5);
    const sega = makeLabel('SEGA', { width: 3.3, aspect: 3.1, weight: 900, spacing: -0.02, skew: 0.12, stripes: true });
    seatLabel(sega, -10.1, 7.1);

    leds.power = new T.Mesh(new T.BoxGeometry(0.42, 0.14, 0.22), M.ledGreen);
    seat(leds.power, -4.35, 9.5, 0.04);
    leds.access = new T.Mesh(new T.BoxGeometry(0.42, 0.14, 0.22), M.ledRed);
    seat(leds.access, 6.15, 9.5, 0.04);

    g.add(lPower, lReset, lAccess, sega, leds.power, leds.access);
    return { group: g, buttons, leds, power, open, reset };
  }

  /* ------------------------------------------------- base & its details */
  function buildBase(M) {
    const { W, D, baseH, cornerR } = DIM;
    const g = new T.Group();
    const body = new T.Mesh(flatExtrude(roundedRectShape(W - 0.2, D - 0.2, cornerR - 0.1), { depth: baseH - 0.7, bevel: 0.35, bevelSegments: 6, curveSegments: 32 }), M.base);
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);

    // Controller ports on the front face.
    const zf = D / 2 - 0.1, y = baseH * 0.5;
    [-6.6, -1.4].forEach((x, i) => {
      const housing = new T.Mesh(new T.RoundedBoxGeometry(3.05, 1.42, 0.5, 2, 0.16), M.trim);
      housing.position.set(x, y, zf - 0.05); housing.castShadow = true;
      const inner = new T.Mesh(new T.BoxGeometry(2.5, 0.86, 0.46), M.recess);
      inner.position.set(x, y, zf + 0.02);
      g.add(housing, inner);
      for (let p = 0; p < 9; p++) {
        const pin = new T.Mesh(new T.BoxGeometry(0.09, 0.4, 0.18), M.gold);
        pin.position.set(x - 1.0 + p * 0.25, y, zf + 0.05);
        g.add(pin);
      }
      const tag = makeLabel(String(i + 1), { width: 0.55, aspect: 1, mono: true, weight: 700 });
      tag.position.set(x - 1.95, y + 0.05, zf + 0.012);
      g.add(tag);
    });

    // Rear I/O.
    const zb = -(D / 2) + 0.1;
    const av = new T.Mesh(new T.RoundedBoxGeometry(2.7, 1.45, 0.45, 2, 0.16), M.trim); av.position.set(8.2, y, zb + 0.05);
    const avIn = new T.Mesh(new T.BoxGeometry(2.15, 0.9, 0.45), M.recess); avIn.position.set(8.2, y, zb - 0.03);
    const pwr = new T.Mesh(new T.BoxGeometry(2.1, 1.55, 0.4), M.trim); pwr.position.set(11.0, y, zb + 0.05);
    const pwrIn = new T.Mesh(new T.BoxGeometry(1.5, 1.0, 0.4), M.recess); pwrIn.position.set(11.0, y, zb - 0.03);
    const comm = new T.Mesh(new T.BoxGeometry(4.8, 1.95, 0.3), M.trim); comm.position.set(3.2, y, zb - 0.02);
    g.add(av, avIn, pwr, pwrIn, comm);
    for (const sx of [-2.0, 2.0]) {
      const screw = new T.Mesh(new T.CylinderGeometry(0.17, 0.17, 0.1, 16), M.silver);
      screw.rotation.x = Math.PI / 2; screw.position.set(3.2 + sx, y, zb - 0.18);
      g.add(screw);
    }
    const lAv = makeLabel('AV OUT', { width: 1.3, aspect: 6, mono: true, weight: 700, spacing: 0.18 });
    lAv.rotation.y = Math.PI; lAv.position.set(8.2, y + 1.05, zb - 0.16);
    const lComm = makeLabel('COMMUNICATION CONNECTOR', { width: 3.6, aspect: 12, mono: true, weight: 700, spacing: 0.12, opacity: 0.8 });
    lComm.rotation.y = Math.PI; lComm.position.set(3.2, y + 1.25, zb - 0.16);
    g.add(lAv, lComm);

    // Rear vents (vertical slits) and right-side vents (horizontal slits).
    for (let i = 0; i < 14; i++) {
      const slit = new T.Mesh(new T.BoxGeometry(0.22, 1.7, 0.3), M.recess);
      slit.position.set(-11.2 + i * 0.62, y, zb - 0.16 + 0.15);
      g.add(slit);
    }
    for (let i = 0; i < 6; i++) {
      const slit = new T.Mesh(new T.BoxGeometry(0.3, 0.2, 1.7), M.recess);
      slit.position.set((W - 0.2) / 2 - 0.14, 1.05 + i * 0.36, -6.2);
      g.add(slit);
    }

    // Feet and the label plate underneath.
    for (const [fx, fz] of [[-10.3, -8.6], [10.3, -8.6], [-10.3, 8.6], [10.3, 8.6]]) {
      const foot = new T.Mesh(new T.CylinderGeometry(0.95, 1.0, 0.32, 28), M.rubber);
      foot.position.set(fx, -0.13, fz); g.add(foot);
    }
    const plate = makeLabel('SEGA SATURN  ·  MODEL HST-3200  ·  MADE IN JAPAN  ·  AC 120V 60Hz 25W', { width: 12, aspect: 18, mono: true, weight: 700, spacing: 0.1, opacity: 0.7 });
    plate.rotation.x = Math.PI / 2; plate.position.set(0, -0.012, 3.0);
    g.add(plate);
    return g;
  }

  /* ------------------------------------------------------- upper shell */
  function buildShell(M) {
    const g = new T.Group();
    const shell = new T.Mesh(buildShellGeometry(), M.shell);
    shell.position.y = DIM.baseH;
    shell.castShadow = true; shell.receiveShadow = true;
    g.add(shell);
    // Side vents on the right wall of the upper shell.
    for (let i = 0; i < 9; i++) {
      const slit = new T.Mesh(new T.BoxGeometry(0.3, 1.55, 0.26), M.recess);
      slit.position.set(DIM.W / 2 - 0.14, DIM.baseH + 1.85, -8.6 + i * 0.6);
      g.add(slit);
    }
    return { group: g, shell };
  }

  /* ------------------------------------------------------------ assembly */
  function build() {
    const M = makeMaterials();
    const root = new T.Group();
    root.name = 'SegaSaturn';

    const base = buildBase(M);
    const shellParts = buildShell(M);
    const controls = buildControls(M);
    const interior = buildInterior(M);
    const lid = buildLid(M);

    shellParts.group.add(controls.group);
    const parts = {
      base, shell: shellParts.group, buttons: controls.buttons, interior: interior.group,
      cart: interior.cart, lid: lid.pivot,
    };
    const explode = { base: -4.2, shell: 0, buttons: 2.4, interior: 4.6, cart: 3.2, lid: 8.0 };
    for (const [k, obj] of Object.entries(parts)) {
      obj.userData.basePos = obj.position.clone();
      obj.userData.explode = explode[k];
      root.add(obj);
    }

    // Hotspot anchors ride along with the part they describe.
    const H = [];
    const anchor = (parent, pos, normal, id, title, body) => {
      const a = new T.Object3D(); a.position.copy(pos);
      parent.add(a); a.updateMatrixWorld(true);
      H.push({ id, title, body, anchor: a, normal: normal.clone().normalize() });
    };
    const sl = surfacePoint(0, 8.5).normal;
    anchor(lid.pivot, new T.Vector3(-5.5, lid.topH + 0.4, 9.0), new T.Vector3(0, 1, 0), 'lid', 'CD-ROM lid', 'Top-loading, double-speed CD-ROM drive behind a hinged lid. Click the lid or press OPEN to swing it up.');
    anchor(lid.pivot, new T.Vector3(0.9, lid.topH + 1.3, 4.1), new T.Vector3(0, 1, 0), 'emblem', 'Saturn emblem', 'The chrome planet-and-ring badge molded into the raised swoosh of the lid.');
    anchor(interior.cart, new T.Vector3(2.5, DIM.totalH + DIM.cart.h + 0.2, DIM.cart.z), new T.Vector3(0, 1, 0), 'cart', 'Cartridge slot', 'Took RAM expansion carts (1 MB / 4 MB) for arcade ports like X-Men vs. Street Fighter, plus backup-memory and Action Replay carts.');
    anchor(controls.buttons, surfacePoint(-8.7, 8.5).point.add(new T.Vector3(0, 0.45, 0)), sl, 'power', 'POWER', 'A big oval rocker. The green LED beside the label lights when the console is on.');
    anchor(controls.buttons, surfacePoint(-1.4, 8.6).point.add(new T.Vector3(0, 0.4, 0)), sl, 'reset', 'RESET', 'Soft reset back to the Saturn boot screen and its famous swirling logo.');
    anchor(controls.buttons, surfacePoint(8.7, 8.5).point.add(new T.Vector3(0, 0.45, 0)), sl, 'open', 'OPEN & ACCESS', 'OPEN pops the lid; the red ACCESS LED flickers while the laser reads the disc.');
    anchor(base, new T.Vector3(-4.0, DIM.baseH * 0.5, DIM.D / 2 + 0.3), new T.Vector3(0, 0, 1), 'ports', 'Controller ports', 'Two 9-pin ports for the Saturn control pad, the 1996 3D Control Pad, arcade sticks, and the multitap.');
    anchor(shellParts.group, new T.Vector3(DIM.W / 2 + 0.2, DIM.baseH + 1.9, -6.2), new T.Vector3(1, 0, 0), 'vents', 'Cooling vents', 'Behind them sit two Hitachi SH-2 CPUs at 28.6 MHz, the VDP1 and VDP2 video chips, and a Motorola 68EC000 driving the Yamaha sound chip.');
    anchor(base, new T.Vector3(6.5, DIM.baseH * 0.5, -DIM.D / 2 - 0.3), new T.Vector3(0, 0, -1), 'rear', 'Rear I/O', 'Multi-pin A/V out, the power inlet, and a blanking plate over the communication connector meant for the NetLink modem and more.');

    const model = {
      group: root, materials: M, parts, hotspots: H, spinner: interior.spinner,
      interactives: [controls.power, controls.open, controls.reset, lid.body],
      leds: controls.leds, variants: VARIANTS, DIM, surfacePoint,
      variant: 'black',
    };
    model.setVariant = (name) => { model.variant = name; applyVariant(M, VARIANTS[name] || VARIANTS.black); };
    model.refreshLabels = () => recolorLabels((VARIANTS[model.variant] || VARIANTS.black).label);
    model.setExplode = (t) => {
      for (const obj of Object.values(parts)) obj.position.y = obj.userData.basePos.y + obj.userData.explode * t;
    };
    model.setLidAngle = (a) => { lid.pivot.rotation.x = -a; };
    model.setWireframe = (on) => {
      for (const m of Object.values(M)) m.wireframe = on;
      root.traverse(o => { if (o.userData.isLabel) o.visible = !on; });
    };
    model.setPowerLed = (on) => { M.ledGreen.emissiveIntensity = on ? 2.2 : 0; };
    model.setAccessLed = (on) => { M.ledRed.emissiveIntensity = on ? 2.4 : 0; };
    model.setVariant('black');
    return model;
  }

  window.SaturnModel = { build, DIM, surfacePoint, VARIANTS };
})();
