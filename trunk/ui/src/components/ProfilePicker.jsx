// =============================================================================
// ProfilePicker — switch identity on a kiosk. From the Household view, pick a
// person (a profile with a linked account) and sign in as them, or stay/return
// to Household. Rendered as a full-screen overlay; App's TopNav toggles it.
// (Account-less passwordless profiles are a Phase-2 addition.)
// =============================================================================
import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'

const overlay = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 'var(--osk-height, 0px)', transition: 'bottom 0.24s cubic-bezier(.2,.8,.2,1)', zIndex: 400, background: 'var(--bg-primary,#0f0f0f)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }
const inp = { fontFamily: 'monospace', fontSize: 14, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '9px 12px', outline: 'none', width: '100%', boxSizing: 'border-box', marginBottom: 12 }
const btn = { width: '100%', padding: 11, fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', background: 'var(--text-primary,#e8e6e0)', border: 'none', borderRadius: 6, color: 'var(--bg-primary,#0f0f0f)', fontWeight: 600, cursor: 'pointer' }
const ghost = { ...btn, marginTop: 8, background: 'none', border: '1px solid var(--border-color,#333)', color: 'var(--text-secondary,#aaa)' }
const closeBtn = { position: 'absolute', top: 18, right: 22, background: 'none', border: 'none', color: 'var(--text-tertiary,#666)', fontSize: 22, cursor: 'pointer' }
const eye = { background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, cursor: 'pointer', padding: '9px 12px', color: 'var(--text-secondary,#aaa)', fontSize: 16, lineHeight: 1, flexShrink: 0 }
const footer = { position: 'absolute', bottom: 14, left: 0, right: 0, textAlign: 'center', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-tertiary,#666)' }

function Face({ p, onClick }) {
  const initial = (p.name || '?').trim().charAt(0).toUpperCase()
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 100 }}>
      <div style={{ width: 76, height: 76, borderRadius: '50%', background: p.color || 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, color: '#0f0f0f' }}>
        {p.avatar || initial}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary,#ccc)' }}>{p.name}</div>
    </button>
  )
}

export default function ProfilePicker({ onClose }) {
  const { login, enterHousehold } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [sel, setSel] = useState(null)        // a profile with a linked account
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [device, setDevice] = useState(null)

  useEffect(() => {
    api.get('/auth/profiles').then(list => setProfiles((list || []).filter(p => p.account))).catch(() => {})
    api.get('/system/info').then(setDevice).catch(() => {})
  }, [])

  const pick = (p) => { setSel(p); setPassword(''); setShowPw(false); setErr(null) }
  const signIn = async () => {
    if (!password) return setErr('Password required')
    setBusy(true)
    try { await login(sel.account, password); onClose?.() }
    catch { setErr('Wrong password') }
    finally { setBusy(false) }
  }
  const household = async () => { try { await enterHousehold() } catch {}; onClose?.() }

  return (
    <div style={overlay}>
      <button style={closeBtn} onClick={() => onClose?.()} title="Close">✕</button>

      {!sel && (<>
        <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 16, letterSpacing: '0.08em', color: 'var(--text-secondary,#aaa)', marginBottom: 28 }}>Who's using thrive?</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, justifyContent: 'center', maxWidth: 660 }}>
          {profiles.map(p => <Face key={p.id} p={p} onClick={() => pick(p)} />)}
          {profiles.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary,#666)' }}>No sign-in profiles yet — add accounts in Settings.</div>
          )}
        </div>
        <button style={{ ...ghost, width: 'auto', padding: '9px 22px', marginTop: 34 }} onClick={household}>Continue as Household</button>
      </>)}

      {device?.device_ip && <div style={footer}>⌂ {device.device_ip}</div>}

      {sel && (<div style={{ width: '100%', maxWidth: 320 }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ width: 76, height: 76, borderRadius: '50%', margin: '0 auto 10px', background: sel.color || 'var(--bg-tertiary,#222)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, color: '#0f0f0f' }}>
            {sel.avatar || (sel.name || '?').charAt(0).toUpperCase()}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{sel.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary,#666)', marginTop: 2 }}>@{sel.account}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <input style={{ ...inp, marginBottom: 0, flex: 1, minWidth: 0 }}
            type={showPw ? 'text' : 'password'} autoFocus placeholder="Password" value={password}
            onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && signIn()} autoComplete="current-password" />
          <button type="button" style={eye} onClick={() => setShowPw(s => !s)} tabIndex={-1} title={showPw ? 'Hide password' : 'Show password'}>
            {showPw ? '🙈' : '👁'}
          </button>
        </div>
        {err && <div style={{ fontSize: 12, color: 'var(--color-danger,#ef4444)', marginBottom: 10 }}>{err}</div>}
        <button style={{ ...btn, opacity: busy ? .5 : 1 }} disabled={busy} onClick={signIn}>{busy ? '…' : 'Sign in'}</button>
        <button style={ghost} onClick={() => setSel(null)}>← Back</button>
      </div>)}
    </div>
  )
}
