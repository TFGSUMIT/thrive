// =============================================================================
// FpsMeter.jsx — tiny always-available frame-rate readout
// Toggled in Settings → UI ("FPS counter"). A per-device preference
// (localStorage `thrive:fps`), like the ambient/opacity settings — it's a
// property of THIS screen/kiosk, not the account. Measures requestAnimationFrame
// cadence and paints a small fixed corner badge, colour-coded so a choking
// ambient (e.g. the blackhole on a Pi) is obvious at a glance.
// =============================================================================
import { useState, useEffect } from 'react'

export const FPS_KEY = 'thrive:fps'
export const fpsEnabled = () => { try { return localStorage.getItem(FPS_KEY) === '1' } catch { return false } }

export default function FpsMeter() {
  const [on, setOn]   = useState(fpsEnabled)
  const [fps, setFps] = useState(0)

  // react to the Settings toggle live (same tab via our event; other tabs via storage)
  useEffect(() => {
    const sync = () => setOn(fpsEnabled())
    window.addEventListener('thrive:fps-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('thrive:fps-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  // sampler — only runs while enabled; recomputes ~twice a second
  useEffect(() => {
    if (!on) return
    let frames = 0, last = performance.now(), id
    const tick = (now) => {
      frames++
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)))
        frames = 0; last = now
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [on])

  if (!on) return null
  const c = fps >= 50 ? 'var(--color-success)' : fps >= 25 ? 'var(--color-warning)' : 'var(--color-danger)'
  return (
    <div style={{
      position: 'fixed', bottom: 8, right: 8, zIndex: 9999, pointerEvents: 'none',
      fontFamily: 'var(--font-mono,monospace)', fontSize: 11, lineHeight: 1, letterSpacing: '0.04em',
      padding: '4px 7px', borderRadius: 6, opacity: 0.9,
      background: 'var(--bg-secondary,#181818)', border: `1px solid ${c}`, color: c,
    }}>
      {fps} fps
    </div>
  )
}
