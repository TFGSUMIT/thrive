// =============================================================================
// TreeRenderer — WebGL1 3D growing-tree renderer.
//
// A seeded tree built as real geometry: tapered lit branch tubes + billboarded
// leaf foliage, a directional sun + ambient, vertex wind, a soft contact shadow,
// and a slowly-orbiting perspective camera. Growth (uProgress) and wind (uTime)
// are uniform-driven so the mesh is built once.
//
// Public API mirrors BlackHoleRenderer so the React wrapper, the tuner page, and
// the unified ambient picker treat both renderers the same:
//   const r = new TreeRenderer(canvas, params, { quality, toggles, respectReducedMotion })
//   r.setParams({...}) · r.setToggles({...}) · r.setQuality('low')
//   r.start() · r.stop() · r.resize() · r.destroy()
//   r.scrubTo(p) · r.replay(fromP) · r.progress
// =============================================================================
import { buildTreeMesh } from './treeMesh.js';
import { perspective, lookAt, multiply, normalize, sub, cross } from './mat4.js';
import {
  SKY_VS, SKY_FS, GROUND_VS, GROUND_FS, BRANCH_VS, BRANCH_FS, LEAF_VS, LEAF_FS,
} from './treeShaders.js';

export const DEFAULT_PARAMS = {
  // which skeleton generator: 'recursive' | 'spacecol' | 'lsystem' | 'selforg'
  algorithm:     'recursive',
  // structure / growth
  growthSeconds: 18,
  seed:          7,
  leafPhase:     0.70,
  windStrength:  1.0,
  // recursive
  maxDepth:      8,
  regularity:    0.0,
  fractalAngle:  0.42,
  // space colonization
  crownRadius:   1.2,
  crownHeight:   1.8,
  markerCount:   480,
  dKill:         0.30,
  // l-system
  lsysIters:     4,
  lsysAngle:     0.42,
  lsysTaper:     0.78,
  // self-organizing (Palubicki)
  soIters:       16,
  soLambda:      0.52,
  soAngle:       0.85,
  soTropism:     0.30,
  // foliage
  leafDensity:   7,
  leafSize:      0.065,
  trunkRadius:   0.06,
  // camera (orbit auto-advances by orbitSpeed; drag/wheel set camAzimuth/camDist)
  camDist:       4.2,
  camAzimuth:    0.0,
  camElevation:  0.16,
  orbitSpeed:    0.0,
  fov:           0.72,
  // light
  sunAzimuth:    0.9,
  sunElevation:  0.95,
  ambient:       0.38,
  // colors
  bgTop:     '#26405c',
  bgBottom:  '#0c131c',
  bark:      '#5b4636',
  barkLight: '#8a6a4d',
  leaf:      '#4f7d3e',
  leafLight: '#86bd63',
  blossom:   '#e8c46b',
};

export const DEFAULT_TOGGLES = { leaves: true, blossoms: true, wind: true, ground: true, sky: true };
export const FEATURES = ['leaves', 'blossoms', 'wind', 'ground', 'sky'];

export const QUALITY_PRESETS = {
  ultra:  { resolutionScale: 1.0,  fpsCap: 60 },
  high:   { resolutionScale: 1.0,  fpsCap: 60 },
  medium: { resolutionScale: 0.85, fpsCap: 48 },
  low:    { resolutionScale: 0.66, fpsCap: 30 },
  potato: { resolutionScale: 0.5,  fpsCap: 24 },
};

// changing any of these rebuilds the mesh; everything else is live uniforms
const STRUCTURAL = [
  'algorithm', 'seed', 'leafPhase', 'leafDensity', 'leafSize', 'trunkRadius',
  'maxDepth', 'regularity', 'fractalAngle',                       // recursive
  'crownRadius', 'crownHeight', 'markerCount', 'dKill',           // spacecol
  'lsysIters', 'lsysAngle', 'lsysTaper',                          // lsystem
  'soIters', 'soLambda', 'soAngle', 'soTropism',                  // self-organizing
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function hex3(h) {
  h = String(h).replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}
const WIND_DIR = normalize([1, 0, 0.35]);

export class TreeRenderer {
  constructor(canvas, params = {}, options = {}) {
    this.canvas = canvas;
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.quality = { ...QUALITY_PRESETS[options.quality || 'high'] };
    this.toggles = { ...DEFAULT_TOGGLES, ...(options.toggles || {}) };
    this.respectReducedMotion = options.respectReducedMotion !== false;

    this._dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._raf = null; this._running = false;
    this._lastFrame = 0; this._lastTick = 0; this._time = 0;
    this._auto = true; this._start = null; this._pinned = 0; this._progress = 0;
    this._enabledLocs = new Set();

    this._reducedMQ = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : { matches: false, addEventListener: () => {} };
    this._onReducedChange = () => this._renderOnce();
    this._reducedMQ.addEventListener?.('change', this._onReducedChange);

    this._loopBound = this._loop.bind(this);
    this._initGL();
    this._buildMesh();
    this.resize();
  }

  // ---- GL setup ------------------------------------------------------------
  _initGL() {
    const gl = this.canvas.getContext('webgl', {
      alpha: true, premultipliedAlpha: false, antialias: true, depth: true, powerPreference: 'low-power',
    });
    if (!gl) throw new Error('grovekeeper: WebGL not available');
    this.gl = gl;
    this.sky    = this._program(SKY_VS, SKY_FS);
    this.ground = this._program(GROUND_VS, GROUND_FS);
    this.branch = this._program(BRANCH_VS, BRANCH_FS);
    this.leaf   = this._program(LEAF_VS, LEAF_FS);

    // static geometry: fullscreen sky quad + a ground plane (rebuilt to tree extent on mesh build)
    this._skyBuf = this._buf(new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]));
    this._groundBuf = gl.createBuffer();
    this._b = {};   // mesh attribute buffers, (re)created on build
  }

  _program(vsSrc, fsSrc) {
    const gl = this.gl;
    const vs = this._shader(gl.VERTEX_SHADER, vsSrc);
    const fs = this._shader(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('grovekeeper link: ' + gl.getProgramInfoLog(prog));
    gl.deleteShader(vs); gl.deleteShader(fs);
    const al = {}, ul = {};
    return {
      prog,
      a: (n) => (al[n] ??= gl.getAttribLocation(prog, n)),
      u: (n) => (ul[n] ??= gl.getUniformLocation(prog, n)),
    };
  }
  _shader(type, src) {
    const gl = this.gl, sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('grovekeeper shader: ' + gl.getShaderInfoLog(sh));
    return sh;
  }
  _buf(data) {
    const gl = this.gl, b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }

  // ---- mesh ----------------------------------------------------------------
  _buildMesh() {
    const gl = this.gl;
    const mesh = buildTreeMesh(this.params);
    this.bounds = mesh.bounds;
    // (re)create attribute buffers
    for (const k in this._b) gl.deleteBuffer(this._b[k]);
    const B = mesh.branches, L = mesh.leaves;
    this._b = {
      bPos: this._buf(B.pos), bBase: this._buf(B.base), bNormal: this._buf(B.normal),
      bGrow: this._buf(B.grow), bSway: this._buf(B.sway), bPhase: this._buf(B.phase), bColorT: this._buf(B.colorT),
      lAnchor: this._buf(L.anchor), lCorner: this._buf(L.corner), lT0: this._buf(L.t0),
      lHue: this._buf(L.hue), lPhase: this._buf(L.phase), lBlossom: this._buf(L.blossom), lSize: this._buf(L.size),
    };
    this._branchCount = B.count;
    this._leafCount = L.count;

    // big ground plane so it recedes to the horizon (not a small disk that reads
    // like a black-hole silhouette); its far edge fades into the sky in the shader
    const g = this.bounds.radius * 8 + 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._groundBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -g, 0, -g, g, 0, -g, -g, 0, g, -g, 0, g, g, 0, -g, g, 0, g,
    ]), gl.STATIC_DRAW);
    this._groundExtent = g;
  }

  // ---- camera --------------------------------------------------------------
  _camera() {
    const p = this.params, b = this.bounds;
    const az = p.camAzimuth + (this._auto ? this._time * p.orbitSpeed : 0);
    const el = p.camElevation;
    const ce = Math.cos(el), se = Math.sin(el);
    const centerY = b.maxY * 0.45;
    const eye = [
      Math.cos(el) * Math.sin(az) * p.camDist,
      centerY + p.camDist * se,
      Math.cos(el) * Math.cos(az) * p.camDist,
    ];
    const center = [0, centerY, 0];
    const view = lookAt(eye, center, [0, 1, 0]);
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = perspective(p.fov, aspect, 0.05, 60);
    const vp = multiply(proj, view);
    // camera basis for leaf billboards (world space)
    const fwd = normalize(sub(center, eye));
    const right = normalize(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    return { vp, right, up };
  }

  // ---- public API ----------------------------------------------------------
  get reducedMotion() { return this.respectReducedMotion && this._reducedMQ.matches; }
  get progress() { return this._auto ? this._progress : this._pinned; }

  setParams(patch) {
    const structural = STRUCTURAL.some(k => k in patch && patch[k] !== this.params[k]);
    Object.assign(this.params, patch);
    if (structural) this._buildMesh();
    if (!this._running) this._renderOnce();
  }
  setQuality(q) {
    if (typeof q === 'string') this.quality = { ...QUALITY_PRESETS[q] || this.quality };
    else Object.assign(this.quality, q);
    this.resize();
  }
  setToggles(patch) { Object.assign(this.toggles, patch); if (!this._running) this._renderOnce(); }

  scrubTo(p) { this._auto = false; this._pinned = clamp(p, 0, 1); if (!this._running) this._renderOnce(); }
  replay(fromP = 0) {
    this._auto = true;
    this._start = fromP > 0 ? performance.now() - fromP * this.params.growthSeconds * 1000 : null;
    if (!this._running) this.start();
  }

  resize() {
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    const s = this._dpr * this.quality.resolutionScale;
    const w = Math.max(1, Math.round(cssW * s)), h = Math.max(1, Math.round(cssH * s));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.gl.viewport(0, 0, w, h);
    if (!this._running) this._renderOnce();
  }

  _currentP() { return this._auto ? this._progress : this._pinned; }

  start() {
    if (this._running) return;
    if (this.reducedMotion) { this._renderOnce(); return; }
    this._running = true; this._lastFrame = 0; this._lastTick = performance.now();
    this._raf = requestAnimationFrame(this._loopBound);
  }
  stop() { this._running = false; if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }
  destroy() {
    this.stop();
    this._reducedMQ.removeEventListener?.('change', this._onReducedChange);
    const gl = this.gl;
    if (gl) { const ext = gl.getExtension('WEBGL_lose_context'); ext && ext.loseContext(); }
  }

  _loop(now) {
    if (!this._running) return;
    this._raf = requestAnimationFrame(this._loopBound);
    const minDelta = 1000 / (this.quality.fpsCap || 60);
    if (now - this._lastFrame < minDelta - 0.5) return;
    const dt = Math.min((now - this._lastTick) / 1000, 0.1);
    this._lastTick = now; this._lastFrame = now;
    this._time += dt;
    if (this._auto) {
      if (this._start === null) this._start = now;
      this._progress = clamp((now - this._start) / (this.params.growthSeconds * 1000), 0, 1);
    }
    this._draw();
  }
  _renderOnce() {
    if (!this.gl) return;
    if (this.reducedMotion) { this._progress = 1; this._auto = false; this._pinned = 1; }
    this._draw();
  }

  // ---- draw ----------------------------------------------------------------
  _attribs(prog, map) {
    const gl = this.gl;
    for (const loc of this._enabledLocs) gl.disableVertexAttribArray(loc);
    this._enabledLocs.clear();
    for (const name in map) {
      const loc = prog.a(name); if (loc < 0) continue;
      const { buffer, size } = map[name];
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      this._enabledLocs.add(loc);
    }
  }

  _draw() {
    const gl = this.gl, p = this.params, t = this.toggles;
    const P = this._currentP();
    const wind = t.wind ? p.windStrength : 0;
    const col = {
      top: hex3(p.bgTop), bottom: hex3(p.bgBottom),
      bark: hex3(p.bark), barkLight: hex3(p.barkLight),
      leaf: hex3(p.leaf), leafLight: hex3(p.leafLight), blossom: hex3(p.blossom),
    };
    const se = Math.sin(p.sunElevation), ce = Math.cos(p.sunElevation);
    const sun = normalize([ce * Math.sin(p.sunAzimuth), se, ce * Math.cos(p.sunAzimuth)]);
    const { vp, right, up } = this._camera();

    gl.clearColor(col.bottom[0], col.bottom[1], col.bottom[2], t.sky ? 1 : 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // sky (no depth)
    if (t.sky) {
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND);
      gl.useProgram(this.sky.prog);
      gl.uniform3fv(this.sky.u('uTop'), col.top); gl.uniform3fv(this.sky.u('uBottom'), col.bottom);
      this._attribs(this.sky, { aPos: { buffer: this._skyBuf, size: 2 } });
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.enable(gl.BLEND);
    }

    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);

    // ground + contact shadow
    if (t.ground) {
      gl.depthMask(true);
      gl.useProgram(this.ground.prog);
      gl.uniformMatrix4fv(this.ground.u('uVP'), false, vp);
      const ground = [col.bottom[0] * 0.5 + 0.09, col.bottom[1] * 0.5 + 0.10, col.bottom[2] * 0.5 + 0.06];
      gl.uniform3fv(this.ground.u('uGround'), ground);
      gl.uniform3fv(this.ground.u('uShadow'), [ground[0] * 0.35, ground[1] * 0.35, ground[2] * 0.3]);
      gl.uniform1f(this.ground.u('uShadowR'), Math.max(0.4, this.bounds.radius * 0.8));
      gl.uniform1f(this.ground.u('uEdge'), this._groundExtent);
      this._attribs(this.ground, { aPos: { buffer: this._groundBuf, size: 3 } });
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // branches (opaque, lit)
    gl.disable(gl.BLEND); gl.depthMask(true);
    gl.useProgram(this.branch.prog);
    gl.uniformMatrix4fv(this.branch.u('uVP'), false, vp);
    gl.uniform1f(this.branch.u('uTime'), this._time);
    gl.uniform1f(this.branch.u('uProgress'), P);
    gl.uniform1f(this.branch.u('uWind'), wind);
    gl.uniform3fv(this.branch.u('uWindDir'), WIND_DIR);
    gl.uniform3fv(this.branch.u('uSun'), sun);
    gl.uniform3fv(this.branch.u('uBark'), col.bark);
    gl.uniform3fv(this.branch.u('uBarkLight'), col.barkLight);
    gl.uniform1f(this.branch.u('uAmbient'), p.ambient);
    this._attribs(this.branch, {
      aPos: { buffer: this._b.bPos, size: 3 }, aBase: { buffer: this._b.bBase, size: 3 },
      aNormal: { buffer: this._b.bNormal, size: 3 }, aGrow: { buffer: this._b.bGrow, size: 2 },
      aSway: { buffer: this._b.bSway, size: 1 }, aPhase: { buffer: this._b.bPhase, size: 1 },
      aColorT: { buffer: this._b.bColorT, size: 1 },
    });
    gl.drawArrays(gl.TRIANGLES, 0, this._branchCount);

    // leaves (billboarded, blended, no depth write)
    if (t.leaves && this._leafCount > 0) {
      gl.enable(gl.BLEND); gl.depthMask(false);
      gl.useProgram(this.leaf.prog);
      gl.uniformMatrix4fv(this.leaf.u('uVP'), false, vp);
      gl.uniform1f(this.leaf.u('uTime'), this._time);
      gl.uniform1f(this.leaf.u('uProgress'), P);
      gl.uniform1f(this.leaf.u('uWind'), wind);
      gl.uniform3fv(this.leaf.u('uCamRight'), right);
      gl.uniform3fv(this.leaf.u('uCamUp'), up);
      gl.uniform3fv(this.leaf.u('uWindDir'), WIND_DIR);
      gl.uniform3fv(this.leaf.u('uLeaf'), col.leaf);
      gl.uniform3fv(this.leaf.u('uLeafLight'), col.leafLight);
      gl.uniform3fv(this.leaf.u('uBlossom'), col.blossom);
      gl.uniform3fv(this.leaf.u('uSun'), sun);
      gl.uniform1f(this.leaf.u('uAmbient'), p.ambient);
      gl.uniform1f(this.leaf.u('uShowBlossom'), t.blossoms ? 1 : 0);
      this._attribs(this.leaf, {
        aAnchor: { buffer: this._b.lAnchor, size: 3 }, aCorner: { buffer: this._b.lCorner, size: 2 },
        aT0: { buffer: this._b.lT0, size: 1 }, aHue: { buffer: this._b.lHue, size: 1 },
        aPhase: { buffer: this._b.lPhase, size: 1 }, aBlossom: { buffer: this._b.lBlossom, size: 1 },
        aSize: { buffer: this._b.lSize, size: 1 },
      });
      gl.drawArrays(gl.TRIANGLES, 0, this._leafCount);
      gl.depthMask(true);
    }
  }
}
