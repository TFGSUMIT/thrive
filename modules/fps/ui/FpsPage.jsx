// =============================================================================
// FpsPage.jsx — the FPS Meter module's page (/fps)
// A live frame-rate readout + the per-device opt-in toggle for the top badge.
// =============================================================================
import { useState, useEffect, useRef } from 'react'
import { FPS_KEY, fpsEnabled } from './FpsOverlay'

const ACCENT = '#22c55e'   // module color

export default function FpsPage() {
  const [fps, setFps]   = useState(0)
  const [lo, setLo]     = useState(null)
  const [hi, setHi]     = useState(null)
  const [on, setOn]     = useState(fpsEnabled)
  const hist = useRef([])   // recent samples for the sparkline

  // live sampler (always runs while this page is open)
  useEffect(() => {
    let frames = 0, last = performance.now(), id
    const tick = (now) => {
      frames++
      if (now - last >= 500) {
        const v = Math.round((frames * 1000) / (now - last))
        setFps(v)
        setLo(p => (p == null ? v : Math.min(p, v)))
        setHi(p => (p == null ? v : Math.max(p, v)))
        hist.current = [...hist.current.slice(-79), v]
        frames = 0; last = now
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    const sync = () => setOn(fpsEnabled())
    window.addEventListener('thrive:fps-changed', sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener('thrive:fps-changed', sync); window.removeEventListener('storage', sync) }
  }, [])

  const toggle = (v) => {
    setOn(v)
    try { localStorage.setItem(FPS_KEY, v ? '1' : '0') } catch {}
    window.dispatchEvent(new Event('thrive:fps-changed'))
  }

  const color = fps >= 50 ? 'var(--color-success,#22c55e)'
              : fps >= 25 ? 'var(--color-warning,#f59e0b)'
              :             'var(--color-danger,#ef4444)'

  const samples = hist.current
  const max = Math.max(60, ...samples)

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px' }}>
      <h1 style={{ fontSize: 14, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>📈 FPS Meter</h1>
      <p style={{ fontSize: 12, color: 'var(--text-tertiary,#888)', marginTop: 4, marginBottom: 28 }}>
        Live frame-rate of this screen — useful for tuning a heavy ambient on weak hardware.
      </p>

      {/* big live number */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 72, lineHeight: 1, fontWeight: 700, color }}>{fps}</span>
        <span style={{ fontSize: 16, color: 'var(--text-tertiary,#888)', letterSpacing: '0.1em' }}>fps</span>
      </div>
      <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-tertiary,#666)', marginBottom: 24 }}>
        min {lo ?? '—'} · max {hi ?? '—'}
      </div>

      {/* sparkline */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 72, marginBottom: 28,
        padding: 8, background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 8 }}>
        {samples.length === 0
          ? <span style={{ fontSize: 11, color: 'var(--text-tertiary,#666)', alignSelf: 'center' }}>sampling…</span>
          : samples.map((v, i) => (
            <div key={i} title={`${v} fps`} style={{
              flex: 1, minWidth: 2, height: `${Math.max(2, (v / max) * 100)}%`, borderRadius: 1,
              background: v >= 50 ? 'var(--color-success,#22c55e)' : v >= 25 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger,#ef4444)',
            }} />
          ))}
      </div>

      {/* per-device badge toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: 16, background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 8 }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-primary,#e8e6e0)' }}>Show badge on every screen</div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', marginTop: 2 }}>
            Tiny top-center readout. Off by default — turn on to keep it visible. Per device.
          </div>
        </div>
        <button onClick={() => toggle(!on)} aria-pressed={on}
          style={{ flexShrink: 0, width: 42, height: 24, borderRadius: 999, cursor: 'pointer', position: 'relative',
            border: '1px solid var(--border-color,#2a2a2a)', padding: 0,
            background: on ? ACCENT : 'var(--bg-tertiary,#222)', transition: 'background 0.15s' }}>
          <span style={{ position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: '50%',
            background: '#fff', transition: 'left 0.15s' }} />
        </button>
      </div>
    </div>
  )
}
