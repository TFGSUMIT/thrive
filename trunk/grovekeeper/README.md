# grovekeeper

Framework-agnostic seeded **growing-tree** renderer (**WebGL 3D**) — a sibling of
`blackhole-lensing`. A deterministic tree of lit, tapered branch tubes + billboarded
leaf foliage sprouts trunk → branches → leaves/blossoms over `growthSeconds` under a
directional sun, idles with a live wind sway, and slowly orbits in perspective.
Geometry is built once (`src/treeMesh.js`); growth + wind are uniform-driven in
`src/treeShaders.js`; matrices in `src/mat4.js`.

```js
import { TreeRenderer, PRESETS } from 'grovekeeper/src/index.js';
const r = new TreeRenderer(canvas, { ...PRESETS.spring.params }, {
  quality: 'high', toggles: { ...PRESETS.spring.toggles },
});
r.start();
r.setParams({ windStrength: 2 });   // live; structural keys (seed/maxDepth/…) rebuild
r.scrubTo(0.5);                      // pin growth at 50%
r.replay();                          // grow again from 0
```

React ambient background (renders behind UI, transparent sky):

```jsx
import TreeBackground from 'grovekeeper/react/TreeBackground';
<TreeBackground />
```

- **Public API mirrors `BlackHoleRenderer`**: `setParams · setQuality · setToggles ·
  resize · start · stop · destroy`, plus tree-specific `scrubTo(p)` / `replay(fromP)` /
  `progress`.
- `FEATURES`: `leaves · blossoms · wind · ground · sky` (sky = the background gradient
  fill; off ⇒ transparent, so it composits over the app background).
- `QUALITY_PRESETS`: `ultra/high/medium/low/potato` → `{ resolutionScale, fpsCap }`.

In thrive this is consumed by the `grovekeeper` module's page
(`core/ui/src/pages/GrovekeeperPage.jsx`) and the unified ambient background in
`App.jsx`.
