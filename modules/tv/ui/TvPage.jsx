// TvPage.jsx — native OTA-TV guide over Jellyfin (thrive-styled).
//  • channel grid with logos + now-playing EPG + filter
//  • ★ favorites (per-device), sorted to the top, with a "favorites only" toggle
//  • click a channel → a small floating player (Jellyfin embedded via the https
//    tv subdomain); an ⤢ expand button goes full-screen. Same iframe stays
//    mounted across resize so playback never restarts.
import { useState, useEffect, useMemo } from 'react'

const FAV_KEY = 'thrive:tv:favorites'

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

  useEffect(() => {
    fetch('/api/tv/channels', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setChannels(d.channels || []); setJellyfin(d.jellyfin_url || ''); if (d.error) setError(d.error) })
      .catch(() => setError('Could not reach the TV backend.'))
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
    let cs = channels.filter(c =>
      (!favOnly || favs.has(c.id)) && (!s ||
        (c.name || '').toLowerCase().includes(s) ||
        (c.number || '').includes(s) ||
        (c.now?.name || '').toLowerCase().includes(s)))
    // favorites float to the top, otherwise keep the backend's number order
    return [...cs].sort((a, b) => (favs.has(b.id) ? 1 : 0) - (favs.has(a.id) ? 1 : 0))
  }, [channels, q, favOnly, favs])

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

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
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
      {channels === null && <div style={{ color: 'var(--text-tertiary,#666)', fontFamily: 'monospace' }}>loading channels…</div>}
      {channels && list.length === 0 && !error && <div style={{ color: 'var(--text-tertiary,#666)' }}>{favOnly ? 'No favorites yet — tap a ☆ to add.' : 'No channels.'}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
        {list.map(c => {
          const fav = favs.has(c.id)
          return (
            <div key={c.id} onClick={() => open(c)} title={`Watch ${c.name}`}
              style={{ position: 'relative', display: 'flex', gap: 12, alignItems: 'center', padding: 12, paddingRight: 34, background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent,#ef4444)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-color,#2a2a2a)'}>
              <div style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 8, background: 'var(--bg-tertiary,#222)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {c.has_logo
                  ? <img src={`/api/tv/logo/${c.id}`} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  : <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary,#aaa)' }}>{c.number}</span>}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-tertiary,#666)' }}>{c.number}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary,#e8e6e0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                </div>
                <div style={{ fontSize: 12, color: c.now ? 'var(--text-secondary,#aaa)' : 'var(--text-tertiary,#555)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{c.now?.name || '—'}</div>
              </div>
              <button onClick={e => { e.stopPropagation(); toggleFav(c.id) }} title={fav ? 'Unfavorite' : 'Favorite'}
                style={{ position: 'absolute', top: 8, right: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, lineHeight: 1, color: fav ? 'var(--accent,#ef4444)' : 'var(--text-tertiary,#555)', padding: 2 }}>
                {fav ? '★' : '☆'}
              </button>
            </div>
          )
        })}
      </div>

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
