// =============================================================================
// FpsPanel.jsx — the FPS Meter module's Settings panel
// A per-device show/hide toggle for the top-center FPS badge (localStorage
// `thrive:fps`). Appears under Settings while the module is active.
// =============================================================================
import { useState, useEffect } from 'react'
import { FPS_KEY, fpsEnabled } from './FpsOverlay'

export default function FpsPanel() {
  const [on, setOn] = useState(fpsEnabled)

  useEffect(() => {
    const sync = () => setOn(fpsEnabled())
    window.addEventListener('thrive:fps-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('thrive:fps-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const toggle = (v) => {
    setOn(v)
    try { localStorage.setItem(FPS_KEY, v ? '1' : '0') } catch {}
    window.dispatchEvent(new Event('thrive:fps-changed'))
  }

  return (
    <div style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-primary,#e8e6e0)' }}>Show FPS badge</div>
        <div style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', marginTop: 2 }}>
          Frame-rate readout, top-center. Off by default — turn it on when checking a heavy ambient on weak hardware. Per device.
        </div>
      </div>
      {/* compact pill toggle (self-contained — no core Switch dependency) */}
      <button onClick={() => toggle(!on)} aria-pressed={on}
        style={{
          flexShrink: 0, width: 42, height: 24, borderRadius: 999, cursor: 'pointer', position: 'relative',
          border: '1px solid var(--border-color,#2a2a2a)', padding: 0,
          background: on ? 'var(--color-success,#22c55e)' : 'var(--bg-tertiary,#222)',
          transition: 'background 0.15s',
        }}>
        <span style={{
          position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: '50%',
          background: '#fff', transition: 'left 0.15s',
        }} />
      </button>
    </div>
  )
}
