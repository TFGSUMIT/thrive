// =============================================================================
// ClockPage — a full-screen clock (#16). Reached by tapping the top-bar clock.
// Analog or digital, with a few basic options, persisted per-device.
// =============================================================================
import { useState, useEffect } from 'react'

const KEY = 'thrive:clock'
const DEFAULTS = { mode: 'digital', seconds: true, hour24: false, date: true }
const loadPrefs = () => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) } }
  catch { return { ...DEFAULTS } }
}

function Analog({ now, seconds }) {
  const s = now.getSeconds(), m = now.getMinutes(), h = now.getHours() % 12
  const ang = { hr: h * 30 + m * 0.5, min: m * 6 + s * 0.1, sec: s * 6 }
  const hand = (a, len, w, color) => (
    <line x1="100" y1="100"
      x2={100 + len * Math.sin(a * Math.PI / 180)}
      y2={100 - len * Math.cos(a * Math.PI / 180)}
      stroke={color} strokeWidth={w} strokeLinecap="round" />
  )
  return (
    <svg viewBox="0 0 200 200" style={{ width: 'min(64vw, 60vh)', height: 'min(64vw, 60vh)' }}>
      <circle cx="100" cy="100" r="96" fill="none" stroke="var(--border-color,#2a2a2a)" strokeWidth="2" />
      {[...Array(12)].map((_, i) => {
        const a = i * 30 * Math.PI / 180
        const big = i % 3 === 0
        return <line key={i}
          x1={100 + (big ? 84 : 88) * Math.sin(a)} y1={100 - (big ? 84 : 88) * Math.cos(a)}
          x2={100 + 96 * Math.sin(a)} y2={100 - 96 * Math.cos(a)}
          stroke="var(--text-tertiary,#666)" strokeWidth={big ? 3 : 1.5} />
      })}
      {hand(ang.hr, 50, 4.5, 'var(--text-primary,#e8e6e0)')}
      {hand(ang.min, 74, 3, 'var(--text-primary,#e8e6e0)')}
      {seconds && hand(ang.sec, 82, 1.5, 'var(--accent,#3b82f6)')}
      <circle cx="100" cy="100" r="4" fill="var(--accent,#3b82f6)" />
    </svg>
  )
}

export default function ClockPage() {
  const [now, setNow] = useState(() => new Date())
  const [p, setP] = useState(loadPrefs)
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const set = (patch) => {
    const np = { ...p, ...patch }
    setP(np)
    try { localStorage.setItem(KEY, JSON.stringify(np)) } catch {}
  }

  const h24 = now.getHours()
  const hh = p.hour24 ? String(h24).padStart(2, '0') : String(h24 % 12 || 12)
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const digits = p.seconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`
  const ampm = p.hour24 ? null : (h24 < 12 ? 'AM' : 'PM')
  const date = now.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  const wrap = { minHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28, padding: 20 }
  const chip = (on) => ({
    fontFamily: 'var(--font-mono,monospace)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em',
    padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${on ? 'var(--accent,#3b82f6)' : 'var(--border-color,#2a2a2a)'}`,
    background: on ? 'var(--accent-muted, rgba(59,130,246,.15))' : 'none',
    color: on ? 'var(--accent,#3b82f6)' : 'var(--text-secondary,#aaa)',
  })

  return (
    <div style={wrap}>
      {p.mode === 'analog'
        ? <Analog now={now} seconds={p.seconds} />
        : <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 'min(2vw, 16px)', maxWidth: '94vw', lineHeight: 1 }}>
            <span style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 'min(14vw, 20vh)', fontWeight: 700, letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>{digits}</span>
            {ampm && <span style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 'min(2.6vw, 4vh)', fontWeight: 600, letterSpacing: '0.12em', color: 'var(--text-tertiary,#666)' }}>{ampm}</span>}
          </div>}

      {p.date && <div style={{ fontSize: 'clamp(14px, 3vw, 22px)', color: 'var(--text-secondary,#aaa)', fontFamily: 'var(--font-mono,monospace)' }}>{date}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 10 }}>
        <button style={chip(p.mode === 'digital')} onClick={() => set({ mode: 'digital' })}>Digital</button>
        <button style={chip(p.mode === 'analog')}  onClick={() => set({ mode: 'analog' })}>Analog</button>
        <span style={{ width: 1, background: 'var(--border-color,#2a2a2a)', margin: '0 4px' }} />
        <button style={chip(p.seconds)} onClick={() => set({ seconds: !p.seconds })}>Seconds</button>
        {p.mode === 'digital' && <button style={chip(p.hour24)} onClick={() => set({ hour24: !p.hour24 })}>24&#8209;hour</button>}
        <button style={chip(p.date)} onClick={() => set({ date: !p.date })}>Date</button>
      </div>
    </div>
  )
}
