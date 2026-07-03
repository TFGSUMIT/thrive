// BackgroundCustomize.jsx — live tuning sliders for the WebGL backgrounds
// (black hole / grove), shown inside the Settings → Device → Background picker
// when one of those is selected. Ported from the old standalone module pages
// (#15). Writes params/toggles into the `thrive:ambient` cfg; the live
// <Background/> re-reads on change and applies them without re-creating the GL
// context (the renderers support setParams/setToggles), so the real backdrop
// updates as you drag — lower UI opacity to watch it.
import { useState } from 'react'
import { DEFAULT_PARAMS as BH_DEF, PRESETS as BH_PRE } from 'blackhole-lensing/src/index.js'
import { DEFAULT_PARAMS as GK_DEF, PRESETS as GK_PRE, ALGORITHM_LIST } from 'grovekeeper/src/index.js'
import { readBgPresets, saveBgPreset, deleteBgPreset } from './Background'

const humanize = (s) => s.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim()

const chip = { fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '5px 10px' }
const inp  = { fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '6px 8px', width: '100%', boxSizing: 'border-box' }
const grpH = { fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#666)', margin: '2px 0 8px' }

// ── control specs (mirror the old full-screen tuners) ─────────────────────────
const BH_GROUPS = [
  { t: 'Camera', rows: [
    { k: 'camDist',     label: 'Distance', min: 8,    max: 200, step: 0.5 },
    { k: 'inclination', label: 'Tilt',     min: 0,    max: 1.4, step: 0.005 },
    { k: 'fov',         label: 'Zoom',     min: 0.4,  max: 2.5, step: 0.01 },
    { k: 'offsetX',     label: 'Offset X', min: -0.5, max: 0.5, step: 0.01 },
    { k: 'offsetY',     label: 'Offset Y', min: -0.5, max: 0.5, step: 0.01 },
  ] },
  { t: 'Black hole / disk', rows: [
    { k: 'horizon',   label: 'Shadow radius', min: 0.4, max: 2.5, step: 0.05 },
    { k: 'diskInner', label: 'Disk inner',    min: 1.5, max: 8,   step: 0.1 },
    { k: 'diskOuter', label: 'Disk outer',    min: 5,   max: 20,  step: 0.1 },
  ] },
  { t: 'Look', rows: [
    { k: 'palette',       label: 'Palette',   min: 0, max: 1,   step: 0.01 },
    { k: 'intensity',     label: 'Intensity', min: 0, max: 3,   step: 0.01 },
    { k: 'beaming',       label: 'Beaming',   min: 0, max: 1.5, step: 0.01 },
    { k: 'rotationSpeed', label: 'Rotation',  min: 0, max: 4,   step: 0.01 },
  ] },
  { t: 'Atmosphere', rows: [
    { k: 'stars',  label: 'Stars',  min: 0, max: 2, step: 0.01 },
    { k: 'nebula', label: 'Nebula', min: 0, max: 2, step: 0.01 },
    { k: 'glow',   label: 'Bloom',  min: 0, max: 2, step: 0.01 },
  ] },
]

const GK_CORE = [
  { t: 'Growth', rows: [
    { k: 'growthSeconds', label: 'Grow time',  min: 2,   max: 60,   step: 1,    int: true },
    { k: 'seed',          label: 'Seed',       min: 0,   max: 999,  step: 1,    int: true },
    { k: 'leafPhase',     label: 'Leaf phase', min: 0.4, max: 0.95, step: 0.01 },
    { k: 'windStrength',  label: 'Wind',       min: 0,   max: 3,    step: 0.05 },
  ] },
  { t: 'Camera & light', rows: [
    { k: 'camDist',      label: 'Distance',   min: 2,    max: 9,    step: 0.1 },
    { k: 'camElevation', label: 'Cam height', min: -0.3, max: 1.2,  step: 0.01 },
    { k: 'orbitSpeed',   label: 'Orbit',      min: 0,    max: 0.4,  step: 0.005 },
    { k: 'sunAzimuth',   label: 'Sun dir',    min: 0,    max: 6.28, step: 0.02 },
    { k: 'sunElevation', label: 'Sun height', min: 0,    max: 1.57, step: 0.01 },
    { k: 'leafDensity',  label: 'Leaf count', min: 0,    max: 20,   step: 1, int: true },
    { k: 'leafSize',     label: 'Leaf size',  min: 0.02, max: 0.2,  step: 0.005 },
  ] },
]
const GK_ALGO = {
  recursive: { t: 'Recursive', rows: [
    { k: 'maxDepth',     label: 'Depth',      min: 3,   max: 10,  step: 1, int: true },
    { k: 'regularity',   label: 'Regularity', min: 0,   max: 1,   step: 0.01 },
    { k: 'fractalAngle', label: 'Fork angle', min: 0.1, max: 0.9, step: 0.01 },
  ] },
  spacecol: { t: 'Space colonization', rows: [
    { k: 'crownRadius', label: 'Crown width',  min: 0.5, max: 2.5,  step: 0.05 },
    { k: 'crownHeight', label: 'Crown height', min: 0.6, max: 3,    step: 0.05 },
    { k: 'markerCount', label: 'Density',      min: 60,  max: 1200, step: 20, int: true },
    { k: 'dKill',       label: 'Spacing',      min: 0.08, max: 0.6, step: 0.01 },
  ] },
  lsystem: { t: 'L-system', rows: [
    { k: 'lsysIters', label: 'Iterations', min: 1,   max: 6,    step: 1, int: true },
    { k: 'lsysAngle', label: 'Angle',      min: 0.1, max: 1.2,  step: 0.02 },
    { k: 'lsysTaper', label: 'Taper',      min: 0.5, max: 0.95, step: 0.01 },
  ] },
  selforg: { t: 'Self-organizing', rows: [
    { k: 'soIters',   label: 'Growth cycles',  min: 4,   max: 28,   step: 1, int: true },
    { k: 'soLambda',  label: 'Apical control', min: 0.5, max: 0.62, step: 0.005 },
    { k: 'soAngle',   label: 'Branch angle',   min: 0.4, max: 1.4,  step: 0.02 },
    { k: 'soTropism', label: 'Upward pull',    min: 0,   max: 0.7,  step: 0.02 },
  ] },
}
const GK_COLORS = [
  { k: 'bgTop', label: 'Sky top' }, { k: 'bgBottom', label: 'Sky bot' },
  { k: 'bark', label: 'Bark' }, { k: 'barkLight', label: 'Bark tip' },
  { k: 'leaf', label: 'Leaf' }, { k: 'leafLight', label: 'Leaf lt' },
  { k: 'blossom', label: 'Blossom' },
]
const GK_TOGGLES = ['leaves', 'blossoms', 'wind', 'ground']

// effective defaults the wrapper renders when cfg is empty — so sliders start
// where the live background actually is.
const baseParams = (kind) => kind === 'blackhole'
  ? { ...BH_DEF, ...BH_PRE.thriveSubtle.params }
  : { ...GK_DEF, ...GK_PRE.groveSubtle.params }
const baseToggles = (kind) => kind === 'blackhole'
  ? { ...(BH_PRE.thriveSubtle.toggles || {}) }
  : { ...(GK_PRE.groveSubtle.toggles || {}) }

function Slider({ label, min, max, step, int, value, onChange }) {
  const v = typeof value === 'number' ? value : min
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-tertiary,#666)', marginBottom: 2 }}>
        <span>{label}</span>
        <b style={{ color: 'var(--text-secondary,#aaa)', fontFamily: 'monospace' }}>{int ? Math.round(v) : v.toFixed(2)}</b>
      </div>
      <input type="range" min={min} max={max} step={step} value={v}
        onChange={e => onChange(int ? parseInt(e.target.value, 10) : parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)' }} />
    </div>
  )
}

export default function BackgroundCustomize({ kind, cfg, onChange }) {
  const params  = { ...baseParams(kind),  ...(cfg.params  || {}) }
  const toggles = { ...baseToggles(kind), ...(cfg.toggles || {}) }
  const setParam  = (k, v) => onChange({ ...cfg, params:  { ...(cfg.params  || {}), [k]: v } })
  const setToggle = (k, v) => onChange({ ...cfg, toggles: { ...(cfg.toggles || {}), [k]: v } })

  const algo   = params.algorithm || 'recursive'
  const groups = kind === 'blackhole' ? BH_GROUPS : [...GK_CORE, GK_ALGO[algo]].filter(Boolean)

  // presets: the lib's built-in looks (quick-starts) + user-saved ones (per device)
  const builtins = kind === 'blackhole' ? BH_PRE : GK_PRE
  const [saved, setSaved] = useState(() => readBgPresets().filter(p => p.kind === kind))
  const applyPreset = (p) => onChange({ params: { ...(p.params || {}) }, toggles: { ...(p.toggles || {}) } })
  const saveCurrent = () => {
    const name = (window.prompt('Save this look as…') || '').trim()
    if (!name) return
    setSaved(saveBgPreset(name, kind, { params: cfg.params || {}, toggles: cfg.toggles || {} }).filter(p => p.kind === kind))
  }
  const removePreset = (name) => setSaved(deleteBgPreset(name, kind).filter(p => p.kind === kind))

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border-color,#2a2a2a)', paddingTop: 12 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={grpH}>Presets</div>
          <button style={chip} onClick={saveCurrent}>＋ Save current</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(builtins).map(([key, p]) => (
            <button key={key} title="Built-in look" style={chip} onClick={() => applyPreset(p)}>{humanize(key)}</button>
          ))}
          {saved.map(p => (
            <span key={p.name} style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--accent)', borderRadius: 6, overflow: 'hidden' }}>
              <button style={{ ...chip, border: 'none', color: 'var(--accent)', padding: '5px 8px' }} onClick={() => applyPreset(p.cfg)}>★ {p.name}</button>
              <button title="Delete preset" style={{ ...chip, border: 'none', borderLeft: '1px solid var(--accent)', color: 'var(--text-tertiary,#888)', padding: '5px 7px' }}
                onClick={() => removePreset(p.name)}>×</button>
            </span>
          ))}
        </div>
      </div>
      {kind === 'grovekeeper' && (
        <div style={{ marginBottom: 12 }}>
          <div style={grpH}>Algorithm</div>
          <select style={inp} value={algo} onChange={e => setParam('algorithm', e.target.value)}>
            {ALGORITHM_LIST.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      )}

      {groups.map(g => (
        <div key={g.t} style={{ marginBottom: 12 }}>
          <div style={grpH}>{g.t}</div>
          {g.rows.map(r => (
            <Slider key={r.k} {...r} value={params[r.k]} onChange={v => setParam(r.k, v)} />
          ))}
        </div>
      ))}

      {kind === 'grovekeeper' && (
        <>
          <div style={{ marginBottom: 12 }}>
            <div style={grpH}>Colors</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {GK_COLORS.map(c => (
                <label key={c.k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, fontSize: 9, color: 'var(--text-tertiary,#666)' }}>
                  <input type="color" value={params[c.k] || '#000000'} onChange={e => setParam(c.k, e.target.value)}
                    style={{ width: 34, height: 26, padding: 0, border: '1px solid var(--border-color,#333)', borderRadius: 5, background: 'none', cursor: 'pointer' }} />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={grpH}>Features</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {GK_TOGGLES.map(k => {
                const on = !!toggles[k]
                return (
                  <button key={k} onClick={() => setToggle(k, !on)}
                    style={{ ...chip, ...(on ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : { opacity: 0.55 }) }}>
                    {k}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}

      <button style={chip} onClick={() => onChange({ params: {}, toggles: {} })}>Reset to default</button>
    </div>
  )
}
