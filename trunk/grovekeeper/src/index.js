// =============================================================================
// grovekeeper — public entry for the framework-agnostic core (WebGL 3D tree)
// =============================================================================
export {
  TreeRenderer,
  DEFAULT_PARAMS,
  DEFAULT_TOGGLES,
  QUALITY_PRESETS,
  FEATURES,
} from './TreeRenderer.js';
export { ALGORITHM_LIST } from './treeAlgorithms.js';

// Look/scene presets the consumers build on. Partial — merged over DEFAULT_PARAMS.
export const PRESETS = {
  // primary thrive use: subtle ambient tree behind the UI — transparent sky so the
  // app background shows through, no ground, gentle wind, slow auto-orbit, cheap.
  groveSubtle: {
    params: {
      growthSeconds: 30,
      windStrength: 0.6,
      orbitSpeed: 0.0,
      camDist: 4.6,
      camElevation: 0.12,
      ambient: 0.5,
      leaf: '#3f6a34', leafLight: '#5f9146',
      blossom: '#b89a4e',
      bark: '#43342a', barkLight: '#6a5340',
    },
    toggles: { leaves: true, blossoms: true, wind: true, ground: false, sky: false },
    quality: 'low',
  },

  // full interactive view: vivid spring tree in blossom, real sky + ground, full quality.
  spring: {
    params: {
      growthSeconds: 16,
      windStrength: 1.0,
      orbitSpeed: 0.0,
      camDist: 4.2,
      camElevation: 0.16,
      ambient: 0.38,
      bgTop: '#26405c', bgBottom: '#0c131c',
      bark: '#5b4636', barkLight: '#8a6a4d',
      leaf: '#4f7d3e', leafLight: '#86bd63',
      blossom: '#e8c46b',
    },
    toggles: { leaves: true, blossoms: true, wind: true, ground: true, sky: true },
    quality: 'high',
  },
};
