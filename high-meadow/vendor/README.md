# Vendored libraries

`three.bundle.min.js` is [three.js](https://threejs.org) **r185 (npm `three@0.185.1`)** plus the addons
this page uses, bundled into one classic script that exposes a global `THREE` object. Bundling it
(instead of using the official ES-module build and an import map) lets `index.html` run straight from
`file://` with no server and no network, matching the rest of this repository.

Contents of the bundle:

- `three` (core)
- `three/addons/controls/OrbitControls.js`
- `three/addons/postprocessing/EffectComposer.js`
- `three/addons/postprocessing/RenderPass.js`
- `three/addons/postprocessing/UnrealBloomPass.js`
- `three/addons/postprocessing/OutputPass.js`
- `three/addons/utils/BufferGeometryUtils.js` (exposed as `THREE.BufferGeometryUtils`)

Reproduce it with:

```sh
npm install three@0.185.1 esbuild@0.25.9
cat > entry.js <<'JS'
export * from 'three';
export { OrbitControls } from 'three/addons/controls/OrbitControls.js';
export { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
export { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
export { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
export { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
export * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
JS
npx esbuild entry.js --bundle --format=iife --global-name=THREE --minify \
  --legal-comments=none --target=es2020 --outfile=three.bundle.min.js
```

three.js is MIT licensed; see `THREE-LICENSE`.
