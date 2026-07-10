// =============================================================================
// BlinkPage — Blink cameras (/blink). Front end for the blinkvault sidecar:
// start/stop the motion-capture daemon, watch a ~2s live snapshot, trigger a
// manual recording, browse/play/delete clips, tune capture config. First run
// shows a Blink login (email/password → 2FA PIN) — creds live in the sidecar.
// =============================================================================
import { useState, useEffect, useRef } from 'react'
import { api } from '@trunk/api'

const ACCENT = '#facc15'
const UP = '#22c55e', REC = '#ef4444'

const wrap = { maxWidth: 900, margin: '0 auto', padding: '2rem 1.25rem 4rem', boxSizing: 'border-box' }
const inp  = { fontFamily: 'inherit', fontSize: 14, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 8, color: 'inherit', padding: '10px 12px', outline: 'none', boxSizing: 'border-box', width: '100%' }
const lbl  = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary,#666)', marginBottom: 4, display: 'block' }
const btn  = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '8px 14px' }
const card = { background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, padding: 16 }

const fmtSize = (b) => b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`
const parseClip = (name) => {
  const m = name.match(/^(motion|manual)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/)
  if (!m) return { label: name, sub: '' }
  const [, type, yr, mo, dy, hr, mn, sc] = m
  const d = new Date(+yr, mo - 1, +dy, +hr, +mn, +sc)
  return {
    label: d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    sub: type === 'motion' ? '🎯 motion' : '⏺ manual',
  }
}

function Login({ onDone }) {
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState('creds')   // creds | 2fa
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const login = async () => {
    if (!user.trim() || !pass) return
    setBusy(true); setErr('')
    try {
      const r = await api.post('/blink/auth/login', { username: user.trim(), password: pass })
      if (r.pending_2fa) setStage('2fa'); else onDone()
    } catch (e) { setErr(String(e?.message || 'Login failed')) }
    finally { setBusy(false) }
  }
  const send2fa = async () => {
    if (!code.trim()) return
    setBusy(true); setErr('')
    try { await api.post('/blink/auth/2fa', { code: code.trim() }); onDone() }
    catch (e) { setErr(String(e?.message || '2FA failed')) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ ...card, maxWidth: 420, margin: '48px auto' }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Connect your Blink account</div>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary,#666)', marginBottom: 16 }}>
        Credentials are stored only in the capture container on this box.
      </div>
      {stage === 'creds' ? (
        <>
          <label style={lbl}>Email</label>
          <input style={{ ...inp, marginBottom: 12 }} value={user} autoComplete="off"
            onChange={e => setUser(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} />
          <label style={lbl}>Password</label>
          <input style={{ ...inp, marginBottom: 16 }} type="password" value={pass}
            onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} />
          <button style={{ ...btn, width: '100%', background: ACCENT, border: 'none', color: '#0f0f0f', fontWeight: 700 }}
            disabled={busy} onClick={login}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-secondary,#aaa)', marginBottom: 12 }}>
            Blink sent a PIN to your email/phone — enter it here.
          </div>
          <label style={lbl}>2FA PIN</label>
          <input style={{ ...inp, marginBottom: 16, letterSpacing: '0.3em', textAlign: 'center' }} value={code}
            inputMode="numeric" autoComplete="off"
            onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && send2fa()} />
          <button style={{ ...btn, width: '100%', background: ACCENT, border: 'none', color: '#0f0f0f', fontWeight: 700 }}
            disabled={busy} onClick={send2fa}>{busy ? 'Verifying…' : 'Verify'}</button>
        </>
      )}
      {err && <div style={{ color: 'var(--color-danger,#ef4444)', fontSize: 12, marginTop: 12 }}>{err}</div>}
    </div>
  )
}

function ClipRow({ c, onDel }) {
  const [open, setOpen] = useState(false)
  const { label, sub } = parseClip(c.name)
  return (
    <div style={{ background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 8, overflow: 'hidden' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer' }}>
        <span style={{ color: 'var(--text-tertiary,#666)', fontSize: 11, width: 12 }}>{open ? '▾' : '▸'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, color: 'var(--text-primary,#e8e6e0)' }}>{label}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary,#666)' }}>{sub} · {fmtSize(c.size)}</div>
        </div>
        <button onClick={e => { e.stopPropagation(); onDel(c) }} title="delete"
          style={{ background: 'none', border: 'none', color: 'var(--text-tertiary,#666)', fontSize: 16, cursor: 'pointer', padding: '2px 6px' }}>✕</button>
      </div>
      {open && (
        <video controls preload="metadata" style={{ width: '100%', display: 'block', background: '#000', maxHeight: 380 }}
          src={`/api/blink/clips/${c.name}`} />
      )}
    </div>
  )
}

// app-style home screen: every camera with its latest cloud thumbnail
function CameraGrid() {
  const [cams, setCams] = useState(null)
  const [err, setErr] = useState('')
  const [thumbKey, setThumbKey] = useState({})   // name → cache-bust counter
  const [snapping, setSnapping] = useState({})

  const load = () => api.get('/blink/cameras')
    .then(d => { setCams(d.cameras || []); setErr(d.error || '') })
    .catch(e => setErr(e.message))
  useEffect(() => { load() }, [])

  const snap = async (name) => {
    setSnapping(s => ({ ...s, [name]: true }))
    try {
      await api.post(`/blink/cameras/${encodeURIComponent(name)}/snap`)
      await new Promise(r => setTimeout(r, 6000))   // camera wakes + uploads
      setThumbKey(k => ({ ...k, [name]: (k[name] || 0) + 1 }))
      load()
    } catch (e) { setErr(e.message) }
    setSnapping(s => ({ ...s, [name]: false }))
  }

  if (err) return <div style={{ ...card, marginBottom: 20, color: 'var(--text-tertiary,#888)', fontSize: 13 }}>Cameras unavailable: {err}</div>
  if (!cams) return <div style={{ ...card, marginBottom: 20, color: 'var(--text-tertiary,#666)', fontSize: 13, fontFamily: 'monospace' }}>loading cameras…</div>

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, marginBottom: 20 }}>
      {cams.map(c => (
        <div key={c.name} style={{ ...card, padding: 10 }}>
          <img src={`/api/blink/cameras/${encodeURIComponent(c.name)}/thumb.jpg?t=${thumbKey[c.name] || 0}`}
            alt={c.name} loading="lazy"
            onError={e => { e.currentTarget.style.opacity = 0.25 }}
            style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 8,
                     background: '#000', display: 'block', opacity: snapping[c.name] ? 0.4 : 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 13, fontFamily: 'var(--font-mono,monospace)', fontWeight: 700 }}>{c.name}</span>
            <div style={{ flex: 1 }} />
            <span title="battery" style={{ fontSize: 12 }}>{c.battery === 'ok' ? '🔋' : c.battery ? '🪫' : ''}</span>
            {c.temperature != null && <span style={{ fontSize: 11, color: 'var(--text-tertiary,#888)', fontFamily: 'monospace' }}>{c.temperature}°</span>}
            <button style={{ ...btn, padding: '3px 8px', fontSize: 11 }} disabled={snapping[c.name]}
              title="take a fresh snapshot" onClick={() => snap(c.name)}>
              {snapping[c.name] ? '…' : '↻'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function BlinkPage() {
  const [s, setS] = useState(null)          // /blink/status payload
  const [offline, setOffline] = useState(false)
  const [cfg, setCfg] = useState(null)      // local edit copy
  const [snapKey, setSnapKey] = useState(0)
  const snapTimer = useRef(null)

  const load = () => api.get('/blink/status')
    .then(d => { setS(d); setOffline(false); setCfg(prev => prev ?? d.config) })
    .catch(() => setOffline(true))
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [])

  // live snapshot refresh while running
  useEffect(() => {
    clearInterval(snapTimer.current)
    if (s?.running) snapTimer.current = setInterval(() => setSnapKey(k => k + 1), 2500)
    return () => clearInterval(snapTimer.current)
  }, [s?.running])

  const act = async (a) => { try { await api.post(`/blink/daemon/${a}`) } catch {} ; load() }
  const saveCfg = async () => {
    try {
      await api.post('/blink/config', {
        clip_duration: +cfg.clip_duration || 30,
        motion_threshold: +cfg.motion_threshold || 10,
        cooldown: +cfg.cooldown || 60,
        camera_name: cfg.camera_name || '',
      })
    } catch {}
    load()
  }
  const delClip = async (c) => { if (!confirm(`Delete ${c.name}?`)) return; try { await api.del(`/blink/clips/${c.name}`) } catch {}; load() }

  if (offline) return (
    <div style={wrap}>
      <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 24, fontWeight: 700, marginBottom: 20 }}>📹 Blink</div>
      <div style={{ color: 'var(--text-secondary,#aaa)', fontSize: 14 }}>The capture container isn't reachable — is <code>thrive_blink</code> up?</div>
    </div>
  )
  if (!s) return <div style={wrap}><div style={{ color: 'var(--text-tertiary,#666)', fontFamily: 'monospace' }}>loading…</div></div>
  if (!s.authed) return <div style={wrap}><Login onDone={load} /></div>

  const dotColor = s.recording ? REC : s.running ? UP : 'var(--text-tertiary,#555)'

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 24, fontWeight: 700, letterSpacing: '0.05em' }}>📹 Blink</div>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: dotColor, boxShadow: s.running ? `0 0 8px ${dotColor}` : 'none' }} />
        <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-secondary,#aaa)' }}>
          {s.recording ? 'RECORDING' : s.running ? 'monitoring' : 'stopped'}
        </span>
        <div style={{ flex: 1 }} />
        {!s.running
          ? <button style={{ ...btn, color: UP, borderColor: UP }} onClick={() => act('start')}>▶ Start</button>
          : <>
              <button style={{ ...btn }} onClick={() => act('record')}>⏺ Record now</button>
              <button style={{ ...btn, color: REC, borderColor: REC }} onClick={() => act('stop')}>■ Stop</button>
            </>}
      </div>

      <CameraGrid />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
        <div style={card}>
          <div style={{ ...lbl, marginBottom: 10 }}>Live view</div>
          {s.running
            ? <img key={snapKey} src={`/api/blink/snapshot.jpg?t=${snapKey}`} alt=""
                onError={e => { e.currentTarget.style.opacity = 0.3 }}
                style={{ width: '100%', borderRadius: 8, background: '#000', display: 'block', minHeight: 120 }} />
            : <div style={{ padding: '40px 10px', textAlign: 'center', color: 'var(--text-tertiary,#555)', fontSize: 13 }}>Start monitoring to see the camera</div>}
        </div>

        <div style={card}>
          <div style={{ ...lbl, marginBottom: 10 }}>Capture config</div>
          {cfg && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label style={lbl}>Clip length (s)</label>
                <input style={inp} type="number" value={cfg.clip_duration} onChange={e => setCfg({ ...cfg, clip_duration: e.target.value })} /></div>
              <div><label style={lbl}>Sensitivity (lower = more)</label>
                <input style={inp} type="number" value={cfg.motion_threshold} onChange={e => setCfg({ ...cfg, motion_threshold: e.target.value })} /></div>
              <div><label style={lbl}>Cooldown (s)</label>
                <input style={inp} type="number" value={cfg.cooldown} onChange={e => setCfg({ ...cfg, cooldown: e.target.value })} /></div>
              <div><label style={lbl}>Camera {s.cameras?.length ? `(${s.cameras.join(', ')})` : ''}</label>
                <input style={inp} value={cfg.camera_name} placeholder="first found" onChange={e => setCfg({ ...cfg, camera_name: e.target.value })} /></div>
              <button style={{ ...btn, gridColumn: '1 / -1' }} onClick={saveCfg}>Save config</button>
            </div>
          )}
        </div>
      </div>

      {s.log?.length > 0 && (
        <div style={{ ...card, marginBottom: 20, maxHeight: 130, overflowY: 'auto' }}>
          <div style={{ ...lbl, marginBottom: 8 }}>Activity</div>
          {s.log.map((l, i) => <div key={i} style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-tertiary,#888)', lineHeight: 1.7 }}>{l}</div>)}
        </div>
      )}

      <div style={{ ...lbl, marginBottom: 10 }}>Clips ({s.clips?.length || 0})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(!s.clips || s.clips.length === 0) && <div style={{ color: 'var(--text-tertiary,#666)', fontSize: 13, padding: '20px 0' }}>No clips yet — motion events and manual records land here.</div>}
        {(s.clips || []).map(c => <ClipRow key={c.name} c={c} onDel={delClip} />)}
      </div>
    </div>
  )
}
