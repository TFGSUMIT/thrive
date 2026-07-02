// =============================================================================
// SettingsPage.jsx — Platform settings (account, modules)
// thrive UI — user management lives on its own page (UsersPage / 👥)
// =============================================================================
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'
import { THEMES, applyTheme, DEFAULT_THEME } from '../theme'
import EmojiPicker from '../components/EmojiPicker'
import PasswordInput from '../components/PasswordInput'
import { MODULES } from '../moduleRegistry'

const PASSWORD_MIN = 18   // keep in sync with auth.py (#9)

const card = { background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }
const head = { padding: '12px 16px', borderBottom: '1px solid var(--border-color,#2a2a2a)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#666)' }
const body = { padding: 16 }
const btnS = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '6px 12px' }
const btnP = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', background: 'var(--text-primary,#e8e6e0)', border: 'none', borderRadius: 6, color: 'var(--bg-primary,#0f0f0f)', fontWeight: 500, cursor: 'pointer', padding: '8px 16px' }
const inp  = { fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '7px 10px', outline: 'none', width: '100%', boxSizing: 'border-box' }
const lbl  = { fontSize: 10, color: 'var(--text-tertiary,#666)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }

function Badge({ kind }) {
  const map = { admin: { bg: 'var(--accent-muted)', c: 'var(--accent)' }, member: { bg: 'var(--info-muted)', c: 'var(--color-info)' }, disabled: { bg: 'var(--danger-muted)', c: 'var(--color-danger)' } }
  const s = map[kind] || map.member
  return <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 4, background: s.bg, color: s.c, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{kind}</span>
}

// iOS-style toggle switch + a small labelled wrapper
function Switch({ on, onChange, disabled, color = 'var(--color-success)' }) {
  return (
    <button role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      style={{ width: 34, height: 20, borderRadius: 999, border: 'none', padding: 0, flexShrink: 0,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
        background: on ? color : 'var(--bg-tertiary,#333)', position: 'relative', transition: 'background 0.15s' }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: '50%',
        background: '#fff', transition: 'left 0.15s' }} />
    </button>
  )
}
function SwitchField({ label, on, onChange, disabled, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <Switch on={on} onChange={onChange} disabled={disabled} color={color} />
      <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary,#666)' }}>{label}</span>
    </div>
  )
}

// Collapsible settings card. Open/closed state is remembered per-title in
// localStorage. `right` header controls only show when expanded.
// Responds to the page-wide `thrive:settings-cards` broadcast so the header's
// Collapse-all / Expand-all can fold/unfold every card at once (persisting each).
function CollapsibleCard({ title, right, defaultOpen = true, children }) {
  const key = `settings.open.${title}`
  const setPersisted = (n) => { try { localStorage.setItem(key, n ? '1' : '0') } catch {} }
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === '1' } catch { return defaultOpen }
  })
  const toggle = () => setOpen(o => { const n = !o; setPersisted(n); return n })
  useEffect(() => {
    const onBroadcast = (e) => { const n = !!e.detail?.open; setPersisted(n); setOpen(n) }
    window.addEventListener('thrive:settings-cards', onBroadcast)
    return () => window.removeEventListener('thrive:settings-cards', onBroadcast)
  }, [key])
  return (
    <div style={card}>
      <div onClick={toggle}
        style={{ ...head, borderBottom: open ? '1px solid var(--border-color,#2a2a2a)' : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, display: 'inline-block', transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
          {title}
        </span>
        {open && right && <span onClick={e => e.stopPropagation()}>{right}</span>}
      </div>
      {open && children}
    </div>
  )
}

function ModuleRow({ m, i, saving, editable, onIcon, onColor, children }) {
  return (
    <div style={{ padding: '12px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--border-color,#2a2a2a)', display: 'flex', alignItems: 'center', gap: 12, opacity: m.installed ? 1 : 0.7 }}>
      {editable
        ? <EmojiPicker value={m.icon || '📦'} color={m.color} size={34}
            onChange={em => onIcon(m, em)} onColor={c => onColor(m, c)} />
        : <span style={{ fontSize: 20 }}>{m.icon || '📦'}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name} <span style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', fontFamily: 'monospace' }}>v{m.version}</span></div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary,#888)', marginTop: 2 }}>{m.description}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{children}</div>
    </div>
  )
}

function GroupHead({ children }) {
  return <div style={{ padding: '8px 16px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#555)', background: 'var(--bg-tertiary,#222)' }}>{children}</div>
}

// Subheading for sections grouped inside one CollapsibleCard (e.g. the Device
// card stacks Power / Wi-Fi / UI / module panels under these bars).
function SubHead({ children }) {
  return <div style={{ padding: '9px 16px', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-secondary,#999)', background: 'var(--bg-tertiary,#1e1e1e)', borderTop: '1px solid var(--border-color,#2a2a2a)' }}>{children}</div>
}

// Front page: the server-wide choice of what loads at '/' (a module's page, or
// the module tiles). Unset = auto: the only active module if there's just one,
// else Home, else tiles. Admin-controlled.
function FrontPageSection() {
  const [modules, setModules] = useState([])
  const [front,   setFront]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)

  useEffect(() => {
    Promise.all([api.get('/modules'), api.get('/settings').catch(() => ({}))])
      .then(([ms, s]) => { setModules(Array.isArray(ms) ? ms : []); setFront(s?.front_page || '') })
      .catch(() => {})
  }, [])

  const navMods = modules.filter(m => m.installed && m.enabled && m.nav_path)
  const defaultLabel = navMods.length === 1 ? navMods[0].name
    : (navMods.find(m => m.id === 'home') ? 'Home' : 'Module tiles')

  const save = async (val) => {
    setFront(val); setSaving(true); setSaved(false)
    try { await api.patch('/settings', { front_page: val }); setSaved(true); setTimeout(() => setSaved(false), 1500) }
    catch {} finally { setSaving(false) }
  }

  return (
    <>
      <SubHead>Front page</SubHead>
      <div style={body}>
      <label style={{ ...lbl, display: 'block' }}>Loads at start</label>
      <select value={front} onChange={e => save(e.target.value)} style={{ ...inp, fontSize: 12 }}>
        <option value="">Default · {defaultLabel}</option>
        {navMods.map(m => <option key={m.id} value={m.id}>{m.icon || '📦'} {m.name}</option>)}
        <option value="landing">▦ Module tiles (landing page)</option>
      </select>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', marginTop: 6 }}>
        What thrive opens first at <code style={{ fontFamily: 'monospace' }}>/</code>.
        {saving && ' Saving…'}{saved && ' Saved ✓'}
      </div>
    </div>
    </>
  )
}

const UI_ALPHA_KEY = 'thrive:uiAlpha'
const UI_SCALE_KEY = 'thrive:uiScale'

function UISection() {
  const { user, updatePrefs } = useAuth()
  const theme = user?.prefs?.theme || DEFAULT_THEME
  const [savingTheme, setSavingTheme] = useState(false)

  // optimistic: paint the theme instantly, then persist to the account so it
  // follows the login across devices
  const changeTheme = async (id) => {
    applyTheme(id)
    setSavingTheme(true)
    try { await updatePrefs({ theme: id }) } catch {} finally { setSavingTheme(false) }
  }

  const [alpha, setAlpha] = useState(() => {
    const v = parseFloat(localStorage.getItem(UI_ALPHA_KEY))
    return isNaN(v) ? 1 : v
  })
  const apply = (v) => {
    setAlpha(v)
    document.documentElement.style.setProperty('--ui-alpha', String(v))
    try { localStorage.setItem(UI_ALPHA_KEY, String(v)) } catch {}
  }

  const [scale, setScale] = useState(() => {
    const v = parseFloat(localStorage.getItem(UI_SCALE_KEY))
    return isNaN(v) || v <= 0 ? 1 : v
  })
  const applyScale = (v) => {
    setScale(v)
    document.documentElement.style.zoom = String(v)
    try { localStorage.setItem(UI_SCALE_KEY, String(v)) } catch {}
  }

  // this device's LAN IP (public /system/info) — handy for finding/SSH-ing a kiosk
  const [device, setDevice] = useState(null)
  useEffect(() => { api.get('/system/info').then(setDevice).catch(() => {}) }, [])

  return (
    <>
      <SubHead>UI</SubHead>
      <div style={body}>
      <div style={lbl}>Theme</div>
      <select style={inp} value={theme} onChange={e => changeTheme(e.target.value)} disabled={!user}>
        {THEMES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', marginTop: 6 }}>
        Saved to your account — follows you on every device.{savingTheme && ' Saving…'}
      </div>

      <div style={{ ...lbl, display: 'flex', justifyContent: 'space-between', marginTop: 18 }}
        title="Lower to let the background show through panels & nav.">
        <span>UI opacity</span>
        <b style={{ color: 'var(--text-secondary,#aaa)' }}>{Math.round(alpha * 100)}%</b>
      </div>
      <input type="range" min="0.3" max="1" step="0.01" value={alpha}
        title="Lower to let the background show through panels & nav."
        onChange={e => apply(parseFloat(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)' }} />

      <div style={{ ...lbl, display: 'flex', justifyContent: 'space-between', marginTop: 18 }}
        title="Zoom the whole interface — handy on a wall/kiosk display.">
        <span>UI scale</span>
        <b style={{ color: 'var(--text-secondary,#aaa)' }}>{Math.round(scale * 100)}%</b>
      </div>
      <input type="range" min="0.5" max="2" step="0.05" value={scale}
        title="Zoom the whole interface — handy on a wall/kiosk display."
        onChange={e => applyScale(parseFloat(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <button style={{ ...btnS, padding: '3px 9px', fontSize: 10 }} onClick={() => applyScale(1)}>Reset</button>
      </div>

      <div style={{ ...lbl, marginTop: 18 }}>This device</div>
      <div style={{ fontSize: 13, fontFamily: 'monospace', color: 'var(--text-secondary,#aaa)' }}>
        {device?.device_ip
          ? <>{device.device_ip}{device.hostname ? <span style={{ color: 'var(--text-tertiary,#666)' }}> · {device.hostname}</span> : null}</>
          : <span style={{ color: 'var(--text-tertiary,#666)' }}>IP unavailable</span>}
      </div>
    </div>
    </>
  )
}

function ModulesSection() {
  const { user }                = useAuth()
  const isAdmin                 = user?.role === 'admin'
  const [modules,  setModules]  = useState([])
  const [saving,   setSaving]   = useState(null)

  useEffect(() => {
    api.get('/modules').then(setModules).catch(() => {})
  }, [])

  // change a module's icon (admin only); takes effect immediately in nav + landing
  const setIcon = async (m, icon) => {
    try {
      await api.patch(`/modules/${m.id}`, { icon })
      setModules(prev => prev.map(x => x.id === m.id ? { ...x, icon } : x))
      window.dispatchEvent(new CustomEvent('thrive:modules-changed'))
    } catch {}
  }

  // change a module's color — preview live in the row; debounce the write +
  // nav refresh so dragging the native colour picker doesn't spam the API.
  const colorTimers = useRef({})
  const setColor = (m, color) => {
    setModules(prev => prev.map(x => x.id === m.id ? { ...x, color } : x))
    clearTimeout(colorTimers.current[m.id])
    colorTimers.current[m.id] = setTimeout(async () => {
      try { await api.patch(`/modules/${m.id}`, { color }); window.dispatchEvent(new CustomEvent('thrive:modules-changed')) } catch {}
    }, 300)
  }

  // core modules (e.g. platform infra) aren't shown as installable/toggleable here.
  const visible   = modules.filter(m => !m.core)
  const installed = visible.filter(m => m.installed)
  const available = visible.filter(m => !m.installed)

  const patch = async (m, fields) => {
    setSaving(m.id)
    try {
      await api.patch(`/modules/${m.id}`, fields)
      setModules(prev => prev.map(x => x.id === m.id ? { ...x, ...fields } : x))
      // let the top bar + landing hub refresh their module lists live
      window.dispatchEvent(new CustomEvent('thrive:modules-changed'))
    } catch {}
    finally { setSaving(null) }
  }

  const install   = (m) => patch(m, { installed: true,  enabled: true })
  const uninstall = (m) => patch(m, { installed: false, enabled: false })
  const toggle    = (m) => patch(m, { enabled: !m.enabled })

  if (visible.length === 0) return (
    <div style={{ ...body, fontSize: 12, color: 'var(--text-tertiary,#666)', lineHeight: 1.8 }}>
      No modules discovered. Clone a module into <code style={{ fontFamily: 'monospace', fontSize: 11 }}>modules/</code> and restart the API.
    </div>
  )

  return (
    <div>
      {!isAdmin && (
        <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-tertiary,#888)', lineHeight: 1.6 }}>
          Installing &amp; toggling modules is admin-only. Switch to an admin profile to manage them.
        </div>
      )}
      {installed.length > 0 && <GroupHead>Installed</GroupHead>}
      {installed.map((m, i) => (
        <ModuleRow key={m.id} m={m} i={i} saving={saving} editable={isAdmin} onIcon={setIcon} onColor={setColor}>
          <SwitchField label="On" on={m.enabled} disabled={!isAdmin || saving === m.id}
            onChange={() => toggle(m)} color="var(--color-success,#22c55e)" />
          <SwitchField label="Installed" on={true} disabled={!isAdmin || saving === m.id}
            onChange={() => uninstall(m)} color="var(--accent)" />
        </ModuleRow>
      ))}

      {available.length > 0 && <GroupHead>Available</GroupHead>}
      {available.map((m, i) => (
        <ModuleRow key={m.id} m={m} i={i} saving={saving} editable={isAdmin} onIcon={setIcon} onColor={setColor}>
          <SwitchField label="Install" on={false} disabled={!isAdmin || saving === m.id}
            onChange={() => install(m)} color="var(--accent)" />
        </ModuleRow>
      ))}

      <div style={{ padding: '10px 16px', fontSize: 10, color: 'var(--text-tertiary,#555)', lineHeight: 1.6, borderTop: '1px solid var(--border-color,#2a2a2a)' }}>
        Changes take effect after API restart. Add new modules by cloning into <code style={{ fontFamily: 'monospace' }}>modules/</code>.
      </div>
    </div>
  )
}

// ── Change my password (#9) — self-service for any account-backed identity ────
function ChangePasswordSection() {
  const [cur,  setCur]  = useState('')
  const [pw,   setPw]   = useState('')
  const [pw2,  setPw2]  = useState('')
  const [err,  setErr]  = useState(null)
  const [ok,   setOk]   = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setErr(null); setOk(false)
    if (!cur)                 { setErr('Enter your current password'); return }
    if (pw.length < PASSWORD_MIN) { setErr(`New password must be at least ${PASSWORD_MIN} characters`); return }
    if (pw !== pw2)           { setErr('New passwords do not match'); return }
    if (pw === cur)           { setErr('New password must differ from the current one'); return }
    setBusy(true)
    try {
      await api.patch('/auth/me/password', { old_password: cur, new_password: pw })
      setCur(''); setPw(''); setPw2(''); setOk(true)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <CollapsibleCard title="Change password" defaultOpen={false}>
      <div style={{ ...body, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
        <div style={lbl}>Current password</div>
        <PasswordInput style={inp} placeholder="Current password" value={cur} autoComplete="current-password"
          onChange={e => { setCur(e.target.value); setOk(false) }} />
        <div style={{ ...lbl, marginTop: 4 }}>New password (min {PASSWORD_MIN})</div>
        <PasswordInput style={inp} placeholder={`New password (min ${PASSWORD_MIN})`} value={pw} autoComplete="new-password"
          onChange={e => { setPw(e.target.value); setOk(false) }} />
        <PasswordInput style={inp} placeholder="Repeat new password" value={pw2} autoComplete="new-password"
          onChange={e => { setPw2(e.target.value); setOk(false) }} />
        {err && <div style={{ fontSize: 12, color: 'var(--color-danger,#ef4444)' }}>{err}</div>}
        {ok  && <div style={{ fontSize: 12, color: 'var(--color-success,#22c55e)' }}>Password updated — other devices were signed out.</div>}
        <div><button style={{ ...btnP, marginTop: 4, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>Update password</button></div>
      </div>
    </CollapsibleCard>
  )
}

function AccountsSection() {
  const { user, logout }      = useAuth()
  const [accounts, setAccounts] = useState([])
  const [profiles, setProfiles] = useState([])
  const [adding,   setAdding]   = useState(false)
  const [nu,       setNu]       = useState({ username: '', password: '', role: 'member', user_id: '' })
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState(null)
  const [rowUi,    setRowUi]    = useState({})
  const [resetPw,  setResetPw]  = useState({})
  const [resetPw2, setResetPw2] = useState({})
  const setRow = (id, patch) => setRowUi(p => ({ ...p, [id]: { ...p[id], ...patch } }))

  const load = async () => {
    try {
      const [a, p] = await Promise.all([api.get('/accounts'), api.get('/users').catch(() => [])])
      setAccounts(a); setProfiles(p)
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load() }, [])

  const profileName = (id) => profiles.find(p => p.id === id)?.name

  const add = async () => {
    if (!nu.username || !nu.password) { setErr('Username and password required'); return }
    if (nu.password.length < 8) { setErr('Password must be at least 8 characters'); return }
    setSaving(true); setErr(null)
    try {
      await api.post('/accounts', { ...nu, user_id: nu.user_id ? Number(nu.user_id) : null })
      setNu({ username: '', password: '', role: 'member', user_id: '' }); setAdding(false); load()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }
  const changeRole    = async (id, role)     => { try { await api.patch(`/accounts/${id}/role`,     { role });     load() } catch (e) { setErr(e.message) } }
  const toggleDisable = async (id, disabled) => { try { await api.patch(`/accounts/${id}/disabled`, { disabled }); load() } catch (e) { setErr(e.message) } }
  const linkUser      = async (id, user_id)  => { try { await api.patch(`/accounts/${id}/user`,     { user_id: user_id ? Number(user_id) : null }); load() } catch (e) { setErr(e.message) } }
  const makeHead      = async (id)           => { try { await api.patch(`/accounts/${id}/head`, {}); load() } catch (e) { setErr(e.message) } }
  const doReset       = async (id)           => { const pw = resetPw[id] || ''; const pw2 = resetPw2[id] || ''; if (pw.length < PASSWORD_MIN) { setErr(`Min ${PASSWORD_MIN} chars`); return }; if (pw !== pw2) { setErr('Passwords do not match'); return }; setErr(null); try { await api.patch(`/accounts/${id}/password`, { password: pw }); setResetPw(p => ({ ...p, [id]: '' })); setResetPw2(p => ({ ...p, [id]: '' })); setRow(id, { resetting: false }) } catch (e) { setErr(e.message) } }
  const doDelete      = async (id)           => { try { await api.del(`/accounts/${id}`); load() } catch (e) { setErr(e.message) } }

  return (
    <CollapsibleCard title="Accounts"
      right={!adding && <button style={{ ...btnP, padding: '4px 12px', fontSize: 10 }} onClick={() => { setAdding(true); setErr(null) }}>+ Add</button>}>

      {err && <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--color-danger,#ef4444)' }}>{err}</div>}

      {adding && (
        <div style={{ padding: 16, borderBottom: '1px solid var(--border-color,#2a2a2a)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <div style={{ marginBottom: 10 }}>
              <div style={lbl}>Username</div>
              <input style={inp} value={nu.username} onChange={e => setNu(p => ({ ...p, username: e.target.value }))} autoComplete="off" />
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={lbl}>Role</div>
              <select style={inp} value={nu.role} onChange={e => setNu(p => ({ ...p, role: e.target.value }))}><option value="member">member</option><option value="admin">admin</option></select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={lbl}>Temp password (min 8)</div>
              <input style={inp} type="text" value={nu.password} onChange={e => setNu(p => ({ ...p, password: e.target.value }))} autoComplete="off" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={lbl}>Linked user</div>
              <select style={inp} value={nu.user_id} onChange={e => setNu(p => ({ ...p, user_id: e.target.value }))}>
                <option value="">— none —</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button style={btnS} onClick={() => { setAdding(false); setErr(null) }}>Cancel</button>
            <button style={{ ...btnP, opacity: saving ? 0.5 : 1 }} onClick={add} disabled={saving}>{saving ? 'Adding…' : '✦ Create'}</button>
          </div>
        </div>
      )}

      {accounts.map((a, i) => {
        const ui = rowUi[a.id] || {}
        const isSelf = user && a.id === user.id
        const isHead = !!a.is_head
        const activeAdmins = accounts.filter(x => x.role === 'admin' && !x.disabled).length
        const isLastAdmin = a.role === 'admin' && !a.disabled && activeAdmins <= 1
        const locked = isLastAdmin || isHead   // can't demote/disable the last admin or the Head
        return (
          <div key={a.id} style={{ padding: '12px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--border-color,#2a2a2a)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {isSelf && <span title="signed in" style={{ marginRight: 4 }}>🔑</span>}
                <span style={{ fontSize: 13, fontWeight: 500, marginRight: 8 }}>{a.username}</span>
                <Badge kind={a.role} />
                {isHead && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'var(--accent-muted)', color: 'var(--accent)', marginLeft: 6, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>👑 Head of Household</span>}
                {a.disabled ? <> <Badge kind="disabled" /></> : null}
                {isSelf && <span style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', marginLeft: 6 }}>(you)</span>}
                <div style={{ fontSize: 11, color: 'var(--text-tertiary,#888)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>logs in as</span>
                  <select style={{ ...inp, width: 'auto', padding: '3px 6px', fontSize: 11 }} value={a.user_id || ''} onChange={e => linkUser(a.id, e.target.value)}>
                    <option value="">— no profile —</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {isSelf && <button style={{ ...btnS, padding: '3px 9px', fontSize: 10 }} onClick={logout}>Sign out</button>}
                {!isHead && !a.disabled && <button style={{ ...btnS, padding: '3px 9px', fontSize: 10 }} title="Make this the household's primary login (Head of Household)" onClick={() => makeHead(a.id)}>Make Head</button>}
                <button style={{ ...btnS, padding: '3px 9px', fontSize: 10, opacity: locked ? 0.4 : 1, cursor: locked ? 'not-allowed' : 'pointer' }}
                  disabled={locked} title={isHead ? 'Reassign Head of Household first' : (isLastAdmin ? "Can't remove the last admin" : '')}
                  onClick={() => changeRole(a.id, a.role === 'admin' ? 'member' : 'admin')}>{a.role === 'admin' ? 'Make member' : 'Make admin'}</button>
                <button style={{ ...btnS, padding: '3px 9px', fontSize: 10, opacity: locked ? 0.4 : 1, cursor: locked ? 'not-allowed' : 'pointer' }}
                  disabled={locked} title={isHead ? "Can't disable the Head of Household" : (isLastAdmin ? "Can't disable the last admin" : '')}
                  onClick={() => toggleDisable(a.id, !a.disabled)}>{a.disabled ? 'Enable' : 'Disable'}</button>
                <button style={{ ...btnS, padding: '3px 9px', fontSize: 10 }} onClick={() => setRow(a.id, { resetting: !ui.resetting })}>Reset pw</button>
                {!isHead && (ui.confirmDelete
                  ? <><button style={{ ...btnS, padding: '3px 9px', fontSize: 10, color: 'var(--color-danger,#ef4444)', borderColor: 'var(--color-danger,#ef4444)' }} onClick={() => doDelete(a.id)}>Confirm</button><button style={{ ...btnS, padding: '3px 9px', fontSize: 10 }} onClick={() => setRow(a.id, { confirmDelete: false })}>No</button></>
                  : <button style={{ ...btnS, padding: '3px 9px', fontSize: 10, color: 'var(--color-danger,#ef4444)', borderColor: 'transparent' }} onClick={() => setRow(a.id, { confirmDelete: true })}>Delete</button>)}
              </div>
            </div>
            {ui.resetting && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                <PasswordInput wrapStyle={{ flex: '1 1 160px' }} style={inp} placeholder={`New password (min ${PASSWORD_MIN})`} value={resetPw[a.id] || ''} onChange={e => setResetPw(p => ({ ...p, [a.id]: e.target.value }))} autoComplete="new-password" />
                <PasswordInput wrapStyle={{ flex: '1 1 160px' }} style={inp} placeholder="Repeat new password" value={resetPw2[a.id] || ''} onChange={e => setResetPw2(p => ({ ...p, [a.id]: e.target.value }))} autoComplete="new-password" />
                <button style={{ ...btnP, padding: '7px 12px' }} onClick={() => doReset(a.id)}>Set</button>
                <button style={btnS} onClick={() => setRow(a.id, { resetting: false })}>Cancel</button>
              </div>
            )}
          </div>
        )
      })}
    </CollapsibleCard>
  )
}

// ── Permissions matrix (#7 Phase B) — admin-only ──────────────────────────────
const PERM_LEVELS = ['none', 'view', 'read', 'write']
const PERM_LABEL  = { none: '—', view: 'View', read: 'Read', write: 'Write' }
const permChip = (lvl) => {
  const m = {
    none:  { bg: 'none', c: 'var(--text-tertiary,#666)', b: 'var(--border-color,#2a2a2a)' },
    view:  { bg: 'var(--info-muted)',   c: 'var(--color-info)',    b: 'var(--color-info)' },
    read:  { bg: 'var(--accent-muted)', c: 'var(--accent)',        b: 'var(--accent)' },
    write: { bg: 'rgba(34,197,94,0.16)', c: 'var(--color-success,#22c55e)', b: 'var(--color-success,#22c55e)' },
  }[lvl]
  return { width: 48, padding: '4px 0', borderRadius: 5, fontSize: 9, fontWeight: 600, textTransform: 'uppercase',
           letterSpacing: '0.04em', cursor: 'pointer', border: `1px solid ${m.b}`, background: m.bg, color: m.c }
}

function PermissionsSection() {
  const [data, setData] = useState(null)   // { modules:[id], subjects:[{user_id,name,access}] }
  const [err,  setErr]  = useState(null)
  useEffect(() => { api.get('/permissions').then(setData).catch(e => setErr(e.message)) }, [])
  if (!data) return null

  const cycle = async (subj, mid) => {
    const cur = subj.access[mid] || 'none'
    const next = PERM_LEVELS[(PERM_LEVELS.indexOf(cur) + 1) % PERM_LEVELS.length]
    setData(d => ({ ...d, subjects: d.subjects.map(s => s.user_id === subj.user_id
      ? { ...s, access: { ...s.access, [mid]: next } } : s) }))
    try { await api.put('/permissions', { user_id: subj.user_id, module_id: mid, level: next }); window.dispatchEvent(new Event('thrive:modules-changed')) }
    catch (e) { setErr(e.message) }
  }

  return (
    <CollapsibleCard title="Permissions">
      <div style={{ padding: '12px 16px 4px', fontSize: 11, color: 'var(--text-tertiary,#888)' }}>
        Who can see &amp; use each module. Admins always have full access; everyone else starts locked out. Tap a cell to cycle —/View/Read/Write.
      </div>
      {err && <div style={{ padding: '0 16px 8px', fontSize: 12, color: 'var(--color-danger,#ef4444)' }}>{err}</div>}
      <div style={{ overflowX: 'auto', padding: '8px 16px 16px' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-tertiary,#666)', fontWeight: 500 }}>Profile</th>
              {data.modules.map(mid => (
                <th key={mid} style={{ padding: '4px 4px', color: 'var(--text-tertiary,#666)', fontWeight: 500, height: 78, verticalAlign: 'bottom' }}>
                  <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', margin: '0 auto', fontFamily: 'var(--font-mono,monospace)' }}>{mid}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.subjects.map(subj => (
              <tr key={subj.user_id} style={{ borderTop: '1px solid var(--border-color,#2a2a2a)' }}>
                <td style={{ padding: '5px 8px', whiteSpace: 'nowrap', fontWeight: 500 }}>
                  {subj.user_id === 0 ? '🏠 Household' : subj.name}
                  {subj.is_admin && <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--text-tertiary,#666)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>admin</span>}
                </td>
                {data.modules.map(mid => {
                  const lvl = subj.is_admin ? 'write' : (subj.access[mid] || 'none')
                  return (
                    <td key={mid} style={{ padding: 2, textAlign: 'center' }}>
                      {subj.is_admin
                        ? <span title="Admins always have full access" style={{ ...permChip('write'), display: 'inline-block', opacity: 0.5, cursor: 'default' }}>{PERM_LABEL.write}</span>
                        : <button onClick={() => cycle(subj, mid)} title={`${subj.name} · ${mid}: ${lvl}`} style={permChip(lvl)}>{PERM_LABEL[lvl]}</button>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleCard>
  )
}


// ── Wi-Fi setup (#83) — thriveOS appliance only, admin-only ───────────────────
// Self-hides everywhere the host Wi-Fi helper isn't wired (bare/NAS/amd64): the
// API reports available:false and this renders nothing. Scan/connect/forget go
// through the same host request-file channel as Power; status is polled.
function signalBars(dbm) {
  if (dbm == null) return 0
  if (dbm >= -55) return 4
  if (dbm >= -65) return 3
  if (dbm >= -75) return 2
  return 1
}
// Signal-strength colour: green (strong) → yellow (ok) → red (weak).
function barColor(dbm) {
  const n = signalBars(dbm)
  if (n >= 3) return 'var(--color-success,#22c55e)'
  if (n === 2) return 'var(--color-warning,#eab308)'
  return 'var(--color-danger,#ef4444)'
}
function Bars({ dbm }) {
  const n = signalBars(dbm)
  const c = barColor(dbm)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 1, height: 12 }}
      title={dbm != null ? `${dbm} dBm signal` : 'unknown signal'}>
      {[4, 8, 11].map((h, i) => (
        <span key={i} style={{ width: 3, height: h, borderRadius: 1,
          background: i < n ? c : 'var(--bg-tertiary,#333)' }} />
      ))}
    </span>
  )
}

function WifiSection() {
  const [info,     setInfo]     = useState(null)   // { available, is_admin, status }
  const [scan,     setScan]     = useState(null)   // { networks, updated }
  const [scanning, setScanning] = useState(false)
  const [sel,      setSel]      = useState(null)   // ssid being joined
  const [pw,       setPw]       = useState('')
  const [busy,     setBusy]     = useState(false)
  const [msg,      setMsg]      = useState(null)

  const loadStatus = () => api.get('/system/wifi').then(setInfo).catch(() => setInfo({ available: false }))
  useEffect(() => {
    loadStatus()
    const t = setInterval(loadStatus, 8000)   // live-ish link state from the host timer
    return () => clearInterval(t)
  }, [])

  if (!info || !info.available || !info.is_admin) return null
  const st = info.status || {}

  // Kick a scan, then poll results until the `updated` stamp advances (or timeout).
  const runScan = async () => {
    setMsg(null); setScanning(true); setSel(null)
    const before = scan?.updated || null
    try {
      await api.post('/system/wifi/scan', {})
      for (let i = 0; i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500))
        const res = await api.get('/system/wifi/scan').catch(() => null)
        if (res && res.updated && res.updated !== before) { setScan(res); break }
        if (i === 7) setScan(res || { networks: [] })
      }
    } catch (e) { setMsg(e.message) } finally { setScanning(false) }
  }

  const connect = async (ssid, secured) => {
    if (secured && !pw) { setMsg('Enter the network password'); return }
    setBusy(true); setMsg(`Connecting to ${ssid}…`); setSel(null); setPw('')
    try {
      await api.post('/system/wifi/connect', { ssid, psk: secured ? pw : '' })
      // poll until the host reports it associated + got an IP, then tidy up:
      // clear the status message and collapse the scan list (window shrinks).
      let joined = false
      for (let i = 0; i < 8; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const s = await api.get('/system/wifi').catch(() => null)
        if (s) setInfo(s)
        if (s?.status?.connected && s.status.ssid === ssid) { joined = true; break }
      }
      if (joined) { setMsg(null); setScan(null) }
      else setMsg('Still connecting… give it a moment.')
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const forget = async () => {
    setBusy(true); setMsg(null)
    try { await api.post('/system/wifi/forget', {}); setMsg('Disconnected.'); await loadStatus() }
    catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const nets = scan?.networks || []

  return (
    <>
      <SubHead>Wi-Fi</SubHead>
      <div style={{ ...body, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* current link state */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
            {st.connected
              ? <><Bars dbm={st.signal_dbm} /><span><b>{st.ssid}</b>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary,#888)', marginLeft: 8, fontFamily: 'monospace' }}>
                    {st.ip || 'no IP yet'}{st.signal_dbm != null ? ` · ${st.signal_dbm} dBm` : ''}
                  </span></span></>
              : <span style={{ color: 'var(--text-secondary,#aaa)' }}>Not connected
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary,#666)', marginLeft: 8, fontFamily: 'monospace' }}>{st.interface || 'wlan'}</span></span>}
          </div>
          {st.connected && <button style={{ ...btnS, padding: '4px 10px', fontSize: 10 }} disabled={busy} onClick={forget}>Forget</button>}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={{ ...btnS, opacity: scanning ? 0.6 : 1 }} disabled={scanning || busy} onClick={runScan}>
            {scanning ? 'Scanning…' : '⟳ Scan networks'}
          </button>
          {scan?.updated && !scanning && <span style={{ fontSize: 10, color: 'var(--text-tertiary,#666)' }}>{nets.length} found</span>}
        </div>

        {/* results */}
        {nets.length > 0 && (
          <div style={{ border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 8, overflow: 'hidden' }}>
            {nets.map((n, i) => {
              const active = sel === n.ssid
              const here = st.connected && st.ssid === n.ssid
              return (
                <div key={n.ssid + i} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-color,#2a2a2a)' }}>
                  <div onClick={() => { setSel(active ? null : n.ssid); setPw(''); setMsg(null) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer' }}>
                    <Bars dbm={n.signal} />
                    <span style={{ flex: 1, fontSize: 13 }}>{n.ssid}{here && <span style={{ fontSize: 10, color: 'var(--color-success,#22c55e)', marginLeft: 8 }}>connected</span>}</span>
                    {n.secured && <span title="secured" style={{ fontSize: 11, color: 'var(--text-tertiary,#888)' }}>🔒</span>}
                  </div>
                  {active && !here && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 12px 12px' }}>
                      {n.secured && (
                        <PasswordInput wrapStyle={{ flex: '1 1 180px' }} style={inp} placeholder={`Password for ${n.ssid}`}
                          value={pw} autoComplete="off" onChange={e => setPw(e.target.value)} />
                      )}
                      <button style={{ ...btnP, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => connect(n.ssid, n.secured)}>
                        {busy ? 'Connecting…' : 'Connect'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {msg && <div style={{ fontSize: 12, color: 'var(--text-secondary,#aaa)' }}>{msg}</div>}
      </div>
    </>
  )
}

// ── Power controls (#39) — thriveOS appliance only, admin-only ────────────────
// Hidden everywhere the host watcher isn't wired (e.g. bare/NAS prod): the API
// reports available:false and this renders nothing. The buttons drop a request
// file the host-side thrive-power.service executes.
const POWER_BTNS = [
  { action: 'reboot',         tip: 'Reboot',         danger: true,  confirm: 'Reboot this device now?' },
  { action: 'poweroff',       tip: 'Shut down',      danger: true,  confirm: 'Shut down this device? It needs a physical power-cycle to come back.' },
  { action: 'restart-stack',  tip: 'Restart thrive', danger: false, confirm: 'Restart the thrive app? The UI will blink for a few seconds.' },
  { action: 'relaunch-kiosk', tip: 'Relaunch kiosk', danger: false, confirm: 'Relaunch the kiosk display?' },
]

// Clean inline (lucide-style) glyphs so the Power controls read as one consistent
// icon set rather than a mix of text symbols + emoji. Keyed by action.
const POWER_ICONS = {
  reboot:           <path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4" />,                                  // rotate-cw arrow
  poweroff:         <><line x1="12" y1="2" x2="12" y2="12" /><path d="M18.36 6.64a9 9 0 1 1-12.73 0" /></>, // power symbol
  'restart-stack':  <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v4h-4" /><path d="M12 8v4l2 2" /></>, // refresh + clock hand (app)
  'relaunch-kiosk': <><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></>, // monitor
}
function PowerIcon({ action }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {POWER_ICONS[action]}
    </svg>
  )
}

function PowerSection() {
  const [info, setInfo]             = useState(null)
  const [busy, setBusy]             = useState(null)
  const [msg,  setMsg]              = useState(null)
  const [confirming, setConfirming] = useState(null)

  useEffect(() => { api.get('/system/power').then(setInfo).catch(() => setInfo({ available: false })) }, [])
  if (!info || !info.available || !info.is_admin) return null

  const run = async (action) => {
    setConfirming(null); setBusy(action); setMsg(null)
    try {
      await api.post('/system/power', { action })
      setMsg({
        reboot:          'Rebooting… this device will drop offline for a moment.',
        poweroff:        'Shutting down… this device is powering off.',
        'restart-stack': 'Restarting thrive… the UI may blink.',
        'relaunch-kiosk':'Relaunching the kiosk display…',
      }[action] || 'Done.')
    } catch (e) { setMsg(e.message || 'Failed') }
    finally { setBusy(null) }
  }

  const actions = info.actions || []
  return (
    <>
      <SubHead>Power</SubHead>
      <div style={{ ...body, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {POWER_BTNS.filter(b => actions.includes(b.action)).map(b => (
            confirming === b.action
              ? <span key={b.action} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary,#aaa)' }}>{b.confirm}</span>
                  <button style={{ ...btnS, color: 'var(--color-danger,#ef4444)', borderColor: 'var(--color-danger,#ef4444)' }} disabled={!!busy} onClick={() => run(b.action)}>Yes</button>
                  <button style={btnS} onClick={() => setConfirming(null)}>No</button>
                </span>
              : <button key={b.action} disabled={!!busy} title={b.tip} aria-label={b.tip}
                  style={{ ...btnS, padding: 0, width: 38, height: 38, lineHeight: 1,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.5 : 1,
                    ...(b.danger ? { color: 'var(--color-danger,#ef4444)', borderColor: 'var(--color-danger,#ef4444)' } : {}) }}
                  onClick={() => { setConfirming(b.action); setMsg(null) }}><PowerIcon action={b.action} /></button>
          ))}
        </div>
        {msg && <div style={{ fontSize: 12, color: 'var(--text-secondary,#aaa)' }}>{msg}</div>}
      </div>
    </>
  )
}

export default function SettingsPage() {
  const { user, logout } = useAuth()
  // Module settings panels are declared in each module's ui/index.jsx and appear
  // only when that module is active. Discover them from the registry, gated on
  // the live active set from GET /modules — no module is named here.
  const [activeIds, setActiveIds] = useState(() => new Set())
  useEffect(() => {
    api.get('/modules')
      .then(ms => setActiveIds(new Set(ms.filter(m => m.installed && m.enabled && m.access !== 'none').map(m => m.id))))
      .catch(() => {})
  }, [])
  const modulePanels = MODULES.filter(m => m.settings && activeIds.has(m.id))
  // Module panels can opt into a core settings group (e.g. settings.group:'device')
  // to render inside that grouped card instead of as their own top-level card.
  // Core names no module — modules self-declare the group.
  const devicePanels = modulePanels.filter(m => m.settings.group === 'device')
  const otherPanels  = modulePanels.filter(m => !m.settings.group)

  return (
    <div className="settings-scroll" style={{ height: 'calc(100vh - 48px)', overflowY: 'auto' }}>
      <style>{`.settings-scroll::-webkit-scrollbar{display:none}.settings-scroll{scrollbar-width:none;-ms-overflow-style:none}`}</style>
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '1.5rem 1.5rem 3rem' }}>
      <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ fontSize: 14, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase' }}>Settings</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...btnS, padding: '4px 10px', fontSize: 10 }}
            onClick={() => window.dispatchEvent(new CustomEvent('thrive:settings-cards', { detail: { open: false } }))}>Collapse all</button>
          <button style={{ ...btnS, padding: '4px 10px', fontSize: 10 }}
            onClick={() => window.dispatchEvent(new CustomEvent('thrive:settings-cards', { detail: { open: true } }))}>Expand all</button>
        </div>
      </div>


      {/* Account: admins manage everything (incl. their own Sign out) in the
          Accounts card below; members get a simple identity + Sign out card. */}
      {user && user.role !== 'admin' && (
        <CollapsibleCard title="Account">
          <div style={{ ...body, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>
              {user.profile?.avatar || '👤'} {user.profile?.name || user.username}
              {' '}<Badge kind={user.role} />
              {user.profile && <span style={{ fontSize: 11, color: 'var(--text-tertiary,#666)', marginLeft: 8, fontFamily: 'monospace' }}>🔑 {user.username}</span>}
            </span>
            <button style={btnS} onClick={logout}>Sign out</button>
          </div>
        </CollapsibleCard>
      )}

      {/* Self-service password change — any account-backed identity (not the
          shared Household or a passwordless profile, which have no password). */}
      {user?.id && <ChangePasswordSection />}

      {user?.role === 'admin' && <AccountsSection />}

      {user?.role === 'admin' && <PermissionsSection />}


      {/* Device — this appliance/display: Power, Wi-Fi, Front page, UI, plus any
          module panel that opts into the 'device' group (e.g. FPS Meter). Power/
          Wi-Fi/Front-page are admin-only + self-hiding; UI is always present, so
          the card always shows. */}
      <CollapsibleCard title="Device" defaultOpen={false}>
        {user?.role === 'admin' && <PowerSection />}
        {user?.role === 'admin' && <WifiSection />}
        {user?.role === 'admin' && <FrontPageSection />}
        <UISection />
        {devicePanels.map(m => {
          const S = m.settings
          const Panel = S.Panel
          return (
            <div key={m.id}>
              <SubHead>{S.title}</SubHead>
              {S.padded ? <div style={{ padding: 16 }}><Panel /></div> : <Panel />}
            </div>
          )
        })}
      </CollapsibleCard>

      <CollapsibleCard title="Modules">
        <ModulesSection />
      </CollapsibleCard>

      {/* Module settings panels — each active module's own card (those not grouped
          into a core card like Device). Discovered from ui/index.jsx; core names none. */}
      {otherPanels.map(m => {
        const S = m.settings
        const Panel = S.Panel
        return (
          <CollapsibleCard key={m.id} title={S.title} defaultOpen={S.defaultOpen ?? true}>
            {S.padded ? <div style={{ padding: 16 }}><Panel /></div> : <Panel />}
          </CollapsibleCard>
        )
      })}
      </div>
    </div>
  )
}
