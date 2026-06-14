// =============================================================================
// BlackHolePage.jsx — full-screen interactive black hole + preset manager
// thrive UI — reached via the 🕳️ nav icon (/blackhole)
//
// Full-quality interactive view of the shared blackhole-lensing renderer with a
// preset dropdown (library built-ins + user presets from the DB), a few live
// controls, save/delete, "set as background", and a way back to thrive.
// =============================================================================
import { useEffect, useRef, useState } from 'react'
import { api } from '@core/api'
import { useToast } from '@core/context/ToastContext'
import { BlackHoleRenderer, PRESETS, DEFAULT_PARAMS, DEFAULT_TOGGLES, FEATURES } from 'blackhole-lensing/src/index.js'

// "Set as background" writes the unified ambient picker (per device); only one
// module's renderer ever paints behind the UI — see AmbientBackground in App.jsx.

// library built-ins, surfaced in the dropdown alongside DB presets
const BUILTINS = [
  { key: 'b:artwall',      name: 'Interstellar (built-in)', data: { ...PRESETS.artwall } },
  { key: 'b:thriveSubtle', name: 'Subtle (built-in)',       data: { ...PRESETS.thriveSubtle } },
]

// panel/grip backgrounds scale with the global UI opacity (Settings → UI) so the
// black hole shows through them at lower opacity, just like the rest of the UI.
const PANEL_BG = 'rgba(14,18,24, calc(0.92 * var(--ui-alpha, 1)))'
const panel = { background: PANEL_BG, border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, padding: 14, backdropFilter: 'blur(6px)' }
const btnS  = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '6px 10px' }
const btnP  = { ...btnS, background: 'var(--text-primary,#e8e6e0)', color: 'var(--bg-primary,#0f0f0f)', border: 'none', fontWeight: 600 }
const inp   = { fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '6px 8px', width: '100%', boxSizing: 'border-box' }
const lbl   = { fontSize: 10, color: 'var(--text-tertiary,#666)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }

// full in-app tuner — mirrors the standalone demo's controls
const GROUPS = [
  { t: 'Camera', rows: [
    { k: 'camDist',     label: 'Distance',  min: 8,    max: 200, step: 0.5,
      tip: 'How far the camera sits from the black hole. The mouse wheel zooms this too.' },
    { k: 'inclination', label: 'Tilt',      min: 0,    max: 1.4, step: 0.005,
      tip: 'Camera tilt relative to the disk. 0 = edge-on (the disk looks like a line); higher looks down onto it.' },
    { k: 'fov',         label: 'Zoom',      min: 0.4,  max: 2.5, step: 0.01,
      tip: 'Field of view. Lower = zoomed-in / telephoto; higher = wide angle.' },
    { k: 'offsetX',     label: 'Offset X',  min: -0.5, max: 0.5, step: 0.01,
      tip: 'Shifts the hole left/right in the frame (useful for tucking it into a corner).' },
    { k: 'offsetY',     label: 'Offset Y',  min: -0.5, max: 0.5, step: 0.01,
      tip: 'Shifts the hole up/down in the frame.' },
  ] },
  { t: 'Black hole / disk', rows: [
    { k: 'horizon',     label: 'Shadow radius', min: 0.4, max: 2.5, step: 0.05,
      tip: 'Size of the black shadow — the silhouette of the event horizon.' },
    { k: 'diskInner',   label: 'Disk inner',    min: 1.5, max: 8,   step: 0.1,
      tip: 'Inner edge of the glowing accretion disk — how close the gas starts to the hole.' },
    { k: 'diskOuter',   label: 'Disk outer',    min: 5,   max: 20,  step: 0.1,
      tip: 'Outer edge of the disk — how far the ring of gas extends.' },
  ] },
  { t: 'Look', rows: [
    { k: 'palette',       label: 'Palette',  min: 0, max: 1,   step: 0.01,
      tip: 'Color scheme, blended 0→1 (NASA red/orange ↔ Interstellar white-gold).' },
    { k: 'intensity',     label: 'Intensity',min: 0, max: 3,   step: 0.01,
      tip: 'Overall brightness of the disk and glow.' },
    { k: 'beaming',       label: 'Beaming',  min: 0, max: 1.5, step: 0.01,
      tip: 'Relativistic Doppler beaming — how much brighter the side of the disk spinning toward you gets.' },
    { k: 'rotationSpeed', label: 'Rotation', min: 0, max: 4,   step: 0.01,
      tip: 'How fast the disk visibly spins.' },
  ] },
  { t: 'Atmosphere', rows: [
    { k: 'stars',  label: 'Stars',  min: 0, max: 2, step: 0.01,
      tip: 'Brightness / amount of the background starfield.' },
    { k: 'nebula', label: 'Nebula', min: 0, max: 2, step: 0.01,
      tip: 'Amount of colored nebula haze behind the hole.' },
    { k: 'glow',   label: 'Bloom',  min: 0, max: 2, step: 0.01,
      tip: 'Soft bloom/glow spread around the bright parts of the disk.' },
  ] },
]
const FEATURE_TIPS = {
  disk:    'The glowing accretion disk of gas orbiting the hole.',
  beaming: 'Doppler brightness asymmetry on the disk (needs the disk on).',
  stars:   'Background starfield.',
  nebula:  'Colored nebula haze behind the scene.',
  glow:    'Bloom / glow post-effect around bright areas.',
}
const QUALITY_TIP = 'Render detail vs. performance: lower uses fewer ray steps + fewer pixels + a capped frame rate (smoother on weak hardware).'
const QUALITIES = ['auto', 'ultra', 'high', 'medium', 'low', 'potato', 'min']

const SIDEBAR_W = 260

// tiny hover-help badge (native tooltip → never clipped by the scrolling panel)
function Tip({ text }) {
  return (
    <span title={text} style={{ cursor: 'help', color: 'var(--text-tertiary,#666)', fontSize: 8, marginLeft: 5,
      border: '1px solid var(--border-color,#333)', borderRadius: '50%', width: 12, height: 12,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 700 }}>?</span>
  )
}

export default function BlackHolePage() {
  const { showToast } = useToast()
  const canvasRef = useRef(null)
  const bhRef = useRef(null)
  const [presets, setPresets] = useState([])         // DB presets
  const [sel, setSel] = useState('b:artwall')        // selected dropdown key
  const [qual, setQual] = useState('auto')           // default: self-tune (smooth on weak GPUs; pick ultra manually for full detail)
  const [, force] = useState(0)                       // re-render for slider readouts
  const [saveName, setSaveName] = useState('')
  const [collapsed, setCollapsed] = useState(false)  // popout panel state
  const [immersive, setImmersiveState] = useState(false)  // hide ALL thrive chrome

  // Immersive mode hides the top nav (via App's Shell) plus this page's own
  // panel + grip, leaving only the canvas — clean for F11 fullscreen. Esc exits.
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
    const bh = new BlackHoleRenderer(canvas, { ...PRESETS.artwall.params }, {
      quality: 'auto', respectReducedMotion: false,
      toggles: { ...PRESETS.artwall.toggles },
    })
    bhRef.current = bh
    bh.start()
    const onResize = () => bh.resize()
    window.addEventListener('resize', onResize)

    // mouse wheel zooms the camera in/out (camDist). Exponential so each notch
    // feels even across the range; clamped to the Distance slider's bounds.
    const onWheel = (e) => {
      e.preventDefault()
      const next = Math.min(200, Math.max(8, bh.params.camDist * Math.exp(e.deltaY * 0.0015)))
      bh.setParams({ camDist: next })
      force(n => n + 1)   // keep the Distance readout/slider in sync
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      window.removeEventListener('resize', onResize)
      canvas.removeEventListener('wheel', onWheel)
      bh.destroy(); bhRef.current = null
    }
  }, [])

  const loadPresets = () => api.get('/blackhole/presets/').then(setPresets).catch(() => {})
  useEffect(() => { loadPresets() }, [])

  // H toggles the panel, Esc hides it (matches the standalone demo) — ignored
  // while typing in a field so the save-name input isn't hijacked.
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
    const bh = bhRef.current
    if (!bh || !data) return
    if (data.params)  bh.setParams({ ...data.params })
    if (data.quality && typeof data.quality === 'string') { bh.setQuality(data.quality); setQual(data.quality) }
    if (data.toggles) bh.setToggles({ ...DEFAULT_TOGGLES, ...data.toggles })
    force(n => n + 1)
  }

  const allOptions = [...BUILTINS, ...presets.map(p => ({ key: `db:${p.id}`, name: p.name, data: p.data, id: p.id }))]
  const current = allOptions.find(o => o.key === sel)

  const onSelect = (key) => {
    setSel(key)
    const opt = allOptions.find(o => o.key === key)
    if (opt) apply(opt.data)
  }

  // current renderer state as a serializable preset blob (quality as a name)
  const snapshot = () => {
    const bh = bhRef.current
    return { toggles: { ...bh.toggles }, params: { ...bh.params }, quality: qual }
  }

  const saveNew = async () => {
    const name = saveName.trim()
    if (!name) { showToast('Enter a preset name', 'error'); return }
    try {
      const saved = await api.post('/blackhole/presets/', { name, data: snapshot() })
      setSaveName('')
      await loadPresets()
      setSel(`db:${saved.id}`)
      showToast(`Saved '${name}'`, 'success')
    } catch (e) { showToast(e.message, 'error') }
  }

  const del = async () => {
    if (!current || !current.id) return
    try {
      await api.del(`/blackhole/presets/${current.id}`)
      await loadPresets()
      setSel('b:artwall'); apply(PRESETS.artwall)
      showToast('Deleted', 'success')
    } catch (e) { showToast(e.message, 'error') }
  }

  // mark the selected look as the unified ambient background (per device)
  const setAsBackground = () => {
    try {
      localStorage.setItem('thrive:ambient', JSON.stringify({ module: 'blackhole', cfg: snapshot() }))
      window.dispatchEvent(new CustomEvent('thrive:ambient-changed'))
      showToast('Set as background', 'success')
    } catch { showToast('Could not save', 'error') }
  }

  const bh = bhRef.current
  const getParam = (k) => !bh ? 0 : k === 'offsetX' ? bh.params.offset[0] : k === 'offsetY' ? bh.params.offset[1] : bh.params[k]
  const setParam = (k, v) => {
    if (!bh) return
    if (k === 'offsetX') bh.params.offset[0] = v
    else if (k === 'offsetY') bh.params.offset[1] = v
    else bh.setParams({ [k]: v })
    force(n => n + 1)
  }
  const setQuality = (q) => { bh && bh.setQuality(q); setQual(q); force(n => n + 1) }
  const toggleFeat = (f, on) => { bh && bh.setToggles({ [f]: on }); force(n => n + 1) }

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      {/* canvas fills the whole viewport — including behind the (translucent) top
          nav — so lowering UI opacity lets the black hole show through the bar too */}
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />

      {/* slim full-height grip on the panel divider — click to collapse, and (at
          the screen edge when collapsed) to pull the panel back out. H / Esc too.
          Hidden entirely in immersive mode. */}
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

      {/* control panel — docked right, full height, collapses behind the grip;
          hidden in immersive mode (Esc to bring all of thrive back) */}
      {!collapsed && !immersive && (
      <div style={{ position: 'absolute', top: 48, right: 0, bottom: 0, width: SIDEBAR_W, ...panel, border: 'none', borderLeft: '1px solid var(--border-color,#2a2a2a)', borderRadius: 0, overflowY: 'auto', zIndex: 10 }}>
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-tertiary,#888)' }}>Black Hole</span>
        </div>

        {/* hide all of thrive's chrome (top nav + this panel) for a clean canvas;
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

        {bh && (
          <>
            {/* quality */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ ...lbl, display: 'flex', alignItems: 'center' }}>Quality<Tip text={QUALITY_TIP} /></div>
              <select style={inp} value={qual} onChange={e => setQuality(e.target.value)}>
                {QUALITIES.map(q => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>

            {/* feature toggles */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border-color,#2a2a2a)' }}>
              {FEATURES.map(f => (
                <label key={f} title={FEATURE_TIPS[f]} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'capitalize', cursor: 'pointer' }}>
                  <input type="checkbox" checked={bh.toggles[f]} onChange={e => toggleFeat(f, e.target.checked)} style={{ accentColor: '#8b5cf6' }} /> {f}
                </label>
              ))}
            </div>

            {/* all param sliders, grouped */}
            {GROUPS.map(g => (
              <div key={g.t} style={{ marginBottom: 10 }}>
                <div style={{ ...lbl, color: '#8b5cf6' }}>{g.t}</div>
                {g.rows.map(s => (
                  <div key={s.k} style={{ marginBottom: 8 }}>
                    <div style={{ ...lbl, display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center' }}>{s.label}<Tip text={s.tip} /></span><b style={{ color: 'var(--text-secondary,#aaa)' }}>{(+getParam(s.k)).toFixed(2)}</b>
                    </div>
                    <input type="range" min={s.min} max={s.max} step={s.step} value={getParam(s.k)}
                      onChange={e => setParam(s.k, +e.target.value)} style={{ width: '100%', accentColor: '#8b5cf6' }} />
                  </div>
                ))}
              </div>
            ))}
          </>
        )}

        {/* save current as a new preset */}
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
