import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

const wrap = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary,#0f0f0f)', padding: 20 }
const card = { width: '100%', maxWidth: 360, background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 12, padding: 28 }
const lbl  = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary,#666)', display: 'block', marginBottom: 4 }
const inp  = { fontFamily: 'monospace', fontSize: 14, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '9px 12px', outline: 'none', flex: 1, boxSizing: 'border-box', minWidth: 0 }
const btn  = { width: '100%', padding: 10, fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', background: 'var(--text-primary,#e8e6e0)', border: 'none', borderRadius: 6, color: 'var(--bg-primary,#0f0f0f)', fontWeight: 600, cursor: 'pointer', marginTop: 8 }
const eye  = { background: 'none', border: 'none', cursor: 'pointer', padding: '0 10px', color: 'var(--text-tertiary,#666)', fontSize: 14, flexShrink: 0 }

function PwField({ label, value, onChange, onKeyDown, show, setShow, id }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={lbl}>{label}</label>
      <div style={{ display: 'flex', background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, overflow: 'hidden' }}>
        <input id={id} style={{ ...inp, border: 'none', background: 'none' }}
          type={show ? 'text' : 'password'} value={value}
          onChange={onChange} onKeyDown={onKeyDown}
          autoComplete={id === 'pw' ? 'current-password' : 'new-password'} />
        <button type="button" style={eye} onClick={() => setShow(s => !s)} tabIndex={-1}>
          {show ? '🙈' : '👁'}
        </button>
      </div>
    </div>
  )
}

export default function LoginPage() {
  const { login, register, setupNeeded } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [showConf, setShowConf] = useState(false)
  const [busy,     setBusy]     = useState(false)
  const [err,      setErr]      = useState(null)

  const submit = async () => {
    setErr(null)
    if (!username || !password) { setErr('Username and password required'); return }
    if (setupNeeded && password.length < 8) { setErr('Password must be at least 8 characters'); return }
    if (setupNeeded && password !== confirm) { setErr('Passwords do not match'); return }
    setBusy(true)
    try {
      if (setupNeeded) await register({ username, password })
      else await login(username, password)
    } catch (e) { setErr(e.message || 'Something went wrong') }
    finally { setBusy(false) }
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 22, fontWeight: 700, letterSpacing: '0.06em' }}>thrive</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary,#888)', marginTop: 6 }}>
            {setupNeeded ? 'Create the first account' : 'Sign in'}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Username</label>
          <input style={{ ...inp, width: '100%' }} value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()} autoFocus
            autoComplete="username" />
        </div>

        <PwField label="Password" value={password} onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          show={showPw} setShow={setShowPw} id="pw" />

        {setupNeeded && (
          <PwField label="Confirm password" value={confirm} onChange={e => setConfirm(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            show={showConf} setShow={setShowConf} id="confirm" />
        )}

        {err && <div style={{ fontSize: 12, color: 'var(--color-danger,#ef4444)', marginBottom: 8 }}>{err}</div>}

        <button style={{ ...btn, opacity: busy ? 0.5 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}
          onClick={submit} disabled={busy}>
          {busy ? '…' : setupNeeded ? 'Create account' : 'Sign in'}
        </button>

        {setupNeeded && (
          <div style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', textAlign: 'center', marginTop: 14, lineHeight: 1.6 }}>
            First account becomes admin
          </div>
        )}
      </div>
    </div>
  )
}