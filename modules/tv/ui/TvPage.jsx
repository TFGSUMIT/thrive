// TvPage.jsx — native OTA-TV guide over Jellyfin (thrive-styled).
//  • classic EPG time-grid: channels down a sticky left column, a time axis
//    across a sticky top header, program cells sized to their airing window,
//    scroll horizontally through ~12h. A red "now" line marks the current time.
//  • ★ favorites (per-device) float channels to the top; a "favorites only" toggle
//  • click a program → a small floating player (Jellyfin embedded via the https
//    tv subdomain); an ⤢ expand button goes full-screen. Same iframe stays
//    mounted across resize so playback never restarts.
import { useState, useEffect, useMemo } from 'react'

const FAV_KEY = 'thrive:tv:favorites'

// grid geometry
const COL_W    = 152   // channel column width
const ROW_H    = 54    // channel row height
const HEAD_H   = 30    // time-axis header height
const PX_MIN   = 5     // px per minute (30 min = 150px)
const SLOT_MIN = 30    // time-label granularity

const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export default function TvPage() {
  const [channels, setChannels] = useState(null)
  const [jellyfin, setJellyfin] = useState('')
  const [error, setError]   = useState('')
  const [q, setQ]           = useState('')
  const [favOnly, setFavOnly] = useState(false)
  const [favs, setFavs]     = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY)) || []) } catch { return new Set() }
  })
  const [watch, setWatch]   = useState(null)       // channel being watched
  const [expanded, setExpanded] = useState(false)  // mini (false) vs full (true)
  const [hours, setHours]   = useState(12)         // guide depth (from backend)
  const [now, setNow]       = useState(() => Date.now())  // drives the "now" line

  useEffect(() => {
    const load = () => fetch('/api/tv/channels', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setChannels(d.channels || []); setJellyfin(d.jellyfin_url || '')
        if (d.guide_hours) setHours(d.guide_hours)
        setError(d.error || '')
      })
      .catch(() => setError('Could not reach the TV backend.'))
    load()
    const refetch = setInterval(load, 300000)                 // roll the guide every 5 min
    const tick = setInterval(() => setNow(Date.now()), 30000) // advance the now line
    return () => { clearInterval(refetch); clearInterval(tick) }
  }, [])

  const toggleFav = (id) => {
    setFavs(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      try { localStorage.setItem(FAV_KEY, JSON.stringify([...n])) } catch {}
      return n
    })
  }

  const list = useMemo(() => {
    if (!channels) return []
    const s = q.trim().toLowerCase()
    const cs = channels.filter(c =>
      (!favOnly || favs.has(c.id)) && (!s ||
        (c.name || '').toLowerCase().includes(s) ||
        (c.number || '').includes(s) ||
        (c.programs || []).some(p => (p.name || '').toLowerCase().includes(s))))
    // favorites float to the top, otherwise keep the backend's number order
    return [...cs].sort((a, b) => (favs.has(b.id) ? 1 : 0) - (favs.has(a.id) ? 1 : 0))
  }, [channels, q, favOnly, favs])

  // grid anchored to the previous half-hour; stable within each 30-min bucket
  const bucket = Math.floor(now / (SLOT_MIN * 60000))
  const gridStart = useMemo(() => bucket * SLOT_MIN * 60000, [bucket])
  const winMin = hours * 60
  const trackW = winMin * PX_MIN
  const marks = useMemo(() => {
    const m = []
    for (let t = 0; t <= winMin; t += SLOT_MIN) m.push({ t, label: fmtTime(gridStart + t * 60000) })
    return m
  }, [gridStart, winMin])
  const nowLeft = COL_W + ((now - gridStart) / 60000) * PX_MIN

  const open  = (c) => { if (jellyfin) { setWatch(c); setExpanded(false) } }
  const close = () => setWatch(null)
  const openFull = () => { if (jellyfin) window.open(`${jellyfin}/web/#/livetv`, '_blank', 'noopener') }

  useEffect(() => {
    if (!watch) return
    const onKey = (e) => { if (e.key === 'Escape') (expanded ? setExpanded(false) : close()) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [watch, expanded])

  const btnS = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '7px 12px' }

  // program cell within a channel row, clipped to the visible window
  const cell = (c, p, i) => {
    const s = Date.parse(p.start), e = Date.parse(p.end)
    if (!s || !e) return null
    let left = ((s - gridStart) / 60000) * PX_MIN
    let width = ((e - s) / 60000) * PX_MIN
    if (left < 0) { width += left; left = 0 }               // clip left edge to grid start
    if (left >= trackW) return null                          // past the window
    if (left + width > trackW) width = trackW - left         // clip right edge
    if (width < 1) return null
    const isNow = s <= now && now < e
    return (
      <div key={i} onClick={() => open(c)} title={`${p.name}\n${fmtTime(s)}–${fmtTime(e)}`}
        style={{ position: 'absolute', top: 3, bottom: 3, left, width: width - 2,
          background: isNow ? 'var(--bg-tertiary,#242424)' : 'var(--bg-secondary,#181818)',
          border: `1px solid ${isNow ? 'var(--accent,#ef4444)' : 'var(--border-color,#2a2a2a)'}`,
          borderRadius: 6, padding: '5px 8px', overflow: 'hidden', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
        onMouseEnter={ev => ev.currentTarget.style.borderColor = 'var(--accent,#ef4444)'}
        onMouseLeave={ev => ev.currentTarget.style.borderColor = isNow ? 'var(--accent,#ef4444)' : 'var(--border-color,#2a2a2a)'}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary,#e8e6e0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
        {width > 80 && <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-tertiary,#666)', marginTop: 1 }}>{fmtTime(s)}</div>}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1300, margin: '0 auto', padding: '20px 16px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 22 }}>📺</span>
        <span style={{ fontFamily: 'Space Mono, monospace', fontSize: 18, letterSpacing: '0.04em' }}>Live TV</span>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter…"
          style={{ flex: 1, minWidth: 140, maxWidth: 280, fontFamily: 'DM Sans, sans-serif', fontSize: 14, background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 8, color: 'var(--text-primary,#e8e6e0)', padding: '8px 12px', outline: 'none' }} />
        <button style={{ ...btnS, ...(favOnly ? { borderColor: 'var(--accent,#ef4444)', color: 'var(--accent,#ef4444)' } : {}) }}
          onClick={() => setFavOnly(v => !v)} title="Show favorites only">★ {favs.size || ''}</button>
        <div style={{ flex: 1 }} />
        <button style={{ ...btnS, background: 'var(--accent,#ef4444)', color: '#fff', border: 'none', fontWeight: 600 }} onClick={openFull} disabled={!jellyfin}>Full app ↗</button>
      </div>

      {error && <div style={{ color: 'var(--color-danger,#ef4444)', fontSize: 13, marginBottom: 16 }}>{error}</div>}
      {channels === null && <div style={{ color: 'var(--text-tertiary,#666)', fontFamily: 'monospace' }}>loading guide…</div>}
      {channels && list.length === 0 && !error && <div style={{ color: 'var(--text-tertiary,#666)' }}>{favOnly ? 'No favorites yet — tap a ☆ to add.' : 'No channels.'}</div>}

      {channels && list.length > 0 && (
        <div style={{ overflow: 'auto', position: 'relative', maxHeight: 'calc(100vh - 150px)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10 }}>
          <div style={{ position: 'relative', width: COL_W + trackW }}>
            {/* time-axis header (sticky top) */}
            <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 5, height: HEAD_H, background: 'var(--bg-primary,#0f0f0f)', borderBottom: '1px solid var(--border-color,#2a2a2a)' }}>
              <div style={{ position: 'sticky', left: 0, zIndex: 6, width: COL_W, flexShrink: 0, background: 'var(--bg-primary,#0f0f0f)', borderRight: '1px solid var(--border-color,#2a2a2a)' }} />
              <div style={{ position: 'relative', width: trackW, flexShrink: 0 }}>
                {marks.map(m => (
                  <div key={m.t} style={{ position: 'absolute', left: m.t * PX_MIN, top: 0, height: HEAD_H, display: 'flex', alignItems: 'center', paddingLeft: 6, borderLeft: '1px solid var(--border-color,#2a2a2a)', fontSize: 11, fontFamily: 'monospace', color: 'var(--text-tertiary,#777)', whiteSpace: 'nowrap' }}>{m.label}</div>
                ))}
              </div>
            </div>

            {/* channel rows */}
            {list.map(c => {
              const fav = favs.has(c.id)
              return (
                <div key={c.id} style={{ display: 'flex', height: ROW_H, borderBottom: '1px solid var(--border-color,#1e1e1e)' }}>
                  {/* sticky channel cell */}
                  <div style={{ position: 'sticky', left: 0, zIndex: 4, width: COL_W, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', background: 'var(--bg-primary,#0f0f0f)', borderRight: '1px solid var(--border-color,#2a2a2a)' }}>
                    <div style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 6, background: 'var(--bg-tertiary,#222)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      {c.has_logo
                        ? <img src={`/api/tv/logo/${c.id}`} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                        : <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary,#aaa)' }}>{c.number}</span>}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-tertiary,#666)' }}>{c.number}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary,#e8e6e0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                    </div>
                    <button onClick={() => toggleFav(c.id)} title={fav ? 'Unfavorite' : 'Favorite'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, lineHeight: 1, color: fav ? 'var(--accent,#ef4444)' : 'var(--text-tertiary,#555)', padding: 2, flexShrink: 0 }}>{fav ? '★' : '☆'}</button>
                  </div>
                  {/* timeline track */}
                  <div style={{ position: 'relative', width: trackW, flexShrink: 0 }}>
                    {(c.programs || []).length === 0
                      ? <div style={{ position: 'absolute', left: 8, top: 0, height: ROW_H, display: 'flex', alignItems: 'center', fontSize: 11, color: 'var(--text-tertiary,#555)' }}>no guide data</div>
                      : c.programs.map((p, i) => cell(c, p, i))}
                  </div>
                </div>
              )
            })}

            {/* now line — spans all rows, scrolls with the timeline */}
            {nowLeft >= COL_W && nowLeft <= COL_W + trackW && (
              <div style={{ position: 'absolute', top: HEAD_H, bottom: 0, left: nowLeft, width: 2, background: 'var(--accent,#ef4444)', zIndex: 3, pointerEvents: 'none' }} />
            )}
          </div>
        </div>
      )}

      {watch && (
        <>
          {expanded && <div onClick={() => setExpanded(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.85)' }} />}
          <div style={expanded
            ? { position: 'fixed', inset: '3vh 3vw', zIndex: 1001, display: 'flex', flexDirection: 'column' }
            : { position: 'fixed', bottom: 16, right: 16, width: 'min(460px, 92vw)', zIndex: 1001, background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#333)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 10px 34px rgba(0,0,0,0.55)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', flexShrink: 0, color: 'var(--text-primary,#e8e6e0)', background: expanded ? 'transparent' : 'var(--bg-tertiary,#1e1e1e)' }}>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-tertiary,#888)' }}>{watch.number}</span>
              <span style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{watch.name}</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => setExpanded(v => !v)} title={expanded ? 'Shrink' : 'Expand'}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary,#aaa)', cursor: 'pointer', fontSize: 15, padding: '2px 6px' }}>{expanded ? '🗕' : '⤢'}</button>
              <button onClick={close} title="Close"
                style={{ background: 'none', border: 'none', color: 'var(--text-primary,#e8e6e0)', cursor: 'pointer', fontSize: 17, padding: '2px 6px' }}>✕</button>
            </div>
            <iframe title={watch.name} src={`${jellyfin}/web/#/details?id=${watch.id}`}
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen
              style={expanded
                ? { flex: 1, width: '100%', border: 'none', borderRadius: 10, background: '#000' }
                : { width: '100%', aspectRatio: '16 / 9', border: 'none', background: '#000', display: 'block' }} />
          </div>
        </>
      )}
    </div>
  )
}
