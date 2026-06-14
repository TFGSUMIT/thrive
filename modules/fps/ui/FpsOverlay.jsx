// =============================================================================
// FpsOverlay.jsx — the FPS Meter module's always-on HUD badge
//
// Rendered by core as a module Overlay (see ui/index.jsx) whenever the module is
// installed+enabled. Measures requestAnimationFrame cadence and paints a small
// fixed badge at the TOP-CENTER, colour-coded so a choking ambient (e.g. the
// blackhole on a Pi) is obvious at a glance.
//
// Show/hide is a PER-DEVICE preference (localStorage `thrive:fps`) — a property
// of this screen/kiosk, not the account — toggled in the module's settings panel.
// Default ON: enabling the module shows the badge until this device hides it.
// =============================================================================
import { useState, useEffect } from 'react'

export const FPS_KEY = 'thrive:fps'
export const fpsEnabled = () => { try { return localStorage.getItem(FPS_KEY) !== '0' } catch { return true } }

export default function FpsOverlay() {
  const [on, setOn]   = useState(fpsEnabled)
  const [fps, setFps] = useState(0)

  // react to the settings toggle live (same tab via our event; other tabs via storage)
  useEffect(() => {
    const sync = () => setOn(fpsEnabled())
    window.addEventListener('thrive:fps-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('thrive:fps-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  // sampler — only runs while shown; recomputes ~twice a second
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
  const c = fps >= 50 ? 'var(--color-success,#22c55e)'
          : fps >= 25 ? 'var(--color-warning,#f59e0b)'
          :             'var(--color-danger,#ef4444)'
  return (
    <div style={{
      position: 'fixed', top: 6, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, pointerEvents: 'none',
      fontFamily: 'var(--font-mono,monospace)', fontSize: 11, lineHeight: 1, letterSpacing: '0.04em',
      padding: '4px 8px', borderRadius: 6, opacity: 0.9,
      background: 'var(--bg-secondary,#181818)', border: `1px solid ${c}`, color: c,
    }}>
      {fps} fps
    </div>
  )
}
