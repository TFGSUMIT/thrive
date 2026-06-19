// =============================================================================
// SteamPage.jsx — Steam module page (/steam)
// thrive UI
//
// Library dashboard for the household's linked Steam accounts: pick a profile
// (chips show live online/in-game dots), see its presence card, the last-2-weeks
// recently-played shelf, and the full owned library as a sortable table
// (name / playtime / last played). Linking accounts + the API key live in
// Settings → Steam.
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@trunk/api'
import { useToast } from '@trunk/context/ToastContext'

const ACCENT = '#66c0f4'   // module color

const ICON_URL   = (appid, hash) => `https://media.steampowered.com/steamcommunity/public/images/apps/${appid}/${hash}.jpg`
const HEADER_URL = (appid) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`

// minutes → compact hours readout: 47 → "47 min", 125 → "2.1 h", 6000 → "100 h"
const fmtPlay = (min) => min == null ? '—' : min < 60 ? `${min} min` : `${+(min / 60).toFixed(min < 6000 ? 1 : 0)} h`
// unix epoch → "2026-06-11"; Steam uses 0 for "never"
const fmtDate = (epoch) => epoch ? new Date(epoch * 1000).toISOString().slice(0, 10) : '—'

const STATE_COLOR = { online: ACCENT, 'in-game': '#a3cf06', offline: 'var(--text-tertiary,#555)' }

const card = { background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, overflow: 'hidden' }
const head = { padding: '10px 16px', borderBottom: '1px solid var(--border-color,#2a2a2a)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#666)' }
const inp  = { fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '7px 10px', outline: 'none', boxSizing: 'border-box' }
const btnS = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '7px 12px' }

// library-table column layout, shared by the header row and every body row
const GAME_COLS = '30px minmax(0,1fr) 90px 100px'

export default function SteamPage() {
  const { showToast } = useToast()
  const navigate = useNavigate()

  const [links,    setLinks]    = useState(null)   // null = loading roster
  const [presence, setPresence] = useState({})     // steamid → live summary
  const [sel,      setSel]      = useState(() => localStorage.getItem('thrive:steam:profile') || '')
  const [lib,      setLib]      = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [query,    setQuery]    = useState('')
  const [sort,     setSort]     = useState({ key: 'playtime', dir: -1 })

  const linked = (links || []).filter(l => l.steamid)

  const loadRoster = useCallback(async () => {
    try {
      const ls = await api.get('/steam/links')
      setLinks(ls)
      try { setPresence((await api.get('/steam/overview')).players || {}) } catch {}
    } catch (e) { setLinks([]); showToast(e.message, 'error') }
  }, [showToast])
  useEffect(() => { loadRoster() }, [loadRoster])

  // pick a default profile once the roster lands; remember the choice
  useEffect(() => {
    if (!links) return
    const ok = linked.find(l => String(l.user_id) === sel)
    if (!ok && linked.length) setSel(String(linked[0].user_id))
  }, [links])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel) localStorage.setItem('thrive:steam:profile', sel) }, [sel])

  const loadLibrary = useCallback(async () => {
    if (!sel) return
    setLoading(true)
    try { setLib(await api.get(`/steam/library/${sel}`)) }
    catch (e) { setLib(null); showToast(e.message, 'error') }
    finally { setLoading(false) }
  }, [sel, showToast])
  useEffect(() => { loadLibrary() }, [loadLibrary])

  // ── sortable library table ──
  const sortVal = {
    name:     g => g.name.toLowerCase(),
    playtime: g => g.playtime,
    last:     g => g.last_played,
  }[sort.key]
  const games = [...(lib?.games || [])]
    .filter(g => !query.trim() || g.name.toLowerCase().includes(query.toLowerCase().trim()))
    .sort((a, b) => {
      const va = sortVal(a), vb = sortVal(b)
      let d
      if (va == null || vb == null) d = (va == null) - (vb == null)   // missing values sink, either direction
      else d = (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * sort.dir
      return d || a.name.localeCompare(b.name)
    })
  const onSort = (key) => setSort(s => ({ key, dir: s.key === key ? -s.dir : (key === 'name' ? 1 : -1) }))
  const Th = ({ k, label, align }) => (
    <button onClick={() => onSort(k)} title={`Sort by ${label.toLowerCase()}`}
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: align || 'left',
        color: sort.key === k ? 'var(--text-secondary,#aaa)' : 'var(--text-tertiary,#666)' }}>
      {label}{sort.key === k ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </button>
  )

  const profile = lib?.profile
  const liveState = profile ? (profile.in_game ? 'in-game' : profile.state) : null

  // chip presence dot: green = in-game, steam-blue = online, dim = offline
  const dotFor = (l) => {
    const p = presence[l.steamid]
    if (!p) return STATE_COLOR.offline
    return p.in_game ? STATE_COLOR['in-game'] : p.state === 'offline' ? STATE_COLOR.offline : STATE_COLOR.online
  }

  return (
    <div style={{ padding: '1.5rem 1.5rem 3rem', maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 14, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>🎮 Steam</h1>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary,#888)', marginTop: 4 }}>Household game libraries</p>
        </div>
        <button onClick={() => { loadRoster(); loadLibrary() }} style={{ ...btnS, padding: '4px 9px', fontSize: 9 }}>↻</button>
      </div>

      {/* ── profile picker ── */}
      {links !== null && linked.length === 0 ? (
        <div style={{ ...card, padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary,#aaa)', marginTop: 0, marginBottom: 16 }}>
            No Steam accounts linked yet. Add the API key and link household profiles in Settings.
          </p>
          <button style={btnS} onClick={() => navigate('/settings')}>Go to Settings → Steam</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {linked.map(l => {
            const active = String(l.user_id) === sel
            return (
              <button key={l.user_id} onClick={() => setSel(String(l.user_id))}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px 6px 10px', borderRadius: 999, cursor: 'pointer',
                  background: active ? 'var(--bg-tertiary,#222)' : 'none', fontFamily: 'inherit', fontSize: 12, color: 'inherit',
                  border: `1px solid ${active ? ACCENT : 'var(--border-color,#2a2a2a)'}` }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotFor(l) }} />
                <span>{l.profile_avatar || '👤'} {l.name}</span>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary,#888)', fontFamily: 'monospace' }}>{presence[l.steamid]?.persona || l.persona}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* ── presence card ── */}
      {profile && (
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14, padding: 14 }}>
          {profile.avatar && <img src={profile.avatar} alt="" style={{ width: 52, height: 52, borderRadius: 8, border: `1px solid ${STATE_COLOR[liveState] || ACCENT}` }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{profile.persona}</div>
            <div style={{ fontSize: 11, marginTop: 2, color: STATE_COLOR[liveState] || ACCENT }}>
              {profile.in_game ? `▶ playing ${profile.in_game}` : profile.state}
              {!profile.in_game && profile.state === 'offline' && profile.last_online &&
                <span style={{ color: 'var(--text-tertiary,#666)' }}> · last online {fmtDate(profile.last_online)}</span>}
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-secondary,#aaa)', flexShrink: 0 }}>
            <div>{lib.game_count} games</div>
            <div style={{ color: 'var(--text-tertiary,#888)', marginTop: 2 }}>{fmtPlay(lib.total_playtime)} all time</div>
          </div>
        </div>
      )}

      {/* ── recently played ── */}
      {lib?.recent?.length > 0 && (
        <div style={card}>
          <div style={head}>Last two weeks</div>
          <div style={{ display: 'flex', gap: 10, padding: 12, overflowX: 'auto' }}>
            {lib.recent.map(g => (
              <div key={g.appid} style={{ width: 168, flexShrink: 0 }}>
                <img src={HEADER_URL(g.appid)} alt="" loading="lazy"
                  style={{ width: 168, height: 78, objectFit: 'cover', borderRadius: 6, display: 'block', background: 'var(--bg-tertiary,#222)' }}
                  onError={e => { e.target.style.visibility = 'hidden' }} />
                <div style={{ fontSize: 11, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.name}>{g.name}</div>
                <div style={{ fontSize: 10, color: ACCENT, fontFamily: 'monospace' }}>{fmtPlay(g.two_weeks)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── library table ── */}
      {sel && (
        <div style={card}>
          <div style={{ ...head, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span>Library</span>
            <input style={{ ...inp, width: 200, padding: '4px 8px', fontSize: 11 }} value={query}
              placeholder="search…" onChange={e => setQuery(e.target.value)} />
          </div>
          <div style={{ padding: lib?.games?.length ? '4px 0' : 16 }}>
            {loading ? (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary,#888)' }}>Loading library…</div>
            ) : lib?.private ? (
              <div style={{ fontSize: 12, color: '#f59e0b' }}>
                This Steam profile is private — set "Game details" to Public in Steam's privacy settings to see the library.
              </div>
            ) : !lib?.games?.length ? (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary,#888)' }}>No games found.</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: GAME_COLS, gap: 8, alignItems: 'center', padding: '6px 16px' }}>
                  <span />
                  <Th k="name"     label="Game" />
                  <Th k="playtime" label="Playtime" align="right" />
                  <Th k="last"     label="Last played" align="right" />
                </div>
                {games.map(g => (
                  <div key={g.appid} style={{ display: 'grid', gridTemplateColumns: GAME_COLS, gap: 8, alignItems: 'center', padding: '5px 16px', borderTop: '1px solid var(--border-color,#2a2a2a)' }}>
                    {g.icon
                      ? <img src={ICON_URL(g.appid, g.icon)} alt="" loading="lazy" style={{ width: 22, height: 22, borderRadius: 4, background: 'var(--bg-tertiary,#222)' }} onError={e => { e.target.style.visibility = 'hidden' }} />
                      : <span />}
                    <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: g.playtime ? 'var(--text-primary,#e8e6e0)' : 'var(--text-secondary,#aaa)' }} title={g.name}>{g.name}</span>
                    <span style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: g.playtime ? 'var(--text-secondary,#999)' : 'var(--text-tertiary,#555)' }}>{g.playtime ? fmtPlay(g.playtime) : 'unplayed'}</span>
                    <span style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-tertiary,#888)' }}>{fmtDate(g.last_played)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
