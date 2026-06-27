// =============================================================================
// OnboardingScreen — first-boot setup for a thrive appliance (sapling/kiosk).
// Asks whether THIS box is a Host (runs thrive + owns the data) or a Client (a
// screen pointed at another thrive Host). Shown by App's Gate when no owner
// account exists yet and the role is still 'unset'.
// =============================================================================
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import PasswordInput from './PasswordInput'

const wrap = { minHeight: 'calc(100vh - var(--osk-height, 0px))', transition: 'min-height 0.24s cubic-bezier(.2,.8,.2,1)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary,#0f0f0f)', padding: 20 }
const card = { width: '100%', maxWidth: 440, background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 12, padding: 28 }
const lbl  = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary,#666)', display: 'block', marginBottom: 4 }
const inp  = { fontFamily: 'monospace', fontSize: 14, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '9px 12px', outline: 'none', width: '100%', boxSizing: 'border-box', marginBottom: 12 }
const btn  = { width: '100%', padding: 11, fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', background: 'var(--text-primary,#e8e6e0)', border: 'none', borderRadius: 6, color: 'var(--bg-primary,#0f0f0f)', fontWeight: 600, cursor: 'pointer', marginTop: 4 }
const ghost = { ...btn, marginTop: 8, background: 'none', border: '1px solid var(--border-color,#333)', color: 'var(--text-secondary,#aaa)' }
const choice = { flex: 1, textAlign: 'left', background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 10, padding: 18, cursor: 'pointer', transition: 'border-color .12s' }

const Err = ({ msg }) => <div style={{ fontSize: 12, color: 'var(--color-danger,#ef4444)', marginBottom: 10 }}>{msg}</div>

function Header({ sub }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 22 }}>
      <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 24, fontWeight: 700, letterSpacing: '0.06em' }}>thrive</div>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary,#888)', marginTop: 6 }}>{sub}</div>
    </div>
  )
}

export default function OnboardingScreen() {
  const { register, configureClient } = useAuth()
  const [mode, setMode] = useState(null)        // null | 'host' | 'client'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [hostUrl,  setHostUrl]  = useState('')
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)

  const submitHost = async () => {
    setErr(null)
    if (!username || !password) return setErr('Username and master password required')
    if (password.length < 8)    return setErr('Master password must be at least 8 characters')
    if (password !== confirm)   return setErr('Passwords do not match')
    setBusy(true)
    try { await register({ username, password }) }
    catch (e) { setErr(e.message || 'Setup failed') } finally { setBusy(false) }
  }
  const submitClient = async () => {
    setErr(null)
    let url = hostUrl.trim()
    if (!url) return setErr('Host address required')
    if (!/^https?:\/\//.test(url)) url = 'http://' + url
    setBusy(true)
    try { await configureClient(url, { username, password }) }
    catch (e) { setErr(e.message || 'Could not save') } finally { setBusy(false) }
  }

  const choiceCard = (icon, title, desc, onClick) => (
    <div style={choice} onClick={onClick}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-tertiary,#888)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color,#333)' }}>
      <div style={{ fontSize: 22, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary,#888)', lineHeight: 1.5 }}>{desc}</div>
    </div>
  )

  return (
    <div style={wrap}>
      <div style={card}>
        {mode === null && (<>
          <Header sub="Set up this screen" />
          <div style={{ display: 'flex', gap: 12 }}>
            {choiceCard('🌳', 'Host', 'This box runs thrive — the household data lives here. Set a master password.', () => { setErr(null); setMode('host') })}
            {choiceCard('🪟', 'Client', "A screen for another thrive Host. Point it at the Host's address.", () => { setErr(null); setMode('client') })}
          </div>
        </>)}

        {mode === 'host' && (<>
          <Header sub="Host — create the master account" />
          <label style={lbl}>Username</label>
          <input style={inp} value={username} autoFocus autoComplete="username" onChange={e => setUsername(e.target.value)} />
          <label style={lbl}>Master password</label>
          <PasswordInput style={{ ...inp, marginBottom: 0 }} wrapStyle={{ marginBottom: 12 }} value={password} autoComplete="new-password" onChange={e => setPassword(e.target.value)} />
          <label style={lbl}>Confirm password</label>
          <PasswordInput style={{ ...inp, marginBottom: 0 }} wrapStyle={{ marginBottom: 12 }} value={confirm} autoComplete="new-password" onChange={e => setConfirm(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitHost()} />
          {err && <Err msg={err} />}
          <button style={{ ...btn, opacity: busy ? .5 : 1 }} disabled={busy} onClick={submitHost}>{busy ? '…' : 'Create & run as Host'}</button>
          <button style={ghost} onClick={() => { setMode(null); setErr(null) }}>← Back</button>
        </>)}

        {mode === 'client' && (<>
          <Header sub="Client — connect to a Host" />
          <label style={lbl}>Host address</label>
          <input style={inp} value={hostUrl} autoFocus placeholder="192.168.0.50:9500" onChange={e => setHostUrl(e.target.value)} />
          <label style={lbl}>Username</label>
          <input style={inp} value={username} autoComplete="username" onChange={e => setUsername(e.target.value)} />
          <label style={lbl}>Password</label>
          <PasswordInput style={{ ...inp, marginBottom: 0 }} wrapStyle={{ marginBottom: 12 }} value={password} autoComplete="current-password" onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitClient()} />
          {err && <Err msg={err} />}
          <button style={{ ...btn, opacity: busy ? .5 : 1 }} disabled={busy} onClick={submitClient}>{busy ? '…' : 'Save client config'}</button>
          <button style={ghost} onClick={() => { setMode(null); setErr(null) }}>← Back</button>
        </>)}
      </div>
    </div>
  )
}
