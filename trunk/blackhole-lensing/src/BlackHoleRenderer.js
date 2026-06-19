// =============================================================================
// BlackHoleRenderer.js — framework-agnostic WebGL renderer for the lensing core
//
// Manages the GL context, program, uniforms, tunable params, the quality knob
// (steps + internal resolution scale + framerate cap) and the animation loop.
// No framework dependencies — usable from plain HTML, React, anything.
//
//   const bh = new BlackHoleRenderer(canvas, { ...params });
//   bh.setQuality('low'); bh.start();
//   bh.setParams({ palette: 1.0 }); bh.stop(); bh.destroy();
// =============================================================================

import { VERTEX_SHADER, composeFragment, FEATURES } from './shaders.js';

// Feature toggles — all on by default. Disabling one recompiles the shader with
// that feature #defined out, so it costs nothing on the GPU.
export const DEFAULT_TOGGLES = Object.fromEntries(FEATURES.map(f => [f, true]));

// ---- tunable scene params (sim units; Schwarzschild radius ~ horizon) -------
export const DEFAULT_PARAMS = {
  camDist:     22.0,   // camera distance from the hole
  inclination: 0.16,   // radians above the disk plane; small = near edge-on
  fov:         1.0,    // zoom (smaller = tighter)
  offset:      [0.0, 0.0], // focal offset in screen fractions (push hole off-centre)

  horizon:     1.0,    // event-horizon radius
  diskInner:   3.0,    // inner edge (~ISCO)
  diskOuter:   11.0,   // outer edge

  palette:     0.0,    // 0 = NASA red/orange, 1 = Interstellar white-gold
  intensity:   1.0,    // overall brightness
  beaming:     1.0,    // doppler beaming strength (0 disables)

  stars:       0.8,    // lensed background starfield intensity
  nebula:      0.5,    // lensed dust/nebula haze intensity
  glow:        0.6,    // photon-ring / lensing bloom halo

  rotationSpeed: 0.15, // radians/sec of disk rotation (visual)

  // camera abstraction for the multi-screen "virtual wall"
  cameraRect:    [0.0, 0.0, 1.0, 1.0], // sub-rect of the virtual scene (x,y,w,h)
  virtualAspect: 0,    // 0 = auto (use this canvas aspect); else force scene aspect
};

// ---- quality presets: integration steps, render-res scale, fps cap ----------
// resolutionScale is the dominant cost (it's a fragment-bound shader — cost is
// ~quadratic in scale); steps is linear. 'min' is the floor for weak GPUs
// (e.g. a Raspberry Pi's VideoCore): ~8% of full-res pixels.
export const QUALITY_PRESETS = {
  ultra:  { steps: 320, resolutionScale: 1.0,  fpsCap: 60 },
  high:   { steps: 220, resolutionScale: 1.0,  fpsCap: 60 },
  medium: { steps: 150, resolutionScale: 0.75, fpsCap: 30 },
  low:    { steps: 110, resolutionScale: 0.5,  fpsCap: 30 },
  potato: { steps: 80,  resolutionScale: 0.32, fpsCap: 30 },
  // Cheap levels keep STEPS high (the accretion disk needs ray-marching to show)
  // but slash RESOLUTION (cost ≈ scale²·steps) — so a weak GPU runs them FAST
  // while the disk/lensing stays visible, just soft. A cheap draw that doesn't
  // hog the main thread keeps the rest of the UI responsive too.
  min:    { steps: 56,  resolutionScale: 0.2,  fpsCap: 30 },
};

// adaptive ladder, cheapest → richest. quality 'auto' starts near the top and
// ratchets DOWN this list when it can't keep up — never up, so it settles on a
// stable level instead of oscillating (no visible quality flicker).
export const QUALITY_LADDER = ['min', 'potato', 'low', 'medium', 'high', 'ultra'];

const UNIFORM_NAMES = [
  'uResolution', 'uTime', 'uRotation', 'uAspect', 'uCameraRect', 'uOffset',
  'uCamDist', 'uInclination', 'uFov', 'uSteps', 'uHorizon', 'uDiskInner',
  'uDiskOuter', 'uPalette', 'uIntensity', 'uBeaming',
  'uStars', 'uNebula', 'uGlow',
];

export class BlackHoleRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [params]   overrides for DEFAULT_PARAMS
   * @param {object} [options]  { quality, respectReducedMotion }
   */
  constructor(canvas, params = {}, options = {}) {
    this.canvas = canvas;
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.toggles = { ...DEFAULT_TOGGLES, ...(options.toggles || {}) };
    this.respectReducedMotion = options.respectReducedMotion !== false;

    this._rotation = 0;
    this._time = 0;
    this._raf = null;
    this._lastFrame = 0;
    this._lastTick = 0;
    this._running = false;
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);

    // adaptive quality state (active only when quality is 'auto')
    this._adaptive = false;
    this._adaptLevel = 0;
    this._frameSamples = [];
    this._levelSetAt = 0;
    this.setQuality(options.quality || 'high');

    this._reducedMQ = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : { matches: false, addEventListener: () => {} };
    this._onReducedChange = () => this._renderOnce();
    this._reducedMQ.addEventListener?.('change', this._onReducedChange);

    this._initGL();
    this.resize();
  }

  // ---- GL setup ------------------------------------------------------------
  _initGL() {
    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('blackhole-lensing: WebGL not available');
    this.gl = gl;

    // fullscreen quad (two triangles) — created once, reused across recompiles
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);

    this._installProgram();
  }

  // (Re)compile + link the program for the current feature toggles, then wire
  // the attribute and uniform locations. Called on init and whenever toggles
  // change — disabled features are #defined out, so they cost nothing.
  _installProgram() {
    const gl = this.gl;
    const vs = this._compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = this._compile(gl.FRAGMENT_SHADER, composeFragment(this.toggles));
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('blackhole-lensing: link failed: ' + gl.getProgramInfoLog(prog));
    }
    if (this.program) gl.deleteProgram(this.program);
    this.program = prog;
    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.uniforms = {};
    for (const name of UNIFORM_NAMES) {
      this.uniforms[name] = gl.getUniformLocation(prog, name);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
  }

  _compile(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('blackhole-lensing: shader compile failed: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  // ---- public API ----------------------------------------------------------
  setParams(patch) { Object.assign(this.params, patch); if (!this._running) this._renderOnce(); }

  /** quality: 'auto' (self-tuning), a preset name, or a partial { steps, resolutionScale, fpsCap } */
  setQuality(q) {
    if (q === 'auto') {
      // start mid (not 'high' — that's catastrophic on a weak GPU and slows the
      // cascade); _adapt() ratchets DOWN until smooth. Down-only → stable.
      this._adaptive = true;
      this._frameSamples = [];
      this._adaptLevel = QUALITY_LADDER.indexOf('medium');
      this._levelSetAt = (typeof performance !== 'undefined') ? performance.now() : 0;
      this.quality = { ...QUALITY_PRESETS[QUALITY_LADDER[this._adaptLevel]] };
    } else {
      this._adaptive = false;
      if (typeof q === 'string') this.quality = { ...QUALITY_PRESETS[q] || this.quality };
      else Object.assign(this.quality, q);
    }
    this.resize();
    if (!this._running) this._renderOnce();
  }

  // Adaptive quality: called per rendered frame with the achieved interval since
  // the previous render. TIME-gated (not frame-count gated) so it cascades even
  // at 2fps: it drops one rung at most once per second while the median frame
  // rate sits under this level's cap. Median shrugs off a GC/resize hitch.
  _adapt(intervalMs, now) {
    if (intervalMs > 0 && intervalMs < 4000) {     // ignore startup/resume gaps
      this._frameSamples.push(intervalMs);
      if (this._frameSamples.length > 30) this._frameSamples.shift();
    }
    if (this._adaptLevel <= 0) return;             // already at the floor
    if (now - this._levelSetAt < 1000) return;     // settle ≥1s before re-judging
    if (this._frameSamples.length < 3) return;     // need a few samples first
    const s = [...this._frameSamples].sort((a, b) => a - b);
    const medFps = 1000 / s[s.length >> 1];
    const cap = this.quality.fpsCap || 60;
    if (medFps < cap * 0.7) {
      this._adaptLevel -= 1;
      this.quality = { ...QUALITY_PRESETS[QUALITY_LADDER[this._adaptLevel]] };
      this.resize();                 // resolutionScale changed → resize the backing store
      this._frameSamples = [];
      this._levelSetAt = now;
    }
  }

  /** current effective quality level name (useful for HUD/debug) */
  get qualityLevel() {
    return this._adaptive ? QUALITY_LADDER[this._adaptLevel] : (this.quality._name || 'custom');
  }

  /** enable/disable features — recompiles the shader so disabled ones cost nothing.
   *  patch e.g. { nebula: false, glow: false }; pass a full map to replace. */
  setToggles(patch) {
    Object.assign(this.toggles, patch);
    this._installProgram();
    if (!this._running) this._renderOnce();
  }

  /** sub-rectangle of the shared virtual scene this instance should render */
  setCameraRect(x, y, w, h) {
    this.params.cameraRect = [x, y, w, h];
    if (!this._running) this._renderOnce();
  }

  get reducedMotion() { return this.respectReducedMotion && this._reducedMQ.matches; }

  resize() {
    if (!this.gl) return;   // construction calls setQuality()→resize() before _initGL()
    const { canvas } = this;
    const cssW = canvas.clientWidth || canvas.width || 300;
    const cssH = canvas.clientHeight || canvas.height || 150;
    const scale = this._dpr * this.quality.resolutionScale;
    const w = Math.max(1, Math.round(cssW * scale));
    const h = Math.max(1, Math.round(cssH * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    if (!this._running) this._renderOnce();
  }

  start() {
    if (this._running) return;
    // reduced motion: render a single static frame and don't loop (saves power)
    if (this.reducedMotion) { this._renderOnce(); return; }
    this._running = true;
    this._lastTick = performance.now();
    this._loop(this._lastTick);
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  destroy() {
    this.stop();
    this._reducedMQ.removeEventListener?.('change', this._onReducedChange);
    const gl = this.gl;
    if (gl) {
      gl.deleteProgram(this.program);
      gl.deleteBuffer(this.buffer);
      const ext = gl.getExtension('WEBGL_lose_context');
      ext && ext.loseContext();
    }
  }

  // ---- loop ----------------------------------------------------------------
  _loop(now) {
    if (!this._running) return;
    this._raf = requestAnimationFrame((t) => this._loop(t));

    const minDelta = 1000 / (this.quality.fpsCap || 60);
    if (now - this._lastFrame < minDelta - 0.5) return; // framerate cap
    const sinceLast = now - this._lastFrame;            // achieved inter-render interval
    const dt = Math.min((now - this._lastTick) / 1000, 0.1);
    this._lastTick = now;
    this._lastFrame = now;

    this._time += dt;
    if (!this.reducedMotion) this._rotation += this.params.rotationSpeed * dt;
    this._draw();
    if (this._adaptive) this._adapt(sinceLast, now);
  }

  _renderOnce() {
    if (!this.gl) return;
    this._draw();
  }

  _draw() {
    const gl = this.gl, u = this.uniforms, p = this.params;
    const w = this.canvas.width, h = this.canvas.height;
    const aspect = p.virtualAspect > 0 ? p.virtualAspect : w / h;

    gl.useProgram(this.program);
    gl.uniform2f(u.uResolution, w, h);
    gl.uniform1f(u.uTime, this._time);
    gl.uniform1f(u.uRotation, this._rotation);
    gl.uniform1f(u.uAspect, aspect);
    gl.uniform4fv(u.uCameraRect, p.cameraRect);
    gl.uniform2fv(u.uOffset, p.offset);
    gl.uniform1f(u.uCamDist, p.camDist);
    gl.uniform1f(u.uInclination, p.inclination);
    gl.uniform1f(u.uFov, p.fov);
    gl.uniform1i(u.uSteps, this.quality.steps);
    gl.uniform1f(u.uHorizon, p.horizon);
    gl.uniform1f(u.uDiskInner, p.diskInner);
    gl.uniform1f(u.uDiskOuter, p.diskOuter);
    gl.uniform1f(u.uPalette, p.palette);
    gl.uniform1f(u.uIntensity, p.intensity);
    gl.uniform1f(u.uBeaming, p.beaming);
    gl.uniform1f(u.uStars, p.stars);
    gl.uniform1f(u.uNebula, p.nebula);
    gl.uniform1f(u.uGlow, p.glow);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
