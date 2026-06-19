// =============================================================================
// GOGPage.jsx — GOG module page (/gog)
// thrive UI
//
// Collection view for the household's linked GOG accounts: pick a profile,
// browse its DRM-free library as a cover grid with search and platform badges.
// GOG's web API exposes no playtime (that lives only inside Galaxy), so unlike
// the Steam page this is about what's owned, not hours. Linking lives in
// Settings → GOG.
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@trunk/api'
import { useToast } from '@trunk/context/ToastContext'

const ACCENT = '#9d4edd'   // module color

const OS_BADGE = { Windows: 'W', Mac: 'M', Linux: 'L' }

const card = { background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, overflow: 'hidden' }
const head = { padding: '10px 16px', borderBottom: '1px solid var(--border-color,#2a2a2a)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#666)' }
const inp  = { fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '7px 10px', outline: 'none', boxSizing: 'border-box' }
const btnS = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '7px 12px' }

export default function GOGPage() {
  const { showToast } = useToast()
  const navigate = useNavigate()

  const [links,   setLinks]   = useState(null)   // null = loading roster
  const [sel,     setSel]     = useState(() => localStorage.getItem('thrive:gog:profile') || '')
  const [lib,     setLib]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [query,   setQuery]   = useState('')

  const linked = (links || []).filter(l => l.username || l.gog_user_id)

  const loadRoster = useCallback(async () => {
    try { setLinks(await api.get('/gog/links')) }
    catch (e) { setLinks([]); showToast(e.message, 'error') }
  }, [showToast])
  useEffect(() => { loadRoster() }, [loadRoster])

  // pick a default profile once the roster lands; remember the choice
  useEffect(() => {
    if (!links) return
    const ok = linked.find(l => String(l.user_id) === sel)
    if (!ok && linked.length) setSel(String(linked[0].user_id))
  }, [links])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel) localStorage.setItem('thrive:gog:profile', sel) }, [sel])

  const loadLibrary = useCallback(async () => {
    if (!sel) return
    setLoading(true)
    try { setLib(await api.get(`/gog/library/${sel}`)) }
    catch (e) { setLib(null); showToast(e.message, 'error') }
    finally { setLoading(false) }
  }, [sel, showToast])
  useEffect(() => { loadLibrary() }, [loadLibrary])

  const games = (lib?.games || []).filter(g =>
    !query.trim() || g.title.toLowerCase().includes(query.toLowerCase().trim()))

  return (
    <div style={{ padding: '1.5rem 1.5rem 3rem', maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 14, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>👾 GOG</h1>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary,#888)', marginTop: 4 }}>DRM-free game collections</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lib?.profile && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary,#aaa)' }}>
              {lib.profile.avatar && <img src={lib.profile.avatar} alt="" style={{ width: 20, height: 20, borderRadius: 4 }} />}
              <span style={{ fontFamily: 'monospace' }}>{lib.profile.username}</span>
              <span style={{ color: ACCENT }}>· {lib.game_count} games</span>
            </span>
          )}
          <button onClick={() => { loadRoster(); loadLibrary() }} style={{ ...btnS, padding: '4px 9px', fontSize: 9 }}>↻</button>
        </div>
      </div>

      {/* ── profile picker ── */}
      {links !== null && linked.length === 0 ? (
        <div style={{ ...card, padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary,#aaa)', marginTop: 0, marginBottom: 16 }}>
            No GOG accounts linked yet. Link household profiles in Settings.
          </p>
          <button style={btnS} onClick={() => navigate('/settings')}>Go to Settings → GOG</button>
        </div>
      ) : linked.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {linked.map(l => {
            const active = String(l.user_id) === sel
            return (
              <button key={l.user_id} onClick={() => setSel(String(l.user_id))}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px 6px 10px', borderRadius: 999, cursor: 'pointer',
                  background: active ? 'var(--bg-tertiary,#222)' : 'none', fontFamily: 'inherit', fontSize: 12, color: 'inherit',
                  border: `1px solid ${active ? ACCENT : 'var(--border-color,#2a2a2a)'}` }}>
                <span>{l.profile_avatar || '👤'} {l.name}</span>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary,#888)', fontFamily: 'monospace' }}>{l.username}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* ── library grid ── */}
      {sel && (
        <div style={card}>
          <div style={{ ...head, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span>Library</span>
            <input style={{ ...inp, width: 200, padding: '4px 8px', fontSize: 11 }} value={query}
              placeholder="search…" onChange={e => setQuery(e.target.value)} />
          </div>
          <div style={{ padding: 14 }}>
            {loading ? (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary,#888)' }}>Loading library… (first load pages through the whole collection)</div>
            ) : !games.length ? (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary,#888)' }}>{lib?.games?.length ? 'No matches.' : 'No games found.'}</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
                {games.map(g => (
                  <a key={g.id} href={g.url || undefined} target="_blank" rel="noreferrer"
                    style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div style={{ aspectRatio: '2 / 1', borderRadius: 6, overflow: 'hidden', background: 'var(--bg-tertiary,#222)' }}>
                      {g.image && (
                        <img src={`${g.image}_392.jpg`} alt="" loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          onError={e => { e.target.style.display = 'none' }} />
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 5 }}>
                      <span style={{ flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.title}>{g.title}</span>
                      <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary,#666)', letterSpacing: '0.08em', flexShrink: 0 }}>
                        {(g.works_on || []).map(os => OS_BADGE[os] || os[0]).join(' ')}
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
