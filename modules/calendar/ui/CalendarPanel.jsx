// =============================================================================
// CalendarPanel.jsx — Calendar module Settings panel
// thrive module `calendar`
//
// Three sections: provider OAuth app credentials (the household registers its
// own Google Cloud / Azure apps once and pastes client id + secret here, with
// the exact redirect URI to register shown inline), connected accounts
// (connect = full-page OAuth round trip, disconnect drops the account and its
// calendars), and the calendar list (rename/recolor/hide, add local calendars).
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import { api } from '@trunk/api'
import { useToast } from '@trunk/context/ToastContext'
import { useConfirm } from '@trunk/context/ConfirmModal'
import PasswordInput from '@trunk/components/PasswordInput'
import { getWeekStart, setWeekStart as saveWeekStart, PREFS_EVENT } from './prefs'

const ACCENT = '#f97316'   // module color

const lbl  = { fontSize: 10, color: 'var(--text-tertiary,#666)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block' }
const inp  = { fontFamily: 'monospace', fontSize: 11, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '7px 10px', outline: 'none', width: '100%', boxSizing: 'border-box' }
const btnS = { fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '6px 10px' }

const PROVIDERS = [
  { id: 'google',    name: 'Google',    idKey: 'google_client_id', secretKey: 'google_client_secret',
    hint: 'Google Cloud Console → APIs & Services → Credentials → OAuth client (Web application). Enable the Google Calendar API.' },
  { id: 'microsoft', name: 'Microsoft', idKey: 'ms_client_id', secretKey: 'ms_client_secret',
    hint: 'Azure Portal → App registrations → New (any-org + personal accounts). Add a Web redirect URI + a client secret; API permission Calendars.ReadWrite (delegated).' },
]

export default function CalendarPanel() {
  const { showToast } = useToast()
  const { confirm } = useConfirm()
  const [cfg,      setCfg]      = useState({})    // key → bool (set?)
  const [accounts, setAccounts] = useState([])
  const [cals,     setCals]     = useState([])
  const [inputs,   setInputs]   = useState({})    // cfg key → typed value
  const [newCal,   setNewCal]   = useState('')
  const [busy,     setBusy]     = useState(false)
  const [weekStart, setWS]      = useState(getWeekStart)   // per-device display pref
  useEffect(() => {
    const sync = () => setWS(getWeekStart())
    window.addEventListener(PREFS_EVENT, sync)
    return () => window.removeEventListener(PREFS_EVENT, sync)
  }, [])
  const changeWeekStart = (v) => { saveWeekStart(v); setWS(v) }

  const redirectUri = `${window.location.origin}/api/calendar/oauth/callback`

  const load = useCallback(async () => {
    try {
      setCfg(await api.get('/calendar/config'))
      setAccounts(await api.get('/calendar/accounts'))
      setCals(await api.get('/calendar/calendars'))
    } catch {}
  }, [])
  useEffect(() => { load() }, [load])

  const saveCfg = async (key) => {
    const value = (inputs[key] || '').trim()
    if (!value) return
    setBusy(true)
    try {
      await api.post('/calendar/config', { key, value })
      setInputs(i => ({ ...i, [key]: '' }))
      showToast('Saved', 'success'); load()
    } catch (e) { showToast(e.message, 'error') }
    finally { setBusy(false) }
  }

  const connect = async (provider) => {
    try {
      const r = await api.get(`/calendar/oauth/start?provider=${provider}`)
      window.location.href = r.url   // full-page round trip; comes back to /calendar
    } catch (e) { showToast(e.message, 'error') }
  }

  const disconnect = async (a) => {
    const ok = await confirm(`Disconnect ${a.label}? Its calendars leave thrive (the ${a.provider} copies are untouched).`, { danger: true })
    if (!ok) return
    try { await api.del(`/calendar/accounts/${a.id}`); load() }
    catch (e) { showToast(e.message, 'error') }
  }

  const patchCal = async (id, patch) => {
    try { await api.patch(`/calendar/calendars/${id}`, patch); load() }
    catch (e) { showToast(e.message, 'error') }
  }

  const delCal = async (c) => {
    const msg = c.kind === 'local'
      ? `Delete '${c.name}' and ALL its events?`
      : `Remove '${c.name}' from thrive? (the ${c.kind} copy is untouched)`
    const ok = await confirm(msg, { danger: true })
    if (!ok) return
    try { await api.del(`/calendar/calendars/${c.id}`); load() }
    catch (e) { showToast(e.message, 'error') }
  }

  const addCal = async () => {
    if (!newCal.trim()) return
    try { await api.post('/calendar/calendars', { name: newCal.trim() }); setNewCal(''); load() }
    catch (e) { showToast(e.message, 'error') }
  }

  return (
    <div style={{ padding: 16 }}>
      {/* ── display (per-device) ── */}
      <label style={lbl}>Week starts on</label>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border-color,#2a2a2a)' }}>
        {[['mon', 'Monday'], ['sun', 'Sunday']].map(([v, label]) => {
          const on = weekStart === v
          return (
            <button key={v} onClick={() => changeWeekStart(v)}
              style={{ ...btnS, flex: 1, borderColor: on ? ACCENT : 'var(--border-color,#333)',
                color: on ? ACCENT : 'var(--text-secondary,#aaa)', background: on ? `${ACCENT}22` : 'none' }}>
              {label}
            </button>
          )
        })}
      </div>

      {/* ── provider OAuth apps ── */}
      <label style={lbl}>Provider apps</label>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', marginBottom: 10 }}>
        Register the redirect URI <code style={{ color: ACCENT, userSelect: 'all' }}>{redirectUri}</code> with each provider.
      </div>
      {PROVIDERS.map(p => (
        <div key={p.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border-color,#2a2a2a)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 500, width: 80 }}>{p.name}</span>
            {cfg[p.idKey] && cfg[p.secretKey]
              ? <>
                  <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4, background: 'var(--success-muted)', color: 'var(--color-success)', fontFamily: 'monospace', textTransform: 'uppercase' }}>configured</span>
                  <button style={{ ...btnS, borderColor: ACCENT, color: ACCENT }} onClick={() => connect(p.id)}>Connect account ↗</button>
                </>
              : <span style={{ fontSize: 10, color: 'var(--text-tertiary,#888)' }}>not configured</span>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input style={{ ...inp, flex: 1 }} placeholder={cfg[p.idKey] ? 'client id (set — paste to replace)' : 'client id'}
              value={inputs[p.idKey] || ''} autoComplete="off"
              onChange={e => setInputs(i => ({ ...i, [p.idKey]: e.target.value }))}
              onBlur={() => saveCfg(p.idKey)} />
            <PasswordInput wrapStyle={{ flex: 1 }} style={inp} placeholder={cfg[p.secretKey] ? 'client secret (set — paste to replace)' : 'client secret'}
              value={inputs[p.secretKey] || ''} autoComplete="off"
              onChange={e => setInputs(i => ({ ...i, [p.secretKey]: e.target.value }))}
              onBlur={() => saveCfg(p.secretKey)} />
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-tertiary,#666)', marginTop: 4 }}>{p.hint}</div>
        </div>
      ))}

      {/* ── connected accounts ── */}
      <label style={{ ...lbl, marginTop: 16 }}>Connected accounts</label>
      {accounts.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary,#888)' }}>None yet — configure a provider above, then Connect.</div>
      ) : accounts.map(a => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
          <span style={{ fontSize: 11, fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {a.provider === 'google' ? '🟢' : '🟦'} {a.label}
          </span>
          <button style={btnS} onClick={() => disconnect(a)} disabled={busy}>Disconnect</button>
        </div>
      ))}

      {/* ── calendars ── */}
      <label style={{ ...lbl, marginTop: 16 }}>Calendars</label>
      {cals.map(c => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <input type="color" value={c.color || '#888888'} title="color"
            onChange={e => patchCal(c.id, { color: e.target.value })}
            style={{ width: 22, height: 22, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
          <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.name}
            <span style={{ fontSize: 9, color: 'var(--text-tertiary,#666)', marginLeft: 6, fontFamily: 'monospace' }}>
              {c.kind === 'local' ? 'thrive' : `${c.kind} · ${c.account_label}`}{!c.writable && ' · read-only'}
            </span>
          </span>
          <button style={{ ...btnS, padding: '3px 8px', opacity: c.visible ? 1 : 0.5 }} onClick={() => patchCal(c.id, { visible: !c.visible })}>
            {c.visible ? 'shown' : 'hidden'}
          </button>
          <button style={{ ...btnS, padding: '3px 8px', color: 'var(--color-danger,#ef4444)', borderColor: 'var(--color-danger,#ef4444)' }} onClick={() => delCal(c)}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input style={{ ...inp, flex: 1 }} placeholder="new thrive calendar name…" value={newCal}
          onChange={e => setNewCal(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCal()} />
        <button style={btnS} onClick={addCal} disabled={!newCal.trim()}>Add</button>
      </div>
    </div>
  )
}
