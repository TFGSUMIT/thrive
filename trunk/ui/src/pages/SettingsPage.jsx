// =============================================================================
// SettingsPage.jsx — Platform settings (account, modules)
// thrive UI — user management lives on its own page (UsersPage / 👥)
// =============================================================================
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'
import { THEMES, applyTheme, DEFAULT_THEME } from '../theme'
import EmojiPicker from '../components/EmojiPicker'
import { MODULES } from '../moduleRegistry'

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
function CollapsibleCard({ title, right, defaultOpen = true, children }) {
  const key = `settings.open.${title}`
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === '1' } catch { return defaultOpen }
  })
  const toggle = () => setOpen(o => { const n = !o; try { localStorage.setItem(key, n ? '1' : '0') } catch {} return n })
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
  )
}

const UI_ALPHA_KEY = 'thrive:uiAlpha'

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

  return (
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
    </div>
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
  const doReset       = async (id)           => { const pw = resetPw[id] || ''; if (pw.length < 8) { setErr('Min 8 chars'); return }; try { await api.patch(`/accounts/${id}/password`, { password: pw }); setResetPw(p => ({ ...p, [id]: '' })); setRow(id, { resetting: false }) } catch (e) { setErr(e.message) } }
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
        const activeAdmins = accounts.filter(x => x.role === 'admin' && !x.disabled).length
        const isLastAdmin = a.role === 'admin' && !a.disabled && activeAdmins <= 1
        return (
          <div key={a.id} style={{ padding: '12px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--border-color,#2a2a2a)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {isSelf && <span title="signed in" style={{ marginRight: 4 }}>🔑</span>}
                <span style={{ fontSize: 13, fontWeight: 500, marginRight: 8 }}>{a.username}</span>
                <Badge kind={a.role} />
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
                <button style={{ ...btnS, padding: '3px 9px', fontSize: 10, opacity: isLastAdmin ? 0.4 : 1, cursor: isLastAdmin ? 'not-allowed' : 'pointer' }}
                  disabled={isLastAdmin} title={isLastAdmin ? "Can't remove the last admin" : ''}
                  onClick={() => changeRole(a.id, a.role === 'admin' ? 'member' : 'admin')}>{a.role === 'admin' ? 'Make member' : 'Make admin'}</button>
                <button style={{ ...btnS, padding: '3px 9px', fontSize: 10, opacity: isLastAdmin ? 0.4 : 1, cursor: isLastAdmin ? 'not-allowed' : 'pointer' }}
                  disabled={isLastAdmin} title={isLastAdmin ? "Can't disable the last admin" : ''}
                  onClick={() => toggleDisable(a.id, !a.disabled)}>{a.disabled ? 'Enable' : 'Disable'}</button>
                <button style={{ ...btnS, padding: '3px 9px', fontSize: 10 }} onClick={() => setRow(a.id, { resetting: !ui.resetting })}>Reset pw</button>
                {ui.confirmDelete
                  ? <><button style={{ ...btnS, padding: '3px 9px', fontSize: 10, color: 'var(--color-danger,#ef4444)', borderColor: 'var(--color-danger,#ef4444)' }} onClick={() => doDelete(a.id)}>Confirm</button><button style={{ ...btnS, padding: '3px 9px', fontSize: 10 }} onClick={() => setRow(a.id, { confirmDelete: false })}>No</button></>
                  : <button style={{ ...btnS, padding: '3px 9px', fontSize: 10, color: 'var(--color-danger,#ef4444)', borderColor: 'transparent' }} onClick={() => setRow(a.id, { confirmDelete: true })}>Delete</button>}
              </div>
            </div>
            {ui.resetting && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input style={{ ...inp, flex: 1 }} type="text" placeholder="New password (min 8)" value={resetPw[a.id] || ''} onChange={e => setResetPw(p => ({ ...p, [a.id]: e.target.value }))} autoComplete="off" />
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


export default function SettingsPage() {
  const { user, logout } = useAuth()
  // Module settings panels are declared in each module's ui/index.jsx and appear
  // only when that module is active. Discover them from the registry, gated on
  // the live active set from GET /modules — no module is named here.
  const [activeIds, setActiveIds] = useState(() => new Set())
  useEffect(() => {
    api.get('/modules')
      .then(ms => setActiveIds(new Set(ms.filter(m => m.installed && m.enabled).map(m => m.id))))
      .catch(() => {})
  }, [])
  const modulePanels = MODULES.filter(m => m.settings && activeIds.has(m.id))

  return (
    <div className="settings-scroll" style={{ height: 'calc(100vh - 48px)', overflowY: 'auto' }}>
      <style>{`.settings-scroll::-webkit-scrollbar{display:none}.settings-scroll{scrollbar-width:none;-ms-overflow-style:none}`}</style>
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '1.5rem 1.5rem 3rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 14, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase' }}>Settings</h1>
      </div>

      {/* Front page — server-wide '/' destination; admin-controlled, sits at the top */}
      {user?.role === 'admin' && (
        <CollapsibleCard title="Front page">
          <FrontPageSection />
        </CollapsibleCard>
      )}

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

      {user?.role === 'admin' && <AccountsSection />}


      <CollapsibleCard title="UI" defaultOpen={false}>
        <UISection />
      </CollapsibleCard>

      <CollapsibleCard title="Modules">
        <ModulesSection />
      </CollapsibleCard>

      {/* Module settings panels — discovered from each active module's ui/index.jsx */}
      {modulePanels.map(m => {
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
