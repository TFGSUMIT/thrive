// =============================================================================
// CalendarPage.jsx — Calendar module page (/calendar)
// thrive UI
//
// Month grid + upcoming agenda over the merged event feed (native calendars
// plus connected Google / Microsoft accounts — see Settings → Calendar).
// Click a day to add an event, click an event to edit; events on writable
// external calendars push straight to the provider. Calendar chips above the
// grid toggle visibility.
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '@core/api'
import { useToast } from '@core/context/ToastContext'
import { useConfirm } from '@core/context/ConfirmModal'
import { getWeekStart, PREFS_EVENT } from './prefs'

const ACCENT = '#f97316'   // module color

const DOW_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DOW_SUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dowLabels = (ws) => (ws === 'sun' ? DOW_SUN : DOW_MON)
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const pad  = (n) => String(n).padStart(2, '0')
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
// local datetime-local input value ↔ UTC ISO wire format
const toLocalInput = (iso) => { const d = new Date(iso); return `${dkey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}` }
const toISO        = (local) => new Date(local).toISOString()
const fmtTime      = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const addDays      = (ymd, n) => { const d = new Date(`${ymd}T12:00:00`); d.setDate(d.getDate() + n); return dkey(d) }
const fmtMoney     = (cents) => (cents < 0 ? '−' : '+') + '$' + Math.abs(Math.round(cents / 100)).toLocaleString('en-US')

// Budget overlay (feature-detected): scheduled transactions render as read-only
// all-day chips coloured by type. Synthetic "calendars" so the grid colours them
// without budget knowing anything about the calendar.
const BUDGET_CAL = {
  'budget-income':   { name: 'Scheduled income',   color: '#22c55e' },
  'budget-expense':  { name: 'Scheduled expense',  color: '#f59e0b' },
  'budget-transfer': { name: 'Scheduled transfer', color: '#3b82f6' },
}

// 42-cell month grid, week starting Monday ('mon', default) or Sunday ('sun')
const monthGrid = (year, month, weekStart) => {
  const first = new Date(year, month, 1)
  // how far the 1st sits from the leftmost (start-of-week) column
  const offset = weekStart === 'sun' ? first.getDay() : (first.getDay() + 6) % 7
  const start = new Date(year, month, 1 - offset)
  return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
}

// the local day keys an event spans (end-exclusive on both kinds)
const eventDays = (ev) => {
  if (ev.all_day) {
    const out = []
    for (let d = ev.start.slice(0, 10); d < ev.end.slice(0, 10) && out.length < 60; d = addDays(d, 1)) out.push(d)
    return out.length ? out : [ev.start.slice(0, 10)]
  }
  const out = []
  const endDay = dkey(new Date(new Date(ev.end).getTime() - 1))
  for (let d = dkey(new Date(ev.start)); d <= endDay && out.length < 60; d = addDays(d, 1)) out.push(d)
  return out
}

const card = { background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, overflow: 'hidden' }
const head = { padding: '10px 16px', borderBottom: '1px solid var(--border-color,#2a2a2a)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#666)' }
const inp  = { fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '7px 10px', outline: 'none', width: '100%', boxSizing: 'border-box', colorScheme: 'dark' }
const lbl  = { fontSize: 10, color: 'var(--text-tertiary,#666)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block' }
const btnS = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '7px 12px' }
const btnP = { ...btnS, background: ACCENT, border: 'none', color: '#0f0f0f', fontWeight: 600 }

const EMPTY_FORM = { title: '', calendar_id: '', all_day: false, start: '', end: '', startDate: '', endDate: '', location: '', notes: '' }

export default function CalendarPage() {
  const { showToast } = useToast()
  const { confirm } = useConfirm()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const today = new Date()
  const [cursor,  setCursor]  = useState({ y: today.getFullYear(), m: today.getMonth() })
  const [weekStart, setWeekStartState] = useState(getWeekStart)   // 'mon' | 'sun' (per-device pref)
  useEffect(() => {
    const sync = () => setWeekStartState(getWeekStart())
    window.addEventListener(PREFS_EVENT, sync)
    window.addEventListener('storage', sync)   // other tabs
    return () => { window.removeEventListener(PREFS_EVENT, sync); window.removeEventListener('storage', sync) }
  }, [])
  const DOW = dowLabels(weekStart)

  // Wall-display: the calendar IS the full screen — hide thrive's top nav and
  // fill 100vh. Navigation moves into a pull-down menu in the header (below).
  useEffect(() => {
    // defer to a later task so the shell's immersive listener is attached even
    // when the calendar is the very first page rendered (front page = calendar)
    const fire = () => window.dispatchEvent(new CustomEvent('thrive:immersive', { detail: true }))
    fire()
    const id = setTimeout(fire, 0)
    return () => { clearTimeout(id); window.dispatchEvent(new CustomEvent('thrive:immersive', { detail: false })) }  // restore nav on leave
  }, [])
  const [menuOpen, setMenuOpen] = useState(false)
  const [navModules, setNavModules] = useState([])
  useEffect(() => {
    api.get('/modules')
      .then(ms => setNavModules(ms.filter(m => m.installed && m.enabled && m.nav_path && m.id !== 'calendar')))
      .catch(() => {})
  }, [])
  const [cals,    setCals]    = useState([])
  const [events,  setEvents]  = useState([])
  const [budgetEvents, setBudgetEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [modal,   setModal]   = useState(null)    // null | 'new' | event object
  const [form,    setForm]    = useState(EMPTY_FORM)
  const [busy,    setBusy]    = useState(false)

  // one-shot toasts from the OAuth redirect
  useEffect(() => {
    if (params.get('connected')) { showToast(`${params.get('connected')} account connected`, 'success'); setParams({}, { replace: true }) }
    if (params.get('error'))     { showToast(`OAuth failed: ${params.get('error')}`, 'error');            setParams({}, { replace: true }) }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const grid = monthGrid(cursor.y, cursor.m, weekStart)
  const gridStart = grid[0], gridEnd = new Date(grid[41]); gridEnd.setDate(gridEnd.getDate() + 1)

  const loadCals = useCallback(async () => {
    try { setCals(await api.get('/calendar/calendars')) } catch (e) { showToast(e.message, 'error') }
  }, [showToast])
  useEffect(() => { loadCals() }, [loadCals])

  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get(`/calendar/events?start=${gridStart.toISOString()}&end=${gridEnd.toISOString()}`)
      setEvents(r.events || [])
    } catch (e) { showToast(e.message, 'error') }
    finally { setLoading(false) }
  }, [cursor.y, cursor.m, showToast])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadEvents() }, [loadEvents])

  // Feature-detect budget: its /reports route only exists when the module is
  // active, so a failed fetch just means "no budget" → no overlay. Scheduled
  // (recurring) transactions show as read-only chips on the dates they fall.
  const loadBudget = useCallback(async () => {
    try {
      const r = await api.get(`/reports/scheduled-occurrences?start=${dkey(gridStart)}&end=${dkey(gridEnd)}`)
      setBudgetEvents((r.occurrences || []).map(o => ({
        id: `sched-${o.scheduled_id}-${o.date}`,
        calendar_id: `budget-${o.type}`,
        source: 'budget',
        title: `💰 ${o.title}  ${fmtMoney(o.amount_cents)}`,
        all_day: true,
        start: o.date,
        end: addDays(o.date, 1),
      })))
    } catch { setBudgetEvents([]) }
  }, [cursor.y, cursor.m])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadBudget() }, [loadBudget])

  const calById  = { ...Object.fromEntries(cals.map(c => [c.id, c])), ...BUDGET_CAL }
  const writable = cals.filter(c => c.writable)
  const errors   = events.filter(e => e.error)
  const visible  = events.filter(e => !e.error)
  const overlay  = [...visible, ...budgetEvents]   // calendar events + budget scheduled

  // bucket events into local day keys for the grid
  const byDay = {}
  for (const ev of overlay) for (const d of eventDays(ev)) (byDay[d] = byDay[d] || []).push(ev)
  for (const d of Object.keys(byDay))
    byDay[d].sort((a, b) => (b.all_day - a.all_day) || a.start.localeCompare(b.start))

  // ── modal open/close ──
  const openNew = (dayKey) => {
    const base = dayKey || dkey(today)
    setForm({ ...EMPTY_FORM, calendar_id: writable[0]?.id || '', startDate: base, endDate: base,
      start: `${base}T09:00`, end: `${base}T10:00` })
    setModal('new')
  }
  const openEdit = (ev) => {
    setForm({
      title: ev.title, calendar_id: ev.calendar_id, all_day: ev.all_day,
      location: ev.location || '', notes: ev.notes || '',
      start: ev.all_day ? '' : toLocalInput(ev.start),
      end:   ev.all_day ? '' : toLocalInput(ev.end),
      startDate: ev.all_day ? ev.start.slice(0, 10) : dkey(new Date(ev.start)),
      endDate:   ev.all_day ? addDays(ev.end.slice(0, 10), -1) : dkey(new Date(ev.end)),  // inclusive in the form
    })
    setModal(ev)
  }
  const close = () => { setModal(null); setForm(EMPTY_FORM) }

  const save = async () => {
    if (!form.title.trim()) { showToast('Title required', 'error'); return }
    if (!form.calendar_id)  { showToast('Pick a calendar', 'error'); return }
    const body = {
      calendar_id: +form.calendar_id, title: form.title, all_day: form.all_day,
      location: form.location || null, notes: form.notes || null,
      start: form.all_day ? form.startDate : toISO(form.start),
      end:   form.all_day ? addDays(form.endDate, 1) : toISO(form.end),   // wire format is end-exclusive
    }
    if (body.end <= body.start) { showToast('End must be after start', 'error'); return }
    setBusy(true)
    try {
      if (modal === 'new') await api.post('/calendar/events', body)
      else                 await api.patch(`/calendar/events?event_id=${encodeURIComponent(modal.id)}`, body)
      showToast(modal === 'new' ? 'Event added' : 'Event updated', 'success')
      close(); loadEvents()
    } catch (e) { showToast(e.message, 'error') }
    finally { setBusy(false) }
  }

  const del = async () => {
    const ok = await confirm(`Delete '${modal.title}'?`, { danger: true })
    if (!ok) return
    setBusy(true)
    try {
      await api.del(`/calendar/events?event_id=${encodeURIComponent(modal.id)}&calendar_id=${modal.calendar_id}`)
      showToast('Event deleted', 'success')
      close(); loadEvents()
    } catch (e) { showToast(e.message, 'error') }
    finally { setBusy(false) }
  }

  const toggleCal = async (c) => {
    try { await api.patch(`/calendar/calendars/${c.id}`, { visible: !c.visible }); loadCals(); loadEvents() }
    catch (e) { showToast(e.message, 'error') }
  }

  // ── agenda: next 14 days ──
  const now = new Date()
  const horizon = new Date(now.getTime() + 14 * 864e5)
  const agenda = {}
  for (const ev of overlay) {
    const evEnd = ev.all_day ? new Date(`${ev.end.slice(0, 10)}T00:00:00`) : new Date(ev.end)
    if (evEnd <= now) continue
    for (const d of eventDays(ev)) {
      const day = new Date(`${d}T23:59:59`)
      if (day >= now && day <= horizon) (agenda[d] = agenda[d] || []).push(ev)
    }
  }
  const agendaDays = Object.keys(agenda).sort()
  for (const d of agendaDays) agenda[d].sort((a, b) => (b.all_day - a.all_day) || a.start.localeCompare(b.start))

  const todayKey = dkey(today)
  const readonly = modal && modal !== 'new' && modal.readonly

  return (
    // wall display: the month grid fills the entire screen, edge to edge.
    // Just a slim top bar (month + nav + menu); no sidebar, no chrome.
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', overflow: 'hidden' }}>

      {/* ── slim top bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        padding: '8px 16px', borderBottom: '1px solid var(--border-color,#2a2a2a)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: '0.04em' }}>{MONTHS[cursor.m]}</span>
          <span style={{ fontSize: 18, color: 'var(--text-tertiary,#888)', fontFamily: 'monospace' }}>{cursor.y}</span>
          {loading && <span style={{ fontSize: 10, color: 'var(--text-tertiary,#666)' }}>syncing…</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button style={btnS} onClick={() => setCursor(c => c.m ? { ...c, m: c.m - 1 } : { y: c.y - 1, m: 11 })}>‹</button>
          <button style={btnS} onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}>Today</button>
          <button style={btnS} onClick={() => setCursor(c => c.m === 11 ? { y: c.y + 1, m: 0 } : { ...c, m: c.m + 1 })}>›</button>
          <button style={btnP} onClick={() => openNew()} disabled={!writable.length}>+ Event</button>

          {/* ── pull-down nav menu (replaces the hidden top nav) ── */}
          <div style={{ position: 'relative' }}>
            <button style={menuOpen ? btnP : btnS} onClick={() => setMenuOpen(o => !o)}>Menu</button>
            {menuOpen && (
              <>
                <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 150 }} />
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 151, minWidth: 200,
                  background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 8,
                  overflow: 'hidden', boxShadow: '0 8px 28px var(--shadow-color,rgba(0,0,0,0.45))' }}>
                  {/* calendar visibility toggles live here now (kept off the wall) */}
                  {cals.length > 0 && (
                    <div style={{ padding: '8px 16px 4px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#666)' }}>Calendars</div>
                  )}
                  {cals.map(c => (
                    <button key={`cal-${c.id}`} onClick={() => toggleCal(c)} title={c.account_label ? `${c.account_label} (${c.kind})` : 'thrive calendar'}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 16px',
                        background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, textAlign: 'left',
                        color: c.visible ? 'var(--text-primary,#e8e6e0)' : 'var(--text-tertiary,#666)' }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: c.visible ? c.color : 'var(--border-color,#444)' }} />
                      {c.name}{!c.writable && ' 🔒'}
                    </button>
                  ))}
                  <div style={{ borderTop: '1px solid var(--border-color,#2a2a2a)' }} />
                  {[{ id: 'home', icon: '🏠', name: 'Home', nav_path: '/' },
                    ...navModules,
                    { id: 'settings', icon: '⚙️', name: 'Settings', nav_path: '/settings' }].map((m, i) => (
                    <button key={m.id} onClick={() => { setMenuOpen(false); navigate(m.nav_path) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '11px 16px',
                        background: 'none', border: 'none', borderTop: i ? '1px solid var(--border-color,#2a2a2a)' : 'none',
                        color: 'var(--text-primary,#e8e6e0)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, textAlign: 'left' }}>
                      <span style={{ fontSize: 17 }}>{m.icon || '📦'}</span>{m.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {errors.length > 0 && (
        <div style={{ fontSize: 11, color: '#f59e0b', padding: '6px 16px', background: 'rgba(245,158,11,0.08)', flexShrink: 0 }}>
          {errors.map(e => <div key={e.id}>{e.title}</div>)}
        </div>
      )}

      {/* ── month grid: fills all remaining space, edge to edge ── */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {/* minmax(0,1fr): a bare 1fr won't shrink below the widest nowrap chip,
            which made columns unequal and pushed days out from under their headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: '1px solid var(--border-color,#2a2a2a)', flexShrink: 0 }}>
          {DOW.map(d => <div key={d} style={{ padding: '8px 0', textAlign: 'center', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-tertiary,#666)' }}>{d}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gridTemplateRows: 'repeat(6, minmax(0, 1fr))', flex: 1, minHeight: 0 }}>
          {grid.map((d, i) => {
            const k = dkey(d)
            const inMonth = d.getMonth() === cursor.m
            const isToday = k === todayKey
            const dayEvents = byDay[k] || []
            return (
              <div key={i} onClick={() => writable.length && openNew(k)}
                style={{ minHeight: 0, minWidth: 0, overflow: 'hidden', padding: 5, cursor: writable.length ? 'pointer' : 'default',
                  borderTop: i >= 7 ? '1px solid var(--border-color,#2a2a2a)' : 'none',
                  borderLeft: i % 7 ? '1px solid var(--border-color,#2a2a2a)' : 'none',
                  background: isToday ? 'rgba(249,115,22,0.08)' : 'none', opacity: inMonth ? 1 : 0.35 }}>
                <div style={{ fontSize: 13, fontFamily: 'monospace', padding: '1px 4px', marginBottom: 3,
                  color: isToday ? ACCENT : 'var(--text-tertiary,#888)', fontWeight: isToday ? 700 : 400 }}>
                  {d.getDate()}
                </div>
                {dayEvents.slice(0, 6).map(ev => (
                  <div key={`${ev.calendar_id}:${ev.id}:${k}`}
                    onClick={e => { e.stopPropagation(); ev.source === 'budget' ? navigate('/budget') : openEdit(ev) }}
                    title={`${ev.title}${ev.all_day ? '' : ` · ${fmtTime(ev.start)}`}`}
                    style={{ fontSize: 11, lineHeight: '17px', padding: '0 5px', marginBottom: 2, borderRadius: 3,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer',
                      background: `${calById[ev.calendar_id]?.color || ACCENT}33`,
                      borderLeft: `2px solid ${calById[ev.calendar_id]?.color || ACCENT}` }}>
                    {!ev.all_day && <span style={{ color: 'var(--text-tertiary,#999)', fontFamily: 'monospace' }}>{fmtTime(ev.start)} </span>}
                    {ev.title}
                  </div>
                ))}
                {dayEvents.length > 6 && <div style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', paddingLeft: 5 }}>+{dayEvents.length - 6} more</div>}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── event modal ── */}
      {modal && (
        <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ ...card, width: 440, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 20 }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#888)', marginBottom: 14 }}>
              {modal === 'new' ? 'New event' : readonly ? 'Event (read-only)' : 'Edit event'}
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={lbl}>Title *</label>
              <input style={inp} value={form.title} autoFocus={modal === 'new'} disabled={readonly}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Calendar</label>
                <select style={inp} value={form.calendar_id} disabled={readonly || modal !== 'new'}
                  onChange={e => setForm(f => ({ ...f, calendar_id: e.target.value }))}>
                  {(modal === 'new' ? writable : cals).map(c => <option key={c.id} value={c.id}>{c.name}{c.account_label ? ` · ${c.account_label}` : ''}</option>)}
                </select>
              </div>
              <div style={{ alignSelf: 'flex-end', paddingBottom: 7 }}>
                <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--text-secondary,#aaa)' }}>
                  <input type="checkbox" checked={form.all_day} disabled={readonly}
                    onChange={e => setForm(f => ({ ...f, all_day: e.target.checked }))} />
                  all day
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Start</label>
                {form.all_day
                  ? <input style={inp} type="date" value={form.startDate} disabled={readonly} onChange={e => setForm(f => ({ ...f, startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate }))} />
                  : <input style={inp} type="datetime-local" value={form.start} disabled={readonly} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} />}
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>End {form.all_day && <span style={{ textTransform: 'none' }}>(inclusive)</span>}</label>
                {form.all_day
                  ? <input style={inp} type="date" value={form.endDate} disabled={readonly} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
                  : <input style={inp} type="datetime-local" value={form.end} disabled={readonly} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} />}
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={lbl}>Location</label>
              <input style={inp} value={form.location} disabled={readonly} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={lbl}>Notes</label>
              <textarea style={{ ...inp, minHeight: 54, resize: 'vertical' }} value={form.notes} disabled={readonly}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {!readonly && <button style={{ ...btnP, opacity: busy ? 0.5 : 1 }} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>}
                <button style={btnS} onClick={close} disabled={busy}>Close</button>
              </div>
              {modal !== 'new' && !readonly && (
                <button style={{ ...btnS, borderColor: 'var(--color-danger,#ef4444)', color: 'var(--color-danger,#ef4444)' }} onClick={del} disabled={busy}>Delete</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
