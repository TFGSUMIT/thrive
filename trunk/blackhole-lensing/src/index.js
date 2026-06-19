// =============================================================================
// blackhole-lensing — public entry for the framework-agnostic core
// =============================================================================
export {
  BlackHoleRenderer,
  DEFAULT_PARAMS,
  QUALITY_PRESETS,
  DEFAULT_TOGGLES,
} from './BlackHoleRenderer.js';
export { FEATURES, composeFragment } from './shaders.js';

// Look/scene presets the consumers build on.
export const PRESETS = {
  // primary thrive use: subtle, dim, slow, off to a corner, cheap
  thriveSubtle: {
    params: {
      inclination: 0.13,
      fov: 1.15,
      offset: [0.26, -0.12],   // push the hole toward the upper-right calm space
      diskInner: 3.0,
      diskOuter: 10.0,
      palette: 0.0,            // NASA red/orange
      intensity: 0.42,         // dimmed so foreground text stays readable
      beaming: 0.9,
      rotationSpeed: 0.012,    // ~one revolution every several minutes
      stars: 0.35,             // a few faint stars, kept calm
      nebula: 0.25,
      glow: 0.4,
    },
    toggles: { disk: true, beaming: true, stars: true, nebula: true, glow: true },
    quality: 'low',            // steps + 0.6 res scale + 20fps cap
  },

  // secondary artwall use: full brightness, full quality — the Interstellar
  // "Gargantua" look dialed in against the tuner.
  artwall: {
    params: {
      camDist: 24.0,
      inclination: 0.02,       // ~1° — near edge-on
      fov: 1.11,
      offset: [0.0, 0.0],
      horizon: 2.0,
      diskInner: 3.2,
      diskOuter: 17.1,
      palette: 1.0,            // Interstellar white-gold
      intensity: 2.5,
      beaming: 0.7,
      rotationSpeed: 0.18,
      stars: 0.9,
      nebula: 0.5,
      glow: 0.7,
    },
    toggles: { disk: true, beaming: true, stars: true, nebula: true, glow: true },
    quality: 'ultra',
  },
};

/**
 * Helper for the multi-screen "virtual wall": given this screen's pixel rect
 * within the whole wall, returns the cameraRect + virtualAspect to feed one
 * BlackHoleRenderer so the hole is continuous across separate browsers.
 *
 * @param {number} wallW  total wall width  (px)
 * @param {number} wallH  total wall height (px)
 * @param {number} x      this screen's left   within the wall (px)
 * @param {number} y      this screen's top    within the wall (px)
 * @param {number} w      this screen's width  (px)
 * @param {number} h      this screen's height (px)
 */
export function wallCamera(wallW, wallH, x, y, w, h) {
  return {
    virtualAspect: wallW / wallH,
    // note: GL fragCoord origin is bottom-left, so flip Y
    cameraRect: [x / wallW, 1 - (y + h) / wallH, w / wallW, h / wallH],
  };
}
