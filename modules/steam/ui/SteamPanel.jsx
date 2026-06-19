// =============================================================================
// SteamPanel.jsx — Steam module Settings panel
// thrive module `steam`
//
// The infra half of the module: the household's one Steam Web API key, plus
// linking household profiles to Steam accounts (steamid64, vanity name, or a
// full profile URL). The /steam page consumes the links this panel manages.
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import { api } from '@trunk/api'
import { useToast } from '@trunk/context/ToastContext'

const ACCENT = '#66c0f4'   // module color

const lbl  = { fontSize: 10, color: 'var(--text-tertiary,#666)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block' }
const inp  = { fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '7px 10px', outline: 'none', width: '100%', boxSizing: 'border-box' }
const btnS = { fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '6px 10px' }

export default function SteamPanel() {
  const { showToast } = useToast()
  const [keySet,   setKeySet]   = useState(false)
  const [keyHint,  setKeyHint]  = useState(null)
  const [keyInput, setKeyInput] = useState('')
  const [links,    setLinks]    = useState([])
  const [inputs,   setInputs]   = useState({})   // user_id → steam id/vanity being typed
  const [busy,     setBusy]     = useState(false)

  const load = useCallback(async () => {
    try {
      const cfg = await api.get('/steam/config')
      setKeySet(!!cfg.api_key_set); setKeyHint(cfg.api_key_hint)
      setLinks(await api.get('/steam/links'))
    } catch {}
  }, [])
  useEffect(() => { load() }, [load])

  const saveKey = async () => {
    if (!keyInput.trim()) return
    setBusy(true)
    try {
      await api.post('/steam/config', { key: 'api_key', value: keyInput.trim() })
      setKeyInput('')
      showToast('Steam API key saved', 'success')
      load()
    } catch (e) { showToast(e.message, 'error') }
    finally { setBusy(false) }
  }

  const link = async (userId) => {
    const steam = (inputs[userId] || '').trim()
    if (!steam) return
    setBusy(true)
    try {
      const r = await api.post('/steam/links', { user_id: userId, steam })
      showToast(`Linked → ${r.persona}`, 'success')
      setInputs(i => ({ ...i, [userId]: '' }))
      load()
    } catch (e) { showToast(e.message, 'error') }
    finally { setBusy(false) }
  }

  const unlink = async (userId) => {
    setBusy(true)
    try { await api.del(`/steam/links/${userId}`); load() }
    catch (e) { showToast(e.message, 'error') }
    finally { setBusy(false) }
  }

  return (
    <div style={{ padding: 16 }}>
      {/* ── API key ── */}
      <label style={lbl}>Web API key {keySet && <span style={{ color: ACCENT, textTransform: 'none' }}>· set ({keyHint})</span>}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input style={{ ...inp, flex: 1 }} type="password" value={keyInput} autoComplete="off"
          placeholder={keySet ? 'replace key…' : 'paste your Steam Web API key'}
          onChange={e => setKeyInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveKey()} />
        <button style={btnS} onClick={saveKey} disabled={busy || !keyInput.trim()}>Save</button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', marginTop: 6 }}>
        Free from <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noreferrer" style={{ color: ACCENT }}>steamcommunity.com/dev/apikey</a> — one key serves the whole household.
      </div>

      {/* ── profile links ── */}
      <div style={{ marginTop: 18 }}>
        <label style={lbl}>Profile links</label>
        {links.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary,#888)' }}>No household profiles yet — add people in the Users module first.</div>
        ) : links.map(l => (
          <div key={l.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border-color,#2a2a2a)' }}>
            <span style={{ fontSize: 13, width: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {l.profile_avatar || '👤'} {l.name}
            </span>
            {l.steamid ? (
              <>
                <span style={{ flex: 1, fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary,#aaa)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.steamid}>
                  {l.persona || l.steamid}
                </span>
                <button style={btnS} onClick={() => unlink(l.user_id)} disabled={busy}>Unlink</button>
              </>
            ) : (
              <>
                <input style={{ ...inp, flex: 1, fontSize: 11 }} value={inputs[l.user_id] || ''}
                  placeholder="steamid64 / vanity / profile URL" autoComplete="off"
                  onChange={e => setInputs(i => ({ ...i, [l.user_id]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && link(l.user_id)} />
                <button style={{ ...btnS, borderColor: ACCENT, color: ACCENT }} onClick={() => link(l.user_id)}
                  disabled={busy || !keySet || !(inputs[l.user_id] || '').trim()}>Link</button>
              </>
            )}
          </div>
        ))}
        {!keySet && links.length > 0 && (
          <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 6 }}>Add the API key above before linking.</div>
        )}
      </div>
    </div>
  )
}
