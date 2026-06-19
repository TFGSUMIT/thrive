// =============================================================================
// GOGPanel.jsx — GOG module Settings panel
// thrive module `gog`
//
// Links household profiles to GOG accounts. GOG has no API keys — each person
// signs into GOG in a browser tab; the login lands on a blank page whose
// address bar carries a one-time ?code=, which gets pasted here and exchanged
// for a long-lived token. Re-linking just repeats the dance.
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import { api } from '@trunk/api'
import { useToast } from '@trunk/context/ToastContext'

const ACCENT = '#9d4edd'   // module color

const lbl  = { fontSize: 10, color: 'var(--text-tertiary,#666)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block' }
const inp  = { fontFamily: 'monospace', fontSize: 11, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '7px 10px', outline: 'none', width: '100%', boxSizing: 'border-box' }
const btnS = { fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '6px 10px' }

export default function GOGPanel() {
  const { showToast } = useToast()
  const [links,   setLinks]   = useState([])
  const [authUrl, setAuthUrl] = useState('')
  const [inputs,  setInputs]  = useState({})   // user_id → pasted code/URL
  const [busy,    setBusy]    = useState(false)

  const load = useCallback(async () => {
    try {
      setLinks(await api.get('/gog/links'))
      setAuthUrl((await api.get('/gog/auth-url')).url)
    } catch {}
  }, [])
  useEffect(() => { load() }, [load])

  const link = async (userId) => {
    const code = (inputs[userId] || '').trim()
    if (!code) return
    setBusy(true)
    try {
      const r = await api.post('/gog/links', { user_id: userId, code })
      showToast(`Linked → ${r.username}`, 'success')
      setInputs(i => ({ ...i, [userId]: '' }))
      load()
    } catch (e) { showToast(e.message, 'error') }
    finally { setBusy(false) }
  }

  const unlink = async (userId) => {
    setBusy(true)
    try { await api.del(`/gog/links/${userId}`); load() }
    catch (e) { showToast(e.message, 'error') }
    finally { setBusy(false) }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary,#aaa)', lineHeight: 1.6, marginBottom: 14 }}>
        <strong style={{ color: ACCENT }}>How linking works:</strong>{' '}
        <button style={{ ...btnS, padding: '2px 8px', borderColor: ACCENT, color: ACCENT }}
          onClick={() => authUrl && window.open(authUrl, '_blank')}>Open GOG login ↗</button>{' '}
        sign in there — it ends on a blank page. Copy that page's <em>address bar URL</em>
        {' '}(it contains <code style={{ fontSize: 10 }}>code=…</code>) and paste it below next to the profile.
        Each code works once and expires in a minute or two.
      </div>

      <label style={lbl}>Profile links</label>
      {links.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary,#888)' }}>No household profiles yet — add people in the Users module first.</div>
      ) : links.map(l => (
        <div key={l.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border-color,#2a2a2a)' }}>
          <span style={{ fontSize: 13, width: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {l.profile_avatar || '👤'} {l.name}
          </span>
          {l.username || l.gog_user_id ? (
            <>
              <span style={{ flex: 1, fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary,#aaa)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                {l.gog_avatar && <img src={l.gog_avatar} alt="" style={{ width: 16, height: 16, borderRadius: 3 }} />}
                {l.username || l.gog_user_id}
              </span>
              <button style={btnS} onClick={() => unlink(l.user_id)} disabled={busy}>Unlink</button>
            </>
          ) : (
            <>
              <input style={{ ...inp, flex: 1 }} value={inputs[l.user_id] || ''}
                placeholder="paste the login URL or code…" autoComplete="off"
                onChange={e => setInputs(i => ({ ...i, [l.user_id]: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && link(l.user_id)} />
              <button style={{ ...btnS, borderColor: ACCENT, color: ACCENT }} onClick={() => link(l.user_id)}
                disabled={busy || !(inputs[l.user_id] || '').trim()}>Link</button>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
