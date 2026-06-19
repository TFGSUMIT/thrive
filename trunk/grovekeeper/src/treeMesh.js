// =============================================================================
// treeMesh.js — algorithm dispatcher + shared skeleton mesher.
//
// buildTreeMesh() picks a generator from treeAlgorithms.js (recursive / spacecol /
// lsystem), then meshSkeleton() turns the returned segments into the merged WebGL
// attribute buffers: tapered branch tubes + joint "knuckle" spheres + billboarded
// leaf clouds, with growth window / wind / lighting attrs baked per vertex. This
// part is shared across every algorithm.
// =============================================================================
import { add, scale, normalize } from './mat4.js';
import { mulberry32, frame } from './treeUtil.js';
import { ALGORITHMS } from './treeAlgorithms.js';

const RADIAL = 6;   // sides per branch tube

export function buildTreeMesh(params) {
  const seed = params.seed | 0;
  const gen = ALGORITHMS[params.algorithm] || ALGORITHMS.recursive;
  const skeleton = gen(params, mulberry32(seed));
  // separate rng stream for the mesher (leaf scatter / bend) so it doesn't perturb
  // the algorithm's determinism
  const mesh = meshSkeleton(skeleton, params, mulberry32((Math.imul(seed, 2654435761) >>> 0) ^ 0x9e3779b9));
  return { branches: mesh.branches, leaves: mesh.leaves, bounds: skeleton.bounds };
}

function meshSkeleton(skeleton, params, rand) {
  const B = { pos: [], base: [], normal: [], grow: [], sway: [], phase: [], colorT: [] };
  const L = { anchor: [], corner: [], t0: [], hue: [], phase: [], blossom: [], size: [] };
  const leafDensity = Math.max(0, Math.round(params.leafDensity ?? 7));
  const leafSize = params.leafSize ?? 0.065;

  const pushVert = (p, n, basePt, t0, t1, sway, phase, colorT) => {
    B.pos.push(p[0], p[1], p[2]); B.normal.push(n[0], n[1], n[2]); B.base.push(basePt[0], basePt[1], basePt[2]);
    B.grow.push(t0, t1); B.sway.push(sway); B.phase.push(phase); B.colorT.push(colorT);
  };

  // low-poly sphere at a joint — fills the wedge where angled tubes meet, rounds tips
  function knuckle(center, radius, t0, t1, sway, phase, colorT) {
    const RINGS = 4, SECT = 6;
    const pt = (th, ph) => add(center, [radius * Math.sin(th) * Math.cos(ph), radius * Math.cos(th), radius * Math.sin(th) * Math.sin(ph)]);
    const nm = (th, ph) => [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    for (let i = 0; i < RINGS; i++) {
      const ta = i / RINGS * Math.PI, tb = (i + 1) / RINGS * Math.PI;
      for (let j = 0; j < SECT; j++) {
        const pa = j / SECT * 2 * Math.PI, pb = (j + 1) / SECT * 2 * Math.PI;
        const A = pt(ta, pa), Bv = pt(tb, pa), C = pt(tb, pb), D = pt(ta, pb);
        pushVert(A, nm(ta, pa), center, t0, t1, sway, phase, colorT);
        pushVert(Bv, nm(tb, pa), center, t0, t1, sway, phase, colorT);
        pushVert(C, nm(tb, pb), center, t0, t1, sway, phase, colorT);
        pushVert(A, nm(ta, pa), center, t0, t1, sway, phase, colorT);
        pushVert(C, nm(tb, pb), center, t0, t1, sway, phase, colorT);
        pushVert(D, nm(ta, pb), center, t0, t1, sway, phase, colorT);
      }
    }
  }

  function band(C0, R0, C1, R1, u, v, basePt, t0, t1, sway, phase, colorT) {
    for (let j = 0; j < RADIAL; j++) {
      const a0 = (j / RADIAL) * Math.PI * 2, a1 = ((j + 1) / RADIAL) * Math.PI * 2;
      const d0 = add(scale(u, Math.cos(a0)), scale(v, Math.sin(a0)));
      const d1 = add(scale(u, Math.cos(a1)), scale(v, Math.sin(a1)));
      const v00 = add(C0, scale(d0, R0)), v01 = add(C0, scale(d1, R0));
      const v10 = add(C1, scale(d0, R1)), v11 = add(C1, scale(d1, R1));
      pushVert(v00, d0, basePt, t0, t1, sway, phase, colorT);
      pushVert(v10, d0, basePt, t0, t1, sway, phase, colorT);
      pushVert(v11, d1, basePt, t0, t1, sway, phase, colorT);
      pushVert(v00, d0, basePt, t0, t1, sway, phase, colorT);
      pushVert(v11, d1, basePt, t0, t1, sway, phase, colorT);
      pushVert(v01, d1, basePt, t0, t1, sway, phase, colorT);
    }
  }

  function leafCloud(tip, branchLen) {
    const r = branchLen * 0.42 + leafSize;
    for (let k = 0; k < leafDensity; k++) {
      const a = rand() * Math.PI * 2, e = (rand() - 0.5) * Math.PI, rr = r * Math.cbrt(rand());
      const anchor = [
        tip[0] + Math.cos(a) * Math.cos(e) * rr,
        tip[1] + Math.sin(e) * rr * 0.8 + r * 0.2,
        tip[2] + Math.sin(a) * Math.cos(e) * rr,
      ];
      const sz = leafSize * (0.6 + rand() * 0.8);
      const t0 = params.leafPhase + rand() * (1 - params.leafPhase) * 0.7;
      const hue = rand(), blossom = rand() < 0.12 ? 1 : 0, ph = rand() * Math.PI * 2;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
      for (const c of corners) {
        L.anchor.push(anchor[0], anchor[1], anchor[2]); L.corner.push(c[0], c[1]);
        L.t0.push(t0); L.hue.push(hue); L.phase.push(ph); L.blossom.push(blossom); L.size.push(sz);
      }
    }
  }

  for (const s of skeleton.segments) {
    const dir = normalize([s.p1[0] - s.p0[0], s.p1[1] - s.p0[1], s.p1[2] - s.p0[2]]);
    const [u, v] = frame(dir);
    const sway = Math.pow(s.level, 0.7), colorT = s.level, phase = rand() * Math.PI * 2;
    const len = Math.hypot(s.p1[0] - s.p0[0], s.p1[1] - s.p0[1], s.p1[2] - s.p0[2]);

    knuckle(s.p0, s.rBase * 1.15, s.t0, s.t1, sway, phase, colorT);

    // gentle bezier bend along the segment, tessellated into 2 bands
    const bend = len * 0.05 * (rand() - 0.5) * 2;
    const ctrl = add([(s.p0[0] + s.p1[0]) / 2, (s.p0[1] + s.p1[1]) / 2, (s.p0[2] + s.p1[2]) / 2], scale(u, bend));
    const bez = (t) => {
      const it = 1 - t;
      return [
        it * it * s.p0[0] + 2 * it * t * ctrl[0] + t * t * s.p1[0],
        it * it * s.p0[1] + 2 * it * t * ctrl[1] + t * t * s.p1[1],
        it * it * s.p0[2] + 2 * it * t * ctrl[2] + t * t * s.p1[2],
      ];
    };
    const SUB = 2;
    for (let i = 0; i < SUB; i++) {
      const ta = i / SUB, tb = (i + 1) / SUB;
      band(bez(ta), s.rBase + (s.rTip - s.rBase) * ta, bez(tb), s.rBase + (s.rTip - s.rBase) * tb, u, v, s.p0, s.t0, s.t1, sway, phase, colorT);
    }

    if (s.tip) knuckle(s.p1, s.rTip, s.t0, s.t1, sway, phase, colorT);
    if (s.leaf) leafCloud(s.p1, s.len);
  }

  return {
    branches: {
      pos: new Float32Array(B.pos), base: new Float32Array(B.base), normal: new Float32Array(B.normal),
      grow: new Float32Array(B.grow), sway: new Float32Array(B.sway), phase: new Float32Array(B.phase),
      colorT: new Float32Array(B.colorT), count: B.pos.length / 3,
    },
    leaves: {
      anchor: new Float32Array(L.anchor), corner: new Float32Array(L.corner), t0: new Float32Array(L.t0),
      hue: new Float32Array(L.hue), phase: new Float32Array(L.phase), blossom: new Float32Array(L.blossom),
      size: new Float32Array(L.size), count: L.anchor.length / 3,
    },
  };
}
