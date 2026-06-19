// =============================================================================
// treeUtil.js — shared helpers for the tree generators + mesher (no deps beyond mat4)
// =============================================================================
import { normalize, cross, dot } from './mat4.js';

// seeded RNG — deterministic tree per seed
export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const mix = (a, b, t) => a + (b - a) * t;
export const lerp3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
export const ease = t => { t = clamp(t, 0, 1); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };

// an orthonormal pair perpendicular to unit dir
export function frame(dir) {
  const a = Math.abs(dir[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(a, dir));
  const v = cross(dir, u);
  return [u, v];
}

// Rodrigues: rotate v about unit axis k by angle (radians)
export function rotate(v, k, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const kv = cross(k, v);
  const kk = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kk, v[1] * c + kv[1] * s + k[1] * kk, v[2] * c + kv[2] * s + k[2] * kk];
}

export const MIN_R = 0.009;   // branch radius floor so deep limbs stay visible
