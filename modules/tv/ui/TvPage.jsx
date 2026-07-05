// TvPage.jsx — native OTA-TV guide over Jellyfin (thrive-styled). Lists channels
// with now-playing EPG; clicking a channel opens it in the full Jellyfin app for
// playback (Jellyfin handles transcoding). "Full app ↗" opens Jellyfin's Live TV.
// The Jellyfin API key never reaches the browser — the thrive API proxies it.
import { useState, useEffect, useMemo } from 'react'

export default function TvPage() {
  const [channels, setChannels] = useState(null)
  const [jellyfin, setJellyfin] = useState('')
  const [error, setError]   = useState('')
  const [q, setQ]           = useState('')

  const load = () => {
    fetch('/api/tv/channels', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setChannels(d.channels || []); setJellyfin(d.jellyfin_url || ''); if (d.error) setError(d.error) })
      .catch(() => setError('Could not reach the TV backend.'))
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    if (!channels) return []
    const s = q.trim().toLowerCase()
    if (!s) return channels
    return channels.filter(c =>
      (c.name || '').toLowerCase().includes(s) ||
      (c.number || '').includes(s) ||
      (c.now?.name || '').toLowerCase().includes(s))
  }, [channels, q])

  const openChannel = (c) => { if (jellyfin) window.open(`${jellyfin}/web/#/details?id=${c.id}`, '_blank', 'noopener') }
  const openFull    = () => { if (jellyfin) window.open(`${jellyfin}/web/#/livetv`, '_blank', 'noopener') }

  const btnS = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '7px 12px', textDecoration: 'none' }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 22 }}>📺</span>
        <span style={{ fontFamily: 'Space Mono, monospace', fontSize: 18, letterSpacing: '0.04em' }}>Live TV</span>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter channels…"
          style={{ flex: 1, minWidth: 160, maxWidth: 320, fontFamily: 'DM Sans, sans-serif', fontSize: 14, background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 8, color: 'var(--text-primary,#e8e6e0)', padding: '8px 12px', outline: 'none' }} />
        <div style={{ flex: 1 }} />
        <button style={{ ...btnS, background: 'var(--accent,#ef4444)', color: '#fff', border: 'none', fontWeight: 600 }} onClick={openFull} disabled={!jellyfin}>Full app ↗</button>
      </div>

      {error && <div style={{ color: 'var(--color-danger,#ef4444)', fontSize: 13, marginBottom: 16 }}>{error}</div>}
      {channels === null && <div style={{ color: 'var(--text-tertiary,#666)', fontFamily: 'monospace' }}>loading channels…</div>}
      {channels && channels.length === 0 && !error && <div style={{ color: 'var(--text-tertiary,#666)' }}>No channels.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {filtered.map(c => (
          <div key={c.id} onClick={() => openChannel(c)} title={`Open ${c.name} in Jellyfin`}
            style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, cursor: 'pointer', transition: 'border-color 0.12s' }}
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
              <div style={{ fontSize: 12, color: c.now ? 'var(--text-secondary,#aaa)' : 'var(--text-tertiary,#555)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                {c.now?.name || '—'}
              </div>
            </div>
          </div>
        ))}
      </div>

      {jellyfin && channels && channels.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', marginTop: 18 }}>
          Click a channel to watch in the full Jellyfin app. Playback opens Jellyfin directly (LAN).
        </div>
      )}
    </div>
  )
}
