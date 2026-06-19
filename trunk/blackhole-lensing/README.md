# blackhole-lensing

A small, framework-agnostic WebGL/GLSL renderer for a physically-plausible
**Schwarzschild black hole with gravitational lensing**. One fragment shader
backward-traces a light ray per pixel and bends it through the hole's gravity,
so the lensed features fall out of the geometry rather than being hand-drawn:

- the accretion disk seen near edge-on
- the **far side of the disk lensed up and over the top** of the shadow
- the **underside lensed into a separate arc below** the shadow
- a thin **photon ring** hugging the shadow
- the dark **shadow** itself
- **Doppler beaming** (the approaching side of the disk is brighter)

Reference look: the NASA Schwarzschild visualization.

```
blackhole-lensing/
├── src/
│   ├── shaders.js           # vertex + fragment GLSL (the physics)
│   ├── BlackHoleRenderer.js # GL context, uniforms, params, quality, RAF loop
│   └── index.js             # exports + PRESETS + wallCamera() helper
├── react/
│   └── BlackHoleBackground.jsx  # React wrapper, thrive "subtle" preset
├── demo/
│   └── index.html           # standalone tuner with live sliders
└── README.md
```

The **core has no framework dependencies** — it's plain ES modules and raw
WebGL, importable from any app.

## The physics (why the arcs are real)

In the fragment shader each pixel's ray is integrated backward from the camera.
The bending uses the Schwarzschild null-geodesic acceleration

```
a = -1.5 · horizon · h² · r / |r|⁵          (h² = |r × v|²)
```

which reproduces `u'' + u = 3M u²` with `M = horizon/2`, giving correct
first-order light bending and a **photon sphere at 1.5 × horizon**. Along the
ray we composite **every** crossing of the equatorial disk plane (front-to-back
alpha), so a ray that bends around the hole catches the disk's far side again —
producing the over-the-top and under-the-bottom arcs and, for rays grazing the
photon sphere, the photon ring. Nothing is a symmetric drawn ring.

## Quick start (core)

```js
import { BlackHoleRenderer } from 'blackhole-lensing/src/index.js';

const bh = new BlackHoleRenderer(canvas, { palette: 1.0 }, { quality: 'high' });
bh.start();
// later
bh.setParams({ inclination: 0.1, intensity: 0.6 });
bh.setQuality('low');
bh.stop();
bh.destroy();
```

## API

### `new BlackHoleRenderer(canvas, params?, options?)`
- `options.quality` — one of `ultra | high | medium | low | potato` (default `high`)
- `options.respectReducedMotion` — default `true`

Methods: `start()`, `stop()`, `destroy()`, `resize()`, `setParams(patch)`,
`setQuality(presetOrPartial)`, `setCameraRect(x,y,w,h)`. Getter: `reducedMotion`.

### Tunable params (`DEFAULT_PARAMS`)

| param | meaning |
|---|---|
| `camDist` | camera distance from the hole (sim units) |
| `inclination` | camera angle above the disk plane (rad); **small = near edge-on** |
| `fov` | zoom (smaller = tighter) |
| `offset` | `[x,y]` focal offset to push the hole off-centre (screen fractions) |
| `horizon` | event-horizon radius (sim units; everything scales off this) |
| `diskInner` / `diskOuter` | disk radii (≈ ISCO at `3×horizon`, photon ring at `1.5×`) |
| `palette` | `0` = NASA red/orange … `1` = Interstellar white-gold (blends) |
| `intensity` | overall brightness |
| `beaming` | Doppler beaming strength (`0` disables) |
| `rotationSpeed` | disk rotation (rad/sec) |
| `cameraRect` | `[x,y,w,h]` sub-rectangle of the virtual scene (multi-screen) |
| `virtualAspect` | `0` = auto; else force the shared scene aspect |

### The quality knob (performance is the main risk)

`setQuality(name)` sets three things at once:

| preset | integration steps | internal res scale | fps cap |
|---|---|---|---|
| `ultra` | 320 | 1.0× | 60 |
| `high` | 220 | 1.0× | 60 |
| `medium` | 150 | 0.75× | 30 |
| `low` | 90 | 0.6× | 20 |
| `potato` | 55 | 0.45× | 15 |

- **Steps** dominate GPU cost (the per-pixel integration loop) and lensing
  accuracy near the hole. Fewer steps = cheaper but the arcs/ring get rougher.
- **Resolution scale** shrinks the backing store (then CSS upscales) — the
  cheapest big win on weak GPUs / hi-DPI laptops.
- **fps cap** limits how often the loop runs (battery / fan).

You can also pass a partial: `setQuality({ steps: 120, fpsCap: 24 })`.

### Feature toggles

Each major feature can be switched off, and **disabling truly removes the GPU
work** — toggles compile the feature in/out via shader `#define`s (not a runtime
`×0`), and the program recompiles when a toggle flips.

```js
const bh = new BlackHoleRenderer(canvas, params, { toggles: { nebula: false } });
bh.setToggles({ stars: false, glow: false });   // recompiles without those
```

Features (all on by default): `disk`, `beaming`, `stars`, `nebula`, `glow`.
(`FEATURES` is exported.) The core lensing/integration and shadow are always on
— they *are* the black hole.

Presets serialize **toggles + params + quality together**, and the demo's
"log params → console" emits one blob you can paste straight into `PRESETS`:

```json
{ "toggles": { "disk": true, "beaming": true, "stars": true, "nebula": true, "glow": true },
  "params": { … }, "quality": "ultra" }
```

### Reduced motion

When `prefers-reduced-motion: reduce` is set (and `respectReducedMotion`),
rotation freezes and the renderer draws a **single static frame** instead of
looping — zero ongoing cost.

## Preset 1 — thrive subtle background (primary)

```jsx
import BlackHoleBackground from 'blackhole-lensing/react/BlackHoleBackground';

// behind all UI; dim, slow, corner-offset, low-quality, capped fps
<BlackHoleBackground />
<BlackHoleBackground params={{ palette: 1 }} opacity={0.5} quality="medium" />
```

Defaults (`PRESETS.thriveSubtle`): `intensity 0.42`, `rotationSpeed 0.012`
(~one revolution every several minutes), offset to the upper-right, `low`
quality (0.6× res, 20fps cap). The canvas is `position:fixed`, full-viewport,
`pointer-events:none`, `aria-hidden`, and **pauses when the tab is hidden**.
`opacity` adds CSS dimming on top of `intensity` so foreground text stays
readable.

## Preset 2 — artwall (multi-screen virtual wall)

The same core, full brightness/quality, driven by a shared **virtual wall**
camera: each browser instance renders a sub-rectangle of one continuous scene.

```js
import { BlackHoleRenderer, PRESETS, wallCamera } from 'blackhole-lensing/src/index.js';

const bh = new BlackHoleRenderer(canvas, PRESETS.artwall.params, { quality: 'ultra' });

// this screen is the middle-top cell of a 3×2 wall of 1920×1080 screens:
const cam = wallCamera(/*wallW*/5760, /*wallH*/2160, /*x*/1920, /*y*/0, 1920, 1080);
bh.setParams(cam);          // sets cameraRect + virtualAspect
bh.start();
```

`wallCamera(wallW, wallH, x, y, w, h)` returns `{ cameraRect, virtualAspect }`
for a screen occupying pixel rect `(x,y,w,h)` of the whole wall (Y is flipped
for GL). Because every instance shares the same virtual scene + aspect, the hole
is continuous across physically-separate screens with no other coordination.

## Demo / tuner

`demo/index.html` loads the core directly with on-screen sliders for every param
(camera, tilt, disk radii, palette, intensity, beaming, rotation, quality) plus
an fps meter. ES-module imports need to be served over http (not `file://`):

```bash
cd blackhole-lensing
python3 -m http.server 8081
# open http://localhost:8081/demo/
```

"log current params → console" prints a JSON blob you can paste into a preset.

## Performance notes

- The cost is **pixels × steps**; resolution scale and step count are the two
  levers. On integrated GPUs prefer `low`/`potato` and let CSS upscale.
- `highp` float precision is required for the integration — standard on modern
  GPUs; very old mobile GPUs without `highp` in fragment shaders are unsupported.
- WebGL1 / GLSL ES 1.00 for the widest device reach.
- For the subtle background, the tab-hidden pause + fps cap + reduced-motion
  static frame are what keep it from waking the fan.
