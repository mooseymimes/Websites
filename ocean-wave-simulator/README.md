# Ocean Wave Simulator

A dependency-free WebGL2 ocean scene. Open `index.html` in any modern browser.

**Controls**

- Click the water to drop a barrel where you clicked. Space, or the *Drop barrel* / *Drop 10* buttons, drop barrels near the centre.
- Drag to orbit, scroll or pinch to zoom.
- Sliders adjust wave height, choppiness, wavelength, wind direction, and sun elevation (sunrise to midday).

**How it works**

- The water is a sum of eight Gerstner waves evaluated in the vertex shader, with analytic normals, a Jacobian-based foam term for breaking crests, and small ripples added in the fragment shader for sparkle.
- Lighting combines a procedural sky reflected through a Fresnel term, a sharp sun highlight plus wider glitter, a backlit subsurface-scattering tint on wave crests, and distance fog that fades into the sky.
- Barrels are rigid bodies. Sixteen sample points per barrel measure submersion against the same wave function evaluated on the CPU, producing buoyancy, torque, and drag against the moving water so barrels bob, roll, drift, and collide with each other.
- Splashes spawn a foam ring that rides the surface and a burst of spray particles.
