// =============================================================================
// GrovekeeperPage.jsx — full-screen interactive growing tree + preset manager
// thrive UI — reached via the 🌳 nav icon (/grovekeeper)
//
// Full-quality interactive view of the shared grovekeeper renderer with a preset
// dropdown (library built-ins + user presets from the DB), live controls (sliders,
// color pickers, feature toggles), replay/scrub of the growth, save/delete, and
// "Set as background" (writes the unified thrive:ambient picker).
// =============================================================================
import { useEffect, useRef, useState } from 'react'
import { api } from '@trunk/api'
import { useToast } from '@trunk/context/ToastContext'
import { TreeRenderer, PRESETS, DEFAULT_TOGGLES, FEATURES, ALGORITHM_LIST } from 'grovekeeper/src/index.js'

const ACCENT = '#82b85f'

// library built-ins, surfaced in the dropdown alongside DB presets
const BUILTINS = [
  { key: 'b:spring',      name: 'Spring (built-in)', data: { ...PRESETS.spring } },
  { key: 'b:groveSubtle', name: 'Subtle (built-in)', data: { ...PRESETS.groveSubtle } },
]

// panel/grip backgrounds scale with the global UI opacity (Settings → UI)
const PANEL_BG = 'rgba(14,18,24, calc(0.92 * var(--ui-alpha, 1)))'
const panel = { background: PANEL_BG, border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, padding: 14, backdropFilter: 'blur(6px)' }
const btnS  = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '6px 10px' }
const btnP  = { ...btnS, background: 'var(--text-primary,#e8e6e0)', color: 'var(--bg-primary,#0f0f0f)', border: 'none', fontWeight: 600 }
const inp   = { fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '6px 8px', width: '100%', boxSizing: 'border-box' }
const lbl   = { fontSize: 10, color: 'var(--text-tertiary,#666)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }

// shown for every algorithm
const CORE_GROUPS = [
  { t: 'Growth', rows: [
    { k: 'growthSeconds', label: 'Grow time', min: 2,   max: 60,  step: 1,    int: true,
      tip: 'Seconds for the tree to grow from sprout to full canopy.' },
    { k: 'seed',          label: 'Seed',      min: 0,   max: 999, step: 1,    int: true,
      tip: 'Picks WHICH tree. The same number always grows the exact same tree; change it to roll a completely different random shape.' },
    { k: 'leafPhase',     label: 'Leaf phase',min: 0.4, max: 0.95,step: 0.01,
      tip: 'How far into the growth the branches finish and leaves start blooming. Lower = leaves appear sooner.' },
  ] },
  { t: 'Wind', rows: [
    { k: 'windStrength',  label: 'Wind',      min: 0,   max: 3,   step: 0.05,
      tip: 'How hard the breeze sways the tree. 0 = dead calm, 1 = breezy, 2+ = storm.' },
  ] },
  { t: 'Camera & light', rows: [
    { k: 'camDist',      label: 'Distance',   min: 2,    max: 9,    step: 0.1,
      tip: 'How far the camera sits from the tree. The mouse wheel zooms this too.' },
    { k: 'camElevation', label: 'Cam height', min: -0.3, max: 1.2,  step: 0.01,
      tip: 'Camera angle above the ground. Drag the canvas to orbit and tilt as well.' },
    { k: 'orbitSpeed',   label: 'Orbit',      min: 0,    max: 0.4,  step: 0.005,
      tip: 'Speed the camera slowly circles the tree (the parallax that sells the 3D). 0 = hold still.' },
    { k: 'sunAzimuth',   label: 'Sun dir',    min: 0,    max: 6.28, step: 0.02,
      tip: 'Compass direction the sunlight comes from — rotates the highlights/shadows around the tree.' },
    { k: 'sunElevation', label: 'Sun height', min: 0,    max: 1.57, step: 0.01,
      tip: 'How high the sun sits. Low = long raking light; high = lit from above.' },
    { k: 'leafDensity',  label: 'Leaf count', min: 0,    max: 20,   step: 1, int: true,
      tip: 'Leaves grown at each branch tip. Higher = a fuller, heavier canopy.' },
    { k: 'leafSize',     label: 'Leaf size',  min: 0.02, max: 0.2,  step: 0.005,
      tip: 'Size of each leaf card.' },
  ] },
]
// shown for the selected algorithm only
const ALGO_GROUPS = {
  recursive: { t: 'Recursive', rows: [
    { k: 'maxDepth',     label: 'Depth',      min: 3,   max: 10,  step: 1, int: true,
      tip: 'How many times branches fork. Higher = bushier and more detailed (and heavier to draw).' },
    { k: 'regularity',   label: 'Regularity', min: 0,   max: 1,   step: 0.01,
      tip: '0 = organic, randomized branching. 1 = a perfectly symmetric mathematical fractal. In between blends the two.' },
    { k: 'fractalAngle', label: 'Fork angle', min: 0.1, max: 0.9, step: 0.01,
      tip: 'The angle branches split at, used more as Regularity approaches 1. Wider = more spread-out tree.' },
  ] },
  spacecol: { t: 'Space colonization', rows: [
    { k: 'crownRadius',  label: 'Crown width', min: 0.5, max: 2.5,  step: 0.05,
      tip: 'Radius of the crown the branches grow to fill.' },
    { k: 'crownHeight',  label: 'Crown height',min: 0.6, max: 3,    step: 0.05,
      tip: 'Vertical size of the crown envelope branches fill toward.' },
    { k: 'markerCount',  label: 'Density',     min: 60,  max: 1200, step: 20, int: true,
      tip: 'Attraction points filling the crown — buds compete for them. More = denser, finer branching (heavier to build).' },
    { k: 'dKill',        label: 'Spacing',     min: 0.08,max: 0.6,  step: 0.01,
      tip: 'How close a branch must get to "claim" a point. Larger = sparser, chunkier branches.' },
  ] },
  lsystem: { t: 'L-system', rows: [
    { k: 'lsysIters',    label: 'Iterations',  min: 1,   max: 6,    step: 1, int: true,
      tip: 'How many times the rewrite rules expand. Higher = much more detail (grows fast).' },
    { k: 'lsysAngle',    label: 'Angle',       min: 0.1, max: 1.2,  step: 0.02,
      tip: 'Turn angle applied at each branch in the rule.' },
    { k: 'lsysTaper',    label: 'Taper',       min: 0.5, max: 0.95, step: 0.01,
      tip: 'How much each level shrinks in length + thickness.' },
  ] },
  selforg: { t: 'Self-organizing', rows: [
    { k: 'soIters',   label: 'Growth cycles', min: 4,   max: 28,  step: 1, int: true,
      tip: 'How many seasons of growth to simulate. Each cycle, buds compete for light and the best-lit ones extend. More = a bigger, more developed tree (heavier to build).' },
    { k: 'soLambda',  label: 'Apical control', min: 0.5, max: 0.62, step: 0.005,
      tip: 'Borchert–Honda dominance. Higher pours growth into the leading shoot for a tall, central-leader tree; lower spreads it evenly for a rounder, bushier crown.' },
    { k: 'soAngle',   label: 'Branch angle',  min: 0.4, max: 1.4,  step: 0.02,
      tip: 'How far new side branches splay off their parent. Wider = a more spreading, open habit.' },
    { k: 'soTropism', label: 'Upward pull',   min: 0,   max: 0.7,  step: 0.02,
      tip: 'Phototropism — how strongly shoots bend back toward vertical as they grow. Higher = more upright; 0 = lets branches wander.' },
  ] },
}
const COLORS = [
  { k: 'bgTop',     label: 'Sky top',    tip: 'Top of the background sky gradient.' },
  { k: 'bgBottom',  label: 'Sky bottom', tip: 'Bottom of the background sky gradient.' },
  { k: 'bark',      label: 'Bark',       tip: 'Trunk / lower-branch color.' },
  { k: 'barkLight', label: 'Bark tip',   tip: 'Branch-tip color; bark blends from Bark → Bark tip with depth.' },
  { k: 'leaf',      label: 'Leaf',       tip: 'Base leaf color.' },
  { k: 'leafLight', label: 'Leaf light', tip: 'Lighter leaf color; leaves vary between Leaf and Leaf light.' },
  { k: 'blossom',   label: 'Blossom',    tip: 'Color of the bright blossom dots (when Blossoms is on).' },
]
const FEATURE_TIPS = {
  leaves:   'Show the leaves at all.',
  blossoms: 'Render a few leaves as bright blossom dots instead of green.',
  wind:     'Animate the sway. Off = frozen tree.',
  ground:   'Draw the soft shadow at the base of the trunk.',
  sky:      'Fill the background with the sky gradient. Off = transparent, so the app shows through — this is what the ambient background uses.',
}
const QUALITY_TIP = 'Render detail vs. performance: lower renders fewer pixels and caps the frame rate (smoother on weak hardware).'
const QUALITIES = ['ultra', 'high', 'medium', 'low', 'potato']
const SIDEBAR_W = 260

// tiny hover-help badge (native tooltip → never clipped by the scrolling panel)
function Tip({ text }) {
  return (
    <span title={text} style={{ cursor: 'help', color: 'var(--text-tertiary,#666)', fontSize: 8, marginLeft: 5,
      border: '1px solid var(--border-color,#333)', borderRadius: '50%', width: 12, height: 12,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 700 }}>?</span>
  )
}

export default function GrovekeeperPage() {
  const { showToast } = useToast()
  const canvasRef = useRef(null)
  const trRef = useRef(null)
  const scrubbingRef = useRef(false)
  const [presets, setPresets] = useState([])
  const [sel, setSel] = useState('b:spring')
  const [algo, setAlgo] = useState(PRESETS.spring.params.algorithm || 'recursive')
  const [qual, setQual] = useState(PRESETS.spring.quality)
  const [, force] = useState(0)
  const [saveName, setSaveName] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [prog, setProg] = useState(0)   // growth readout for the scrub bar
  const [immersive, setImmersiveState] = useState(false)  // hide ALL thrive chrome

  // Immersive mode hides the top nav (via App's Shell) plus this page's own
  // panel + grip + scrub bar, leaving only the canvas — clean for F11. Esc exits.
  const setImmersive = (on) => {
    setImmersiveState(on)
    window.dispatchEvent(new CustomEvent('thrive:immersive', { detail: on }))
  }
  // restore thrive's chrome whenever we leave the page
  useEffect(() => () => window.dispatchEvent(new CustomEvent('thrive:immersive', { detail: false })), [])

  // create the renderer once
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const tr = new TreeRenderer(canvas, { ...PRESETS.spring.params }, {
      quality: PRESETS.spring.quality, respectReducedMotion: false,
      toggles: { ...PRESETS.spring.toggles },
    })
    trRef.current = tr
    tr.start()
    const onResize = () => tr.resize()
    window.addEventListener('resize', onResize)

    // wheel zooms the camera in/out (camDist), exponential so each notch feels even
    const onWheel = (e) => {
      e.preventDefault()
      const next = Math.min(9, Math.max(2, tr.params.camDist * Math.exp(e.deltaY * 0.0012)))
      tr.setParams({ camDist: next }); force(n => n + 1)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })

    // drag orbits (camAzimuth) and tilts (camElevation)
    let dragging = false, lx = 0, ly = 0
    const down = (e) => { dragging = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture?.(e.pointerId) }
    const move = (e) => {
      if (!dragging) return
      const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY
      tr.setParams({
        camAzimuth: tr.params.camAzimuth - dx * 0.01,
        camElevation: Math.min(1.2, Math.max(-0.3, tr.params.camElevation + dy * 0.01)),
      })
      force(n => n + 1)
    }
    const up = () => { dragging = false }
    canvas.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)

    // keep the scrub bar in sync with the auto-growing renderer
    const poll = setInterval(() => { if (!scrubbingRef.current) setProg(tr.progress) }, 120)

    return () => {
      window.removeEventListener('resize', onResize)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      clearInterval(poll)
      tr.destroy(); trRef.current = null
    }
  }, [])

  const loadPresets = () => api.get('/grovekeeper/presets/').then(setPresets).catch(() => {})
  useEffect(() => { loadPresets() }, [])

  // H toggles the panel, Esc hides it — ignored while typing in a field
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (e.key === 'h' || e.key === 'H') setCollapsed(c => !c)
      else if (e.key === 'Escape') { if (immersive) setImmersive(false); else setCollapsed(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [immersive])

  // apply a {toggles, params, quality} blob to the live renderer
  const apply = (data) => {
    const tr = trRef.current
    if (!tr || !data) return
    if (data.params)  { tr.setParams({ ...data.params }); setAlgo(tr.params.algorithm || 'recursive') }
    if (data.quality && typeof data.quality === 'string') { tr.setQuality(data.quality); setQual(data.quality) }
    if (data.toggles) tr.setToggles({ ...DEFAULT_TOGGLES, ...data.toggles })
    force(n => n + 1)
  }

  const allOptions = [...BUILTINS, ...presets.map(p => ({ key: `db:${p.id}`, name: p.name, data: p.data, id: p.id }))]
  const current = allOptions.find(o => o.key === sel)

  const onSelect = (key) => {
    setSel(key)
    const opt = allOptions.find(o => o.key === key)
    if (opt) { apply(opt.data); trRef.current?.replay(); setProg(0) }   // watch the new look grow
  }

  const snapshot = () => {
    const tr = trRef.current
    return { toggles: { ...tr.toggles }, params: { ...tr.params }, quality: qual }
  }

  const saveNew = async () => {
    const name = saveName.trim()
    if (!name) { showToast('Enter a preset name', 'error'); return }
    try {
      const saved = await api.post('/grovekeeper/presets/', { name, data: snapshot() })
      setSaveName('')
      await loadPresets()
      setSel(`db:${saved.id}`)
      showToast(`Saved '${name}'`, 'success')
    } catch (e) { showToast(e.message, 'error') }
  }

  const del = async () => {
    if (!current || !current.id) return
    try {
      await api.del(`/grovekeeper/presets/${current.id}`)
      await loadPresets()
      setSel('b:spring'); apply(PRESETS.spring)
      showToast('Deleted', 'success')
    } catch (e) { showToast(e.message, 'error') }
  }

  // mark the current look as the unified ambient background (per device)
  const setAsBackground = () => {
    try {
      localStorage.setItem('thrive:ambient', JSON.stringify({ module: 'grovekeeper', cfg: snapshot() }))
      window.dispatchEvent(new CustomEvent('thrive:ambient-changed'))
      showToast('Set as background', 'success')
    } catch { showToast('Could not save', 'error') }
  }

  const tr = trRef.current
  const getParam = (k) => !tr ? 0 : tr.params[k]
  const setParam = (k, v) => { tr && tr.setParams({ [k]: v }); force(n => n + 1) }
  const setQuality = (q) => { tr && tr.setQuality(q); setQual(q); force(n => n + 1) }
  const toggleFeat = (f, on) => { tr && tr.setToggles({ [f]: on }); force(n => n + 1) }

  const onScrubInput = (v) => { scrubbingRef.current = true; setProg(v); tr && tr.scrubTo(v) }
  const onScrubDone  = (v) => { scrubbingRef.current = false; tr && tr.replay(v) }

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />

      {/* growth scrub — bottom center, like the standalone demo (hidden when immersive) */}
      {!immersive && <div style={{ position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 12,
        display: 'flex', alignItems: 'center', gap: 12, ...panel, padding: '8px 14px', borderRadius: 999 }}>
        <button style={btnS} onClick={() => { tr && tr.replay(); setProg(0) }}>↻ replay</button>
        <input type="range" min={0} max={1} step={0.001} value={prog}
          onChange={e => onScrubInput(+e.target.value)}
          onMouseUp={e => onScrubDone(+e.target.value)} onTouchEnd={e => onScrubDone(prog)}
          style={{ width: 160, accentColor: ACCENT, cursor: 'pointer' }} />
        <span style={{ width: 38, textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: 'var(--text-tertiary,#888)' }}>{Math.round(prog * 100)}%</span>
      </div>}

      {/* collapse grip — hidden in immersive mode */}
      {!immersive && <button onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Show panel (H)' : 'Hide panel (H)'}
        style={{
          position: 'absolute', top: 48, bottom: 0, right: collapsed ? 0 : SIDEBAR_W, width: 18, zIndex: 11,
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 0, padding: 0,
          border: 'none', borderLeft: '1px solid var(--border-color,#2a2a2a)', borderRadius: 0,
          background: PANEL_BG, backdropFilter: 'blur(6px)', color: 'var(--text-tertiary,#888)',
          cursor: 'pointer', fontSize: 15, transition: 'right .15s',
        }}>
        {collapsed ? '‹' : '›'}
      </button>}

      {!collapsed && !immersive && (
      <div style={{ position: 'absolute', top: 48, right: 0, bottom: 0, width: SIDEBAR_W, ...panel, border: 'none', borderLeft: '1px solid var(--border-color,#2a2a2a)', borderRadius: 0, overflowY: 'auto', zIndex: 10 }}>
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-tertiary,#888)' }}>Grovekeeper</span>
        </div>

        {/* hide all of thrive's chrome (top nav + panel + scrub) for a clean canvas;
            pair with F11 for true fullscreen. Esc brings it all back. */}
        <button style={{ ...btnS, width: '100%', marginBottom: 12 }}
          onClick={() => { setImmersive(true); showToast('UI hidden — press Esc to bring it back', 'success') }}>
          ⛶ Hide UI
        </button>

        <div style={{ marginBottom: 12 }}>
          <div style={lbl}>Preset</div>
          <select style={inp} value={sel} onChange={e => onSelect(e.target.value)}>
            <optgroup label="Built-in">
              {BUILTINS.map(o => <option key={o.key} value={o.key}>{o.name}</option>)}
            </optgroup>
            {presets.length > 0 && (
              <optgroup label="Saved">
                {presets.map(p => <option key={p.id} value={`db:${p.id}`}>{p.name}</option>)}
              </optgroup>
            )}
          </select>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button style={{ ...btnS, flex: 1 }} onClick={setAsBackground}>Set as bg</button>
            {current && current.id && <button style={{ ...btnS, color: 'var(--color-danger,#ef4444)' }} onClick={del}>Delete</button>}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ ...lbl, display: 'flex', alignItems: 'center' }}>Algorithm<Tip text="Which model generates the tree skeleton. Recursive = the classic fractal; Space colonization = self-organizing buds competing for light/space; L-system = rule-based rewriting. Each has its own controls below." /></div>
          <select style={inp} value={algo} onChange={e => { const v = e.target.value; setAlgo(v); trRef.current?.setParams({ algorithm: v }); force(n => n + 1) }}>
            {ALGORITHM_LIST.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        {tr && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={{ ...lbl, display: 'flex', alignItems: 'center' }}>Quality<Tip text={QUALITY_TIP} /></div>
              <select style={inp} value={qual} onChange={e => setQuality(e.target.value)}>
                {QUALITIES.map(q => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border-color,#2a2a2a)' }}>
              {FEATURES.map(f => (
                <label key={f} title={FEATURE_TIPS[f]} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'capitalize', cursor: 'pointer' }}>
                  <input type="checkbox" checked={tr.toggles[f]} onChange={e => toggleFeat(f, e.target.checked)} style={{ accentColor: ACCENT }} /> {f}
                </label>
              ))}
            </div>

            {[...CORE_GROUPS, ALGO_GROUPS[algo]].filter(Boolean).map(g => (
              <div key={g.t} style={{ marginBottom: 10 }}>
                <div style={{ ...lbl, color: ACCENT }}>{g.t}</div>
                {g.rows.map(s => (
                  <div key={s.k} style={{ marginBottom: 8 }}>
                    <div style={{ ...lbl, display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center' }}>{s.label}<Tip text={s.tip} /></span><b style={{ color: 'var(--text-secondary,#aaa)' }}>{s.int ? Math.round(getParam(s.k)) : (+getParam(s.k)).toFixed(2)}</b>
                    </div>
                    <input type="range" min={s.min} max={s.max} step={s.step} value={getParam(s.k)}
                      onChange={e => setParam(s.k, s.int ? Math.round(+e.target.value) : +e.target.value)} style={{ width: '100%', accentColor: ACCENT }} />
                  </div>
                ))}
              </div>
            ))}

            {/* colors */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ ...lbl, color: ACCENT }}>Colors</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px' }}>
                {COLORS.map(c => (
                  <label key={c.k} title={c.tip} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-tertiary,#888)', cursor: 'help' }}>
                    <input type="color" value={getParam(c.k)} onChange={e => setParam(c.k, e.target.value)}
                      style={{ width: 22, height: 22, padding: 0, border: '1px solid var(--border-color,#333)', borderRadius: 4, background: 'none', cursor: 'pointer' }} />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        <div style={{ paddingTop: 10, borderTop: '1px solid var(--border-color,#2a2a2a)' }}>
          <div style={lbl}>Save current as…</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input style={inp} placeholder="preset name" value={saveName}
              onChange={e => setSaveName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveNew()} />
            <button style={btnP} onClick={saveNew}>Save</button>
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
