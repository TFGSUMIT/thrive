// =============================================================================
// shaders.js — GLSL for the Schwarzschild gravitational-lensing renderer
// blackhole-lensing core (no framework deps)
//
// WebGL1 / GLSL ES 1.00 for broad GPU support (important for the "weak GPU"
// quality target). The fragment shader backward-traces one light ray per pixel
// and integrates it through the Schwarzschild field, so the lensed disk arcs,
// photon ring and shadow emerge from the geometry rather than being drawn.
// =============================================================================

export const VERTEX_SHADER = /* glsl */ `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// The integration loop must have a constant bound in GLSL ES 1.00; we cap at
// MAX_STEPS and `break` early at the uniform uSteps so the step count stays a
// runtime quality knob without recompiling.
export const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

#define MAX_STEPS 400

uniform vec2  uResolution;   // backing-store pixel size of THIS canvas
uniform float uTime;         // seconds (for any time-based effects)
uniform float uRotation;     // accumulated disk rotation angle (radians)

// camera / framing
uniform float uAspect;       // aspect of the VIRTUAL scene (w/h)
uniform vec4  uCameraRect;   // sub-rect of the virtual scene: (x,y,w,h) in 0..1
uniform vec2  uOffset;       // focal offset to push the hole off-centre
uniform float uCamDist;      // camera distance from the hole (sim units)
uniform float uInclination;  // angle of camera above the disk plane (rad); small = edge-on
uniform float uFov;          // vertical field-of-view scale (zoom)

// physics / disk (sim units, Schwarzschild radius ~ uHorizon)
uniform int   uSteps;        // integration steps (quality)
uniform float uHorizon;      // event-horizon radius
uniform float uDiskInner;
uniform float uDiskOuter;

// look
uniform float uPalette;      // 0 = NASA red/orange, 1 = Interstellar white-gold
uniform float uIntensity;    // overall brightness multiplier
uniform float uBeaming;      // doppler beaming strength (0..1)

// background / atmosphere
uniform float uStars;        // lensed starfield intensity
uniform float uNebula;       // lensed dust/nebula haze intensity
uniform float uGlow;         // photon-ring / lensing bloom halo

// ---- small noise for disk turbulence ---------------------------------------
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}

// ---- temperature -> colour, blended between the two palettes ----------------
vec3 palette(float t) {
  t = clamp(t, 0.0, 1.0);
  // NASA: deep red -> orange -> yellow-white (hot inner edge)
  vec3 nasa = mix(vec3(0.45, 0.04, 0.0),
              mix(vec3(1.0, 0.32, 0.03),
                  vec3(1.0, 0.85, 0.55), smoothstep(0.55, 1.0, t)),
                  smoothstep(0.0, 0.55, t));
  // Interstellar: pale gold -> warm white
  vec3 inter = mix(vec3(0.85, 0.62, 0.30),
                   vec3(1.0, 0.97, 0.88), smoothstep(0.3, 1.0, t));
  return mix(nasa, inter, uPalette);
}

// ---- background sampled along a (bent) ray direction -> lenses for free ------
// direction -> stable lat/long so the field is fixed in space and the lensing
// comes purely from how the ray was bent.
vec2 dirUV(vec3 d) {
  return vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0)));
}
vec3 starfield(vec3 dir) {
  vec2 uv = dirUV(dir);
  float s = 0.0;
  // two layers at different densities for depth
  for (int k = 0; k < 2; k++) {
    float sc = (k == 0) ? 75.0 : 165.0;
    vec2 g = uv * sc;
    vec2 ip = floor(g), fp = fract(g);
    float present = step(0.972, hash(ip + float(k) * 31.7));
    vec2 pos = vec2(hash(ip + 1.3), hash(ip + 7.1));
    float d = length(fp - pos);
    float twinkle = 0.6 + 0.4 * sin(uTime * 1.3 + hash(ip) * 30.0);
    s += present * smoothstep(0.09, 0.0, d) * twinkle * (k == 0 ? 1.0 : 0.6);
  }
  return vec3(s) * vec3(0.95, 0.97, 1.0);
}
vec3 nebula(vec3 dir) {
  vec2 uv = dirUV(dir);
  float n = fbm(uv * 2.3 + 4.0);
  n = smoothstep(0.45, 1.0, n);
  // cool dust with a faint warm core
  vec3 c = mix(vec3(0.04, 0.06, 0.11), vec3(0.14, 0.12, 0.16), n);
  return c * n;
}
vec3 background(vec3 dir) {
  vec3 base = vec3(0.012, 0.018, 0.035);          // deep navy void
#ifdef FEAT_NEBULA
  base += nebula(dir) * uNebula;
#endif
#ifdef FEAT_STARS
  base += starfield(dir) * uStars;
#endif
  return base;
}

void main() {
  // pixel -> 0..1 in this canvas, then -> virtual-scene sub-rect
  vec2 frag = gl_FragCoord.xy / uResolution;
  vec2 vuv  = uCameraRect.xy + frag * uCameraRect.zw;

  // centred, aspect-corrected NDC with focal offset, scaled by FOV
  vec2 ndc = (vuv - 0.5 - uOffset);
  ndc.x *= uAspect;
  ndc  *= uFov;

  // camera basis: positioned at inclination above the disk plane, looking at origin
  float ci = cos(uInclination), si = sin(uInclination);
  vec3 camPos  = vec3(0.0, si, ci) * uCamDist;
  vec3 forward = normalize(-camPos);
  vec3 right   = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
  vec3 up      = cross(forward, right);
  vec3 dir     = normalize(forward + ndc.x * right + ndc.y * up);

  // backward ray integration through the Schwarzschild field.
  // accel = -1.5 * h^2 * r / |r|^5 reproduces  u'' + u = 3 M u^2  (M = horizon/2),
  // i.e. correct first-order light bending and a photon sphere at 1.5 * horizon.
  vec3 pos = camPos;
  vec3 vel = dir;
  float h2 = dot(cross(pos, vel), cross(pos, vel));
  // scale the bending so uHorizon really is the horizon: M = uHorizon * 0.5
  float kBend = 1.5 * uHorizon * 0.5 * 2.0; // = 1.5 * uHorizon  (kept explicit)

  vec3 color = vec3(0.0);
  float transmit = 1.0;
  float escapeR = uCamDist * 1.6;
  bool captured = false;
  float minr = 1e9;                                        // closest approach (for the halo)

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps) break;

    float r2 = dot(pos, pos);
    float r  = sqrt(r2);
    minr = min(minr, r);

    if (r < uHorizon) { captured = true; transmit = 0.0; break; } // captured -> shadow
    if (r > escapeR && dot(pos, vel) > 0.0) break;         // escaped to infinity

    // adaptive step: VERY fine near the hole (where rays bend hardest and the
    // secondary/underside image forms), growing with distance. Coarse near-hole
    // steps are what skew the bottom arc, so resolve that region tightly.
    float dt = clamp(0.10 * (r - uHorizon) + 0.02, 0.015, 0.8);

    // velocity Verlet (2nd order): two cheap accel evals per step, far less
    // directional drift than Euler — this is what straightens the sharply-bent
    // underside (secondary) image instead of skewing it.
    vec3 a0    = -kBend * h2 * pos / (r2 * r2 * r);        // pos / r^5
    vec3 npos  = pos + vel * dt + 0.5 * a0 * dt * dt;
    float nr2  = dot(npos, npos);
    float nr   = sqrt(nr2);
    vec3 a1    = -kBend * h2 * npos / (nr2 * nr2 * nr);
    vec3 nvel  = vel + 0.5 * (a0 + a1) * dt;

#ifdef FEAT_DISK
    // equatorial-plane (y=0) crossing -> potential disk hit
    if (pos.y * npos.y < 0.0) {
      float f   = pos.y / (pos.y - npos.y);
      vec3 hit  = mix(pos, npos, f);
      float rd  = length(hit.xz);
      if (rd > uDiskInner && rd < uDiskOuter) {
        float tnorm = (rd - uDiskInner) / (uDiskOuter - uDiskInner); // 0 inner ..1 outer
        float temp  = pow(1.0 - tnorm, 1.5);                          // hotter inside

        // rigid rotation + a fixed spiral baked via log(rd): a stable swirl with
        // no runaway frequency / banding at speed.
        float ang  = atan(hit.z, hit.x);
        float spin = ang - uRotation + log(rd) * 1.6;
        float tex  = 0.35 + 0.95 * fbm(vec2(spin * 2.0 + rd * 0.3, rd * 0.7));

#ifdef FEAT_BEAMING
        // doppler beaming: orbital (tangential) velocity vs viewer
        vec3  vdir = normalize(vec3(-hit.z, 0.0, hit.x));
        float beta = clamp(0.42 * sqrt(uHorizon / rd), 0.0, 0.75);    // ~Keplerian
        float dop  = 1.0 + uBeaming * beta * dot(vdir, normalize(-vel)) * 4.0;
        dop = clamp(dop, 0.15, 4.0);
#else
        float dop = 1.0;
#endif

        // soft inner/outer falloff so edges aren't hard rings
        float edge = smoothstep(uDiskInner, uDiskInner * 1.08, rd)
                   * (1.0 - smoothstep(uDiskOuter * 0.8, uDiskOuter, rd));

        float bright = temp * tex * dop * edge;
        vec3  c      = palette(temp) * bright;
        float alpha  = clamp(bright * 0.9, 0.0, 1.0);

        color    += transmit * c;
        transmit *= (1.0 - alpha);
      }
    }
#endif

    pos = npos;
    vel = nvel;
    if (transmit < 0.01) break;
  }

  vec3 disk = color * uIntensity;

  // lensed background shows through wherever the disk didn't fully occlude
  vec3 bg = captured ? vec3(0.0) : background(normalize(vel));

  // bloom halo: a bright photon ring at the shadow edge (closest approach near
  // the photon sphere) plus a broad soft glow outward — the Interstellar look
  vec3 outc = disk + transmit * bg;
#ifdef FEAT_GLOW
  if (!captured) {
    float d = (minr - 1.5 * uHorizon) / uHorizon;
    float halo = exp(-d * d / 0.5) + 0.35 * exp(-d * d / 9.0);
    vec3 glowCol = mix(vec3(1.0, 0.96, 0.9), palette(1.0), 0.25);
    outc += halo * glowCol * uGlow;
  }
#endif

  gl_FragColor = vec4(outc, 1.0);
}
`;

// ---- feature toggles --------------------------------------------------------
// Each toggle compiles its feature in/out via a #define, so a disabled feature
// costs nothing on the GPU (not a runtime ×0). Default: all on.
export const FEATURES = ['disk', 'beaming', 'stars', 'nebula', 'glow'];

const FEATURE_DEFINE = {
  disk: 'FEAT_DISK', beaming: 'FEAT_BEAMING', stars: 'FEAT_STARS',
  nebula: 'FEAT_NEBULA', glow: 'FEAT_GLOW',
};

/** Build the fragment source with #defines for the enabled features. */
export function composeFragment(toggles = {}) {
  const defs = FEATURES
    .filter(f => toggles[f] !== false)            // default on
    .map(f => '#define ' + FEATURE_DEFINE[f]);
  return defs.join('\n') + '\n' + FRAGMENT_SHADER;
}
