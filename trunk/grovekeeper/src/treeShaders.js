// =============================================================================
// treeShaders.js — GLSL (WebGL1 / GLSL ES 1.00) for the 3D tree renderer.
// Four tiny programs: SKY (gradient backdrop), GROUND (plane + contact shadow),
// BRANCH (lit tapered tubes), LEAF (billboarded foliage cards). Growth + wind are
// driven by uniforms (uProgress, uTime) so the geometry is built once.
// =============================================================================

const EASE = `
float ease(float t){ t = clamp(t, 0.0, 1.0); return t < 0.5 ? 2.0*t*t : 1.0 - pow(-2.0*t+2.0, 2.0)/2.0; }
`;

// ── sky: fullscreen gradient ────────────────────────────────────────────────
export const SKY_VS = /* glsl */ `
attribute vec2 aPos;
varying float vY;
void main(){ vY = aPos.y * 0.5 + 0.5; gl_Position = vec4(aPos, 0.999, 1.0); }
`;
export const SKY_FS = /* glsl */ `
precision highp float;
uniform vec3 uTop, uBottom;
varying float vY;
void main(){ gl_FragColor = vec4(mix(uBottom, uTop, vY), 1.0); }
`;

// ── ground: plane with a soft radial contact shadow, fading at the edges ──────
export const GROUND_VS = /* glsl */ `
attribute vec3 aPos;
uniform mat4 uVP;
varying vec2 vXZ;
void main(){ vXZ = aPos.xz; gl_Position = uVP * vec4(aPos, 1.0); }
`;
export const GROUND_FS = /* glsl */ `
precision highp float;
uniform vec3 uGround, uShadow;
uniform float uShadowR, uEdge;
varying vec2 vXZ;
void main(){
  float d = length(vXZ);
  float shade = smoothstep(0.0, uShadowR, d);          // dark under the trunk
  vec3 col = mix(uShadow, uGround, shade);
  float a = 1.0 - smoothstep(uEdge*0.55, uEdge, d);    // fade the plane out at the rim
  gl_FragColor = vec4(col, a);
}
`;

// ── branches: tapered lit tubes, grown + swayed from uniforms ────────────────
export const BRANCH_VS = /* glsl */ `
attribute vec3 aPos, aBase, aNormal;
attribute vec2 aGrow;        // (t0, t1)
attribute float aSway, aPhase, aColorT;
uniform mat4 uVP;
uniform float uTime, uProgress, uWind;
uniform vec3 uWindDir;
varying vec3 vN; varying float vColorT;
${EASE}
void main(){
  float e = ease((uProgress - aGrow.x) / max(aGrow.y - aGrow.x, 1e-4));
  vec3 p = mix(aBase, aPos, e);
  // uniform breeze: the whole crown leans together (phase is time-only, no spatial wave
  // that would read as a swirl/rotation), more at the top. Joints stay coherent.
  float w = (sin(uTime*1.1) + 0.3*sin(uTime*0.47)) * uWind * 0.028;
  p.x += uWindDir.x * w * max(p.y, 0.0);
  p.z += uWindDir.z * w * max(p.y, 0.0);
  vN = aNormal; vColorT = aColorT;
  gl_Position = uVP * vec4(p, 1.0);
}
`;
export const BRANCH_FS = /* glsl */ `
precision highp float;
uniform vec3 uSun, uBark, uBarkLight;
uniform float uAmbient;
varying vec3 vN; varying float vColorT;
void main(){
  vec3 N = normalize(vN);
  float diff = max(dot(N, uSun), 0.0);
  vec3 base = mix(uBark, uBarkLight, vColorT);
  gl_FragColor = vec4(base * (uAmbient + (1.0 - uAmbient) * diff), 1.0);
}
`;

// ── leaves: camera-facing cards, grown + fluttered, round alpha mask ─────────
export const LEAF_VS = /* glsl */ `
attribute vec3 aAnchor;
attribute vec2 aCorner;
attribute float aT0, aHue, aPhase, aBlossom, aSize;
uniform mat4 uVP;
uniform float uTime, uProgress, uWind;
uniform vec3 uCamRight, uCamUp, uWindDir;
varying vec2 vCorner; varying float vHue, vBlossom, vGrow;
${EASE}
void main(){
  float e = ease((uProgress - aT0) / max(1.0 - aT0, 1e-4));
  // follow the canopy's uniform sway (same time-only field as branches) + a tiny
  // per-leaf flutter, so leaves stay with their twigs instead of drifting off
  float w = (sin(uTime*1.1) + 0.3*sin(uTime*0.47)) * uWind * 0.028;
  vec3 a = aAnchor;
  a.x += uWindDir.x * w * max(aAnchor.y, 0.0);
  a.z += uWindDir.z * w * max(aAnchor.y, 0.0);
  a += uWindDir * sin(uTime*2.5 + aPhase) * uWind * 0.012;
  vec3 p = a + (uCamRight * aCorner.x + uCamUp * aCorner.y) * (aSize * e);
  vCorner = aCorner; vHue = aHue; vBlossom = aBlossom; vGrow = e;
  gl_Position = uVP * vec4(p, 1.0);
}
`;
export const LEAF_FS = /* glsl */ `
precision highp float;
uniform vec3 uLeaf, uLeafLight, uBlossom, uSun;
uniform float uAmbient, uShowBlossom;
varying vec2 vCorner; varying float vHue, vBlossom, vGrow;
void main(){
  float d = dot(vCorner, vCorner);
  if (d > 1.0) discard;                                  // round leaf
  vec3 base = mix(uLeaf, uLeafLight, vHue);
  if (uShowBlossom > 0.5 && vBlossom > 0.5) base = uBlossom;
  float shade = mix(0.7, 1.08, vHue) * (uAmbient + (1.0 - uAmbient) * clamp(uSun.y + 0.6, 0.4, 1.0));
  float a = (1.0 - smoothstep(0.6, 1.0, d)) * clamp(vGrow * 1.5, 0.0, 1.0);
  gl_FragColor = vec4(base * shade, a);
}
`;
