/* ============================================================================
   trees.js — groves of broadleaf trees and the shadows they throw.

   Each tree is a tapered trunk under a cluster of lumpy foliage blobs. The
   normals of the blobs are bent towards "away from the middle of the crown"
   and an occlusion value is baked per vertex, so the crown shades as one soft
   volume rather than a pile of spheres. A few variants are instanced in
   their hundreds, clustered into groves by noise.

   Shadows: the trees are drawn once from the sun's point of view into a
   single-channel mask. The ground and the grass project themselves into that
   mask to find out whether a tree stands between them and the sun.

   Exposes window.Trees = { create }
   ========================================================================== */
(function () {
  'use strict';
  const T = window.THREE, A = window.Atmos, TR = window.Terrain;

  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  function treeGeometry(seed) {
    const rnd = rng(seed), parts = [];
    const finish = (g, leaf, colorFn, shade) => {
      const p = g.attributes.position, n = g.attributes.normal;
      const col = new Float32Array(p.count * 3), data = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {
        const c = colorFn(i);
        col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
        data[i * 2] = leaf; data[i * 2 + 1] = shade(i);
      }
      g.setAttribute('aColor', new T.BufferAttribute(col, 3));
      g.setAttribute('aData', new T.BufferAttribute(data, 2));
      g.deleteAttribute('uv');
      void n;
      parts.push(g);
    };

    // Trunk, with a slight lean.
    const trunkH = 2.7 + rnd() * 0.9, lean = (rnd() - 0.5) * 0.5, leanZ = (rnd() - 0.5) * 0.5;
    const trunk = new T.CylinderGeometry(0.20, 0.44, trunkH, 7, 4);
    trunk.translate(0, trunkH / 2 - 0.3, 0);
    { const p = trunk.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = Math.pow(Math.max(p.getY(i), 0) / trunkH, 2); p.setX(i, p.getX(i) + lean * k); p.setZ(i, p.getZ(i) + leanZ * k); } }
    trunk.computeVertexNormals();
    finish(trunk, 0, () => [0.150, 0.105, 0.075], (i) => 0.55 + 0.45 * Math.min(1, trunk.attributes.position.getY(i) / 2));

    // Crown: one big blob and a ring of smaller ones.
    const cx = lean * 0.9, cz = leanZ * 0.9, cy = trunkH + 2.0, R = 4.4;
    const blobs = [[cx, cy + 0.5, cz, 2.9 + rnd() * 0.4]];
    const count = 7 + Math.floor(rnd() * 3);
    for (let i = 0; i < count; i++) {
      const a = i / count * Math.PI * 2 + rnd() * 0.8, d = 2.0 + rnd() * 1.1;
      blobs.push([cx + Math.cos(a) * d, cy - 1.1 + rnd() * 1.9, cz + Math.sin(a) * d, 1.6 + rnd() * 0.8]);
    }
    const base = [0.050 + rnd() * 0.02, 0.150 + rnd() * 0.04, 0.022];
    for (const [bx, by, bz, br] of blobs) {
      let g = new T.IcosahedronGeometry(1, 2);
      g.deleteAttribute('uv'); g.deleteAttribute('normal');
      g = T.BufferGeometryUtils.mergeVertices(g, 1e-4);
      const p = g.attributes.position, off = rnd() * 50;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const d = 1 + 0.24 * TR.noise(x * 1.7 + off, y * 1.7 + z * 1.3) + 0.07 * TR.noise(x * 4.1 - off, z * 4.1 + y * 3.3);
        p.setXYZ(i, bx + x * br * d, by + y * br * d * 0.74, bz + z * br * d);
      }
      g.computeVertexNormals();
      const n = g.attributes.normal, shade = new Float32Array(p.count), v = new T.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.set(p.getX(i) - cx, (p.getY(i) - cy) * 1.15, p.getZ(i) - cz);
        const out = Math.min(1, v.length() / R);
        const up = Math.min(1, Math.max(0, (p.getY(i) - (cy - 2.4)) / 4.8));
        shade[i] = Math.min(1, 0.28 + 0.5 * out * out + 0.34 * up);
        v.normalize();
        n.setXYZ(i, n.getX(i) * 0.45 + v.x * 0.55, n.getY(i) * 0.45 + v.y * 0.55, n.getZ(i) * 0.45 + v.z * 0.55);
      }
      const tone = 0.85 + rnd() * 0.3;
      finish(g, 1, () => [base[0] * tone, base[1] * tone, base[2] * tone], (i) => shade[i]);
    }
    const merged = T.BufferGeometryUtils.mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    return merged;
  }

  function create(renderer, opts) {
    const maxTrees = opts.count, maskSize = opts.maskSize;
    const rnd = rng(8675309);

    /* ------------------------------------------------------ placement */
    const list = [], nrm = new T.Vector3();
    const RANGE = 820, STEP = 10;
    for (let gz = -RANGE; gz <= RANGE; gz += STEP) {
      for (let gx = -RANGE; gx <= RANGE; gx += STEP) {
        const x = gx + (rnd() - 0.5) * STEP * 0.9, z = gz + (rnd() - 0.5) * STEP * 0.9;
        const r = Math.hypot(x, z), roll = rnd(), size = rnd(), spin = rnd(), hue = rnd();
        if (r > RANGE || r < 26) continue;
        const grove = TR.noise(x / 210 + 20.5, z / 210 - 8.25) + 0.35 * TR.noise(x / 60 + 3.3, z / 60 + 9.9);
        const keep = grove > 0.30 ? roll < 0.62 : (grove > 0.16 ? roll < 0.14 : roll < 0.004);
        if (!keep) continue;
        if (TR.normalAt(x, z, nrm).y < 0.86) continue;
        list.push({ x, z, y: TR.heightAt(x, z), s: 0.75 + size * 0.85, spin: spin * Math.PI * 2, hue });
      }
    }
    // Too many for this quality level: thin them evenly.
    while (list.length > maxTrees) list.splice(Math.floor(rnd() * list.length), 1);

    /* --------------------------------------------------------- meshes */
    const material = new T.ShaderMaterial({
      uniforms: A.uniforms,
      vertexShader: `
        ${A.GLSL}
        attribute vec3 aColor;
        attribute vec2 aData;
        attribute vec3 aTint;
        varying vec3 vW;
        varying vec3 vN;
        varying vec3 vAlb;
        varying vec3 vInfo;
        void main() {
          vec4 wp = instanceMatrix * vec4(position, 1.0);
          vec3 origin = instanceMatrix[3].xyz;
          float gust = noiseTex(origin.xz * 0.022 - uWindOffset).g * noiseTex(origin.xz * 0.09 - uWindOffset * 2.7).b;
          float h = max(position.y, 0.0);
          float sway = (0.25 + 2.2 * gust + 0.35 * sin(uTime * 1.1 + origin.x * 0.13 + origin.z * 0.17)) * uWindStrength;
          wp.xz += uWindDir * (sway * h * h * 0.0045);
          wp.xyz += aData.x * 0.05 * (0.3 + uWindStrength) * vec3(sin(uTime * 3.1 + wp.x * 2.3 + wp.y * 1.7), sin(uTime * 2.7 + wp.z * 2.9), sin(uTime * 3.7 + wp.z * 2.1 + wp.y));
          vW = wp.xyz;
          vN = normalize(mat3(instanceMatrix) * normal);
          vAlb = aColor * mix(vec3(1.0), aTint, aData.x);
          vInfo = vec3(aData, cloudShadow(origin + vec3(0.0, 6.0, 0.0)));
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        ${A.GLSL}
        varying vec3 vW;
        varying vec3 vN;
        varying vec3 vAlb;
        varying vec3 vInfo;
        void main() {
          vec3 N = normalize(vN);
          vec3 V = normalize(cameraPosition - vW);
          float leaf = vInfo.x, occ = vInfo.y;
          // Leaf clumps: dapple the crown with two scales of noise.
          float near = 1.0 - smoothstep(18.0, 70.0, distance(cameraPosition, vW));
          float dap = noiseTex(vW.xz * 3.1 + vW.y * 2.3).r * 0.5 + noiseTex(vW.zy * 9.3 + vW.x * 7.1).g * 0.5;
          float leafy = noiseTex(vW.xy * 23.0 + vW.z * 17.0).b * noiseTex(vW.zx * 31.0 - vW.y * 19.0).a;   // leaf-sized flecks, close up only
          dap = mix(dap, dap * 0.55 + leafy * 1.5, near * 0.8);
          vec3 alb = vAlb * mix(1.0, 0.45 + 1.15 * dap, leaf);
          float bark = noiseTex(vec2(vW.x + vW.z, vW.y * 0.12) * 9.0).r;
          alb *= mix(0.7 + 0.6 * bark, 1.0, leaf);
          occ *= mix(1.0, 0.62 + 0.76 * dap, leaf);
          float ndl = dot(N, uSunDir);
          float wrap = clamp((ndl + 0.30 * leaf) / (1.0 + 0.30 * leaf), 0.0, 1.0);
          vec3 sun = sunLight() * vInfo.z;
          vec3 col = alb * (sun * wrap * mix(1.0, occ, 0.7) + skyAmbient() * (0.50 + 0.50 * N.y) * occ * 1.05);
          float back = pow(max(dot(-V, uSunDir), 0.0), 3.0) * leaf;
          col += alb * vec3(1.5, 1.4, 0.45) * sun * back * 0.55 * occ;        // light through the leaves
          gl_FragColor = vec4(applyAtmosphere(col, vW), 1.0);
        }
      `,
    });

    const group = new T.Group(), maskScene = new T.Scene();
    const maskMat = new T.MeshBasicMaterial({ color: 0xffffff });
    const VARIANTS = 4, m4 = new T.Matrix4(), q = new T.Quaternion(), up = new T.Vector3(0, 1, 0), v = new T.Vector3(), sc = new T.Vector3();
    for (let k = 0; k < VARIANTS; k++) {
      const mine = list.filter((_, i) => i % VARIANTS === k);
      if (!mine.length) continue;
      const geo = treeGeometry(101 + k * 37);
      const tint = new Float32Array(mine.length * 3);
      const mesh = new T.InstancedMesh(geo, material, mine.length);
      mine.forEach((t, i) => {
        q.setFromAxisAngle(up, t.spin);
        m4.compose(v.set(t.x, t.y, t.z), q, sc.set(t.s, t.s * (0.9 + t.hue * 0.25), t.s));
        mesh.setMatrixAt(i, m4);
        tint[i * 3] = 0.8 + t.hue * 0.75; tint[i * 3 + 1] = 0.88 + (1 - t.hue) * 0.24; tint[i * 3 + 2] = 0.7 + t.hue * 0.5;
      });
      geo.setAttribute('aTint', new T.InstancedBufferAttribute(tint, 3));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      group.add(mesh);
      const mask = new T.InstancedMesh(geo, maskMat, mine.length);
      mask.instanceMatrix = mesh.instanceMatrix;
      mask.frustumCulled = false;
      maskScene.add(mask);
    }

    /* ---------------------------------------------------- shadow mask */
    const EXTENT = RANGE + 60;
    const target = new T.WebGLRenderTarget(maskSize, maskSize, {
      format: T.RedFormat, type: T.UnsignedByteType, depthBuffer: false,
      minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter, generateMipmaps: true,
    });
    const cam = new T.OrthographicCamera(-EXTENT, EXTENT, EXTENT, -EXTENT, 10, 6000);
    const bias = new T.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    A.uniforms.uShadowMap.value = target.texture;
    const black = new T.Color(0, 0, 0), prevColor = new T.Color();

    function updateShadows(sun) {
      const d = sun.dir.clone();
      d.y = Math.max(d.y, 0.07);                         // keep the projection sane at dusk; the strength fades instead
      d.normalize();
      cam.position.copy(d).multiplyScalar(3000);
      cam.up.set(0, 1, 0);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      A.uniforms.uShadowMatrix.value.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
      const s = sun.dir.y;
      A.uniforms.uShadowStrength.value = 0.86 * Math.min(1, Math.max(0, (s - 0.03) / 0.12));
      const prevTarget = renderer.getRenderTarget(), prevAlpha = renderer.getClearAlpha();
      renderer.getClearColor(prevColor);
      renderer.setRenderTarget(target);
      renderer.setClearColor(black, 1);
      renderer.clear();
      renderer.render(maskScene, cam);
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(prevColor, prevAlpha);
    }

    /* ------------------------------------- trunks you cannot walk through */
    const CELLSZ = 16, buckets = new Map();
    for (const t of list) {
      const key = Math.floor(t.x / CELLSZ) + ',' + Math.floor(t.z / CELLSZ);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(t);
    }
    function pushOut(p, radius) {
      const cx = Math.floor(p.x / CELLSZ), cz = Math.floor(p.z / CELLSZ);
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const b = buckets.get((cx + i) + ',' + (cz + j));
          if (!b) continue;
          for (const t of b) {
            const dx = p.x - t.x, dz = p.z - t.z, d = Math.hypot(dx, dz), min = radius + 0.4 * t.s;
            if (d < min && d > 1e-4) { p.x = t.x + dx / d * min; p.z = t.z + dz / d * min; }
          }
        }
      }
    }

    return { group, count: list.length, updateShadows, pushOut };
  }

  window.Trees = { create };
})();
