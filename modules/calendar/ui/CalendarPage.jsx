// =============================================================================
// CalendarPage.jsx — Calendar module page (/calendar)
// thrive UI
//
// Wall calendar: a continuously SCROLLABLE stack of month grids (scroll up for
// past months, down for future) over the merged event feed (native calendars
// plus connected Google / Microsoft accounts — see Settings → Calendar) and the
// budget overlay. The header tracks the month at the top of the scroll; "Today"
// snaps back. Click a day to add an event, an event to edit. Events are never
// purged — the window just range-queries what's loaded.
// =============================================================================
import { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '@trunk/api'
import { useToast } from '@trunk/context/ToastContext'
import { useConfirm } from '@trunk/context/ConfirmModal'
import { getWeekStart, PREFS_EVENT } from './prefs'
import SideLists from './SideLists'
import TimeGrid from './TimeGrid'

const ACCENT = '#f97316'   // module color

// a colour per month — orients you as you scroll the stack (full hue spread so
// adjacent months read distinctly; roughly seasonal)
const MONTH_COLORS = [
  '#3b82f6', // Jan
  '#8b5cf6', // Feb
  '#ec4899', // Mar
  '#22c55e', // Apr
  '#84cc16', // May
  '#eab308', // Jun
  '#f97316', // Jul
  '#ef4444', // Aug
  '#f59e0b', // Sep
  '#14b8a6', // Oct
  '#a855f7', // Nov
  '#06b6d4', // Dec
]

const DOW_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DOW_SUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dowLabels = (ws) => (ws === 'sun' ? DOW_SUN : DOW_MON)
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MON_ABBR = MONTHS.map(s => s.slice(0, 3).toUpperCase())
const VIEWS = [['current', 'Scroll'], ['month', 'Month'], ['week', 'Week'], ['day', 'Day']]

const pad  = (n) => String(n).padStart(2, '0')
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const toLocalInput = (iso) => { const d = new Date(iso); return `${dkey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}` }
const toISO        = (local) => new Date(local).toISOString()
const fmtTime      = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const addDays      = (ymd, n) => { const d = new Date(`${ymd}T12:00:00`); d.setDate(d.getDate() + n); return dkey(d) }
const fmtMoney     = (cents) => (cents < 0 ? '−' : '+') + '$' + Math.abs(Math.round(cents / 100)).toLocaleString('en-US')

// Budget overlay (feature-detected): scheduled transactions render as read-only
// all-day chips coloured by type.
const BUDGET_CAL = {
  'budget-income':   { name: 'Scheduled income',   color: '#22c55e' },
  'budget-expense':  { name: 'Scheduled expense',  color: '#f59e0b' },
  'budget-transfer': { name: 'Scheduled transfer', color: '#3b82f6' },
}

// the scrollable window: this many months before/after today (≈ 2 years each way)
const RANGE = 24
const buildMonths = () => {
  const t = new Date(); const out = []
  for (let i = -RANGE; i <= RANGE; i++) { const d = new Date(t.getFullYear(), t.getMonth() + i, 1); out.push({ y: d.getFullYear(), m: d.getMonth() }) }
  return out
}
// ONE continuous grid over the whole window: weeks flow across month boundaries
// (no per-month padding/break — the last days of a month and the first of the
// next share a row). Blanks appear only at the very top/bottom of the range.
// The 1st of each month is tinted + labelled in the cell itself (see render).
const buildWeeks = (weekStart) => {
  const t = new Date()
  const first = new Date(t.getFullYear(), t.getMonth() - RANGE, 1)
  const lastFirst = new Date(t.getFullYear(), t.getMonth() + RANGE, 1)
  const last = new Date(lastFirst.getFullYear(), lastFirst.getMonth() + 1, 0)  // last day of final month
  const offset = weekStart === 'sun' ? first.getDay() : (first.getDay() + 6) % 7
  const cells = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) cells.push(new Date(d))
  while (cells.length % 7) cells.push(null)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

// the 5–6 week grid for ONE month (Month view): real Dates incl. the leading/
// trailing days of adjacent months (rendered faded), aligned to the week start.
const monthGrid = (cursor, weekStart) => {
  const y = cursor.getFullYear(), m = cursor.getMonth()
  const first = new Date(y, m, 1)
  const last = new Date(y, m + 1, 0)
  const offset = weekStart === 'sun' ? first.getDay() : (first.getDay() + 6) % 7
  const cur = new Date(y, m, 1 - offset)
  const weeks = []
  while (cur <= last) {
    const row = []
    for (let i = 0; i < 7; i++) { row.push(new Date(cur)); cur.setDate(cur.getDate() + 1) }
    weeks.push(row)
  }
  return weeks
}
// the 7 days of the week containing `cursor`, aligned to the week start
const weekDays = (cursor, weekStart) => {
  const offset = weekStart === 'sun' ? cursor.getDay() : (cursor.getDay() + 6) % 7
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - offset)
  return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
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
const inp  = { fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '7px 10px', outline: 'none', width: '100%', boxSizing: 'border-box', colorScheme: 'dark' }
const lbl  = { fontSize: 10, color: 'var(--text-tertiary,#666)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block' }
const btnS = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '7px 12px' }
const btnP = { ...btnS, background: ACCENT, border: 'none', color: '#0f0f0f', fontWeight: 600 }
const COL7 = { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }

const EMPTY_FORM = { title: '', calendar_id: '', all_day: false, start: '', end: '', startDate: '', endDate: '', location: '', notes: '' }

export default function CalendarPage() {
  const { showToast } = useToast()
  const { confirm } = useConfirm()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const today = new Date()
  const todayKey = dkey(today)
  const [weekStart, setWeekStartState] = useState(getWeekStart)
  useEffect(() => {
    const sync = () => setWeekStartState(getWeekStart())
    window.addEventListener(PREFS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(PREFS_EVENT, sync); window.removeEventListener('storage', sync) }
  }, [])
  const DOW = dowLabels(weekStart)

  // wall display: fill the screen, hide thrive's top nav
  useEffect(() => {
    const fire = () => window.dispatchEvent(new CustomEvent('thrive:immersive', { detail: true }))
    fire(); const id = setTimeout(fire, 0)
    return () => { clearTimeout(id); window.dispatchEvent(new CustomEvent('thrive:immersive', { detail: false })) }
  }, [])

  const [menuOpen, setMenuOpen] = useState(false)
  // side panel (todo / groceries) — per-device: which side, and shown vs collapsed
  const [side, setSideState] = useState(() => { try { return localStorage.getItem('thrive:cal:side') || 'right' } catch { return 'right' } })
  const [showSide, setShowSideState] = useState(() => { try { return localStorage.getItem('thrive:cal:show') !== '0' } catch { return true } })
  const setSide = (v) => { setSideState(v); setShowSideState(true); try { localStorage.setItem('thrive:cal:side', v); localStorage.setItem('thrive:cal:show', '1') } catch {} }
  const setShowSide = (v) => { setShowSideState(v); try { localStorage.setItem('thrive:cal:show', v ? '1' : '0') } catch {} }
  const [navModules, setNavModules] = useState([])
  useEffect(() => {
    api.get('/modules').then(ms => setNavModules(ms.filter(m => m.installed && m.enabled && m.nav_path && m.id !== 'calendar'))).catch(() => {})
  }, [])

  const [cals,    setCals]    = useState([])
  const [events,  setEvents]  = useState([])
  const [budgetEvents, setBudgetEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [modal,   setModal]   = useState(null)
  const [form,    setForm]    = useState(EMPTY_FORM)
  const [busy,    setBusy]    = useState(false)

  const [months] = useState(buildMonths)            // fixed scroll window (range math + label)
  const weeks = useMemo(() => buildWeeks(weekStart), [weekStart])  // continuous week grid
  const [label,  setLabel] = useState({ y: today.getFullYear(), m: today.getMonth() })
  const scrollRef = useRef(null)

  // view mode (per-device): the rolling scroll ('current') or a paged month/week/day.
  // `cursor` is the focused day that month/week/day navigate; 'current' ignores it.
  const [view, setViewState] = useState(() => { try { return localStorage.getItem('thrive:cal:view') || 'current' } catch { return 'current' } })
  const setView = (v) => { setViewState(v); try { localStorage.setItem('thrive:cal:view', v) } catch {} }
  const [cursor, setCursor] = useState(today)
  const shift = (n) => setCursor(c => {
    if (view === 'month') return new Date(c.getFullYear(), c.getMonth() + n, 1)
    return new Date(c.getFullYear(), c.getMonth(), c.getDate() + n * (view === 'week' ? 7 : 1))
  })
  const rangeStart = new Date(months[0].y, months[0].m, 1)
  const rangeEnd   = new Date(months[months.length - 1].y, months[months.length - 1].m + 1, 1)

  useEffect(() => {
    if (params.get('connected')) { showToast(`${params.get('connected')} account connected`, 'success'); setParams({}, { replace: true }) }
    if (params.get('error'))     { showToast(`OAuth failed: ${params.get('error')}`, 'error');            setParams({}, { replace: true }) }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const loadCals = useCallback(async () => {
    try { setCals(await api.get('/calendar/calendars')) } catch (e) { showToast(e.message, 'error') }
  }, [showToast])
  useEffect(() => { loadCals() }, [loadCals])

  // events across the whole scroll window (one range query; the backend supports it)
  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get(`/calendar/events?start=${rangeStart.toISOString()}&end=${rangeEnd.toISOString()}`)
      setEvents(r.events || [])
    } catch (e) { showToast(e.message, 'error') }
    finally { setLoading(false) }
  }, [showToast])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadEvents() }, [loadEvents])

  const loadBudget = useCallback(async () => {
    try {
      const r = await api.get(`/reports/scheduled-occurrences?start=${dkey(rangeStart)}&end=${dkey(rangeEnd)}`)
      setBudgetEvents((r.occurrences || []).map(o => ({
        id: `sched-${o.scheduled_id}-${o.date}`, calendar_id: `budget-${o.type}`, source: 'budget',
        title: `💰 ${o.title}  ${fmtMoney(o.amount_cents)}`, all_day: true, start: o.date, end: addDays(o.date, 1),
      })))
    } catch { setBudgetEvents([]) }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadBudget() }, [loadBudget])

  // start the rolling scroll at the week holding the 1st of today's month (also
  // re-runs when switching back to the scroll view, which remounts the grid)
  useLayoutEffect(() => {
    if (view !== 'current') return
    const c = scrollRef.current; if (!c) return
    const el = c.querySelector(`[data-firstof="${today.getFullYear()}-${today.getMonth()}"]`)
    if (el) c.scrollTop = el.offsetTop
  }, [view])  // eslint-disable-line react-hooks/exhaustive-deps

  // header label follows the month whose 1st most recently passed the top
  const onScroll = () => {
    const c = scrollRef.current; if (!c) return
    const line = c.scrollTop + 4
    let best = null
    for (const b of c.querySelectorAll('[data-firstof]')) { if (b.offsetTop <= line) best = b; else break }
    if (best) { const [y, m] = best.dataset.firstof.split('-').map(Number); setLabel(l => (l.y === y && l.m === m ? l : { y, m })) }
  }
  const scrollToToday = () => {
    const c = scrollRef.current; if (!c) return
    const el = c.querySelector(`[data-firstof="${today.getFullYear()}-${today.getMonth()}"]`)
    if (el) c.scrollTo({ top: el.offsetTop, behavior: 'smooth' })
  }
  // "Today": snap the rolling scroll, or re-focus the paged views on today
  const goToday = () => { setCursor(new Date()); if (view === 'current') scrollToToday() }

  const calById  = { ...Object.fromEntries(cals.map(c => [c.id, c])), ...BUDGET_CAL }
  const writable = cals.filter(c => c.writable)
  const errors   = events.filter(e => e.error)
  const visible  = events.filter(e => !e.error)
  const overlay  = [...visible, ...budgetEvents]

  const byDay = {}
  for (const ev of overlay) for (const d of eventDays(ev)) (byDay[d] = byDay[d] || []).push(ev)
  for (const d of Object.keys(byDay)) byDay[d].sort((a, b) => (b.all_day - a.all_day) || a.start.localeCompare(b.start))

  // ── modal ──
  const openNew = (dayKey, hour) => {
    const base = dayKey || todayKey
    const sh = hour == null ? 9 : hour
    const eh = Math.min(sh + 1, 23)
    setForm({ ...EMPTY_FORM, calendar_id: writable[0]?.id || '', startDate: base, endDate: base, start: `${base}T${pad(sh)}:00`, end: `${base}T${pad(eh)}:00` })
    setModal('new')
  }
  const openEdit = (ev) => {
    setForm({
      title: ev.title, calendar_id: ev.calendar_id, all_day: ev.all_day,
      location: ev.location || '', notes: ev.notes || '',
      start: ev.all_day ? '' : toLocalInput(ev.start), end: ev.all_day ? '' : toLocalInput(ev.end),
      startDate: ev.all_day ? ev.start.slice(0, 10) : dkey(new Date(ev.start)),
      endDate:   ev.all_day ? addDays(ev.end.slice(0, 10), -1) : dkey(new Date(ev.end)),
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
      end:   form.all_day ? addDays(form.endDate, 1) : toISO(form.end),
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
      showToast('Event deleted', 'success'); close(); loadEvents()
    } catch (e) { showToast(e.message, 'error') }
    finally { setBusy(false) }
  }
  const toggleCal = async (c) => {
    try { await api.patch(`/calendar/calendars/${c.id}`, { visible: !c.visible }); loadCals(); loadEvents() }
    catch (e) { showToast(e.message, 'error') }
  }

  const readonly = modal && modal !== 'new' && modal.readonly
  // feature-detect the list modules → show them as a calendar-side panel
  const hasTodo = navModules.some(m => m.id === 'todo')
  const hasGroceries = navModules.some(m => m.id === 'groceries')
  const showPanel = (hasTodo || hasGroceries) && showSide

  // ── view-aware header (label + color), nav arrows, paged day-sets ──
  const wkDays = weekDays(cursor, weekStart)
  const monShort = (d) => MONTHS[d.getMonth()].slice(0, 3)
  let headMain, headSub, headColor
  if (view === 'current')      { headMain = MONTHS[label.m];           headSub = String(label.y);                headColor = MONTH_COLORS[label.m] }
  else if (view === 'month')   { headMain = MONTHS[cursor.getMonth()]; headSub = String(cursor.getFullYear());    headColor = MONTH_COLORS[cursor.getMonth()] }
  else if (view === 'day')     { headMain = `${DOW_SUN[cursor.getDay()]} ${monShort(cursor)} ${cursor.getDate()}`; headSub = String(cursor.getFullYear()); headColor = MONTH_COLORS[cursor.getMonth()] }
  else /* week */ {
    const a = wkDays[0], b = wkDays[6]
    headMain = a.getMonth() === b.getMonth() ? `${monShort(a)} ${a.getDate()} – ${b.getDate()}` : `${monShort(a)} ${a.getDate()} – ${monShort(b)} ${b.getDate()}`
    headSub = a.getFullYear() === b.getFullYear() ? String(a.getFullYear()) : `${a.getFullYear()} / ${b.getFullYear()}`
    headColor = MONTH_COLORS[a.getMonth()]
  }
  const navArrow = { ...btnS, padding: '4px 11px', fontSize: 16, lineHeight: 1 }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', overflow: 'hidden' }}>

      {/* ── slim top bar (label tracks the visible month) ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 16px', borderBottom: '1px solid var(--border-color,#2a2a2a)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {view !== 'current' && <button style={navArrow} onClick={() => shift(-1)}>‹</button>}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.04em', color: headColor }}>{headMain}</span>
            <span style={{ fontSize: 18, color: 'var(--text-tertiary,#888)', fontFamily: 'monospace' }}>{headSub}</span>
            {loading && <span style={{ fontSize: 10, color: 'var(--text-tertiary,#666)' }}>syncing…</span>}
          </div>
          {view !== 'current' && <button style={navArrow} onClick={() => shift(1)}>›</button>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 6, overflow: 'hidden' }}>
            {VIEWS.map(([v, lbl], i) => (
              <button key={v} onClick={() => setView(v)}
                style={{ fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 10px', border: 'none', borderLeft: i ? '1px solid var(--border-color,#2a2a2a)' : 'none', cursor: 'pointer', background: view === v ? 'var(--text-primary,#e8e6e0)' : 'none', color: view === v ? 'var(--bg-primary,#0f0f0f)' : 'var(--text-secondary,#aaa)' }}>{lbl}</button>
            ))}
          </div>
          <button style={btnS} onClick={goToday}>Today</button>
          <button style={btnP} onClick={() => openNew()} disabled={!writable.length}>+ Event</button>
          <div style={{ position: 'relative' }}>
            <button style={menuOpen ? btnP : btnS} onClick={() => setMenuOpen(o => !o)}>Menu</button>
            {menuOpen && (
              <>
                <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 150 }} />
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 151, minWidth: 220, background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 28px var(--shadow-color,rgba(0,0,0,0.45))' }}>
                  {/* side panel position / collapse — only when a list module is active */}
                  {(hasTodo || hasGroceries) && (
                    <>
                      <div style={{ padding: '8px 16px 4px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#666)' }}>Side panel</div>
                      <div style={{ display: 'flex', gap: 6, padding: '4px 16px 10px' }}>
                        {[['left', '◧ Left'], ['right', '◨ Right'], ['off', '✕ Hide']].map(([v, lbl]) => {
                          const on = v === 'off' ? !showSide : (showSide && side === v)
                          return (
                            <button key={v} onClick={() => { (v === 'off' ? setShowSide(false) : setSide(v)); setMenuOpen(false) }}
                              style={{ flex: 1, fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.04em', padding: '7px 4px', borderRadius: 5, cursor: 'pointer', border: `1px solid ${on ? ACCENT : 'var(--border-color,#333)'}`, background: on ? `${ACCENT}22` : 'none', color: on ? ACCENT : 'var(--text-secondary,#aaa)' }}>{lbl}</button>
                          )
                        })}
                      </div>
                      <div style={{ borderTop: '1px solid var(--border-color,#2a2a2a)' }} />
                    </>
                  )}
                  {cals.length > 0 && <div style={{ padding: '8px 16px 4px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#666)' }}>Calendars</div>}
                  {cals.map(c => (
                    <button key={`cal-${c.id}`} onClick={() => toggleCal(c)} title={c.account_label ? `${c.account_label} (${c.kind})` : 'thrive calendar'}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, textAlign: 'left', color: c.visible ? 'var(--text-primary,#e8e6e0)' : 'var(--text-tertiary,#666)' }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: c.visible ? c.color : 'var(--border-color,#444)' }} />
                      {c.name}{!c.writable && ' 🔒'}
                    </button>
                  ))}
                  <div style={{ borderTop: '1px solid var(--border-color,#2a2a2a)' }} />
                  {[{ id: 'home', icon: '🏠', name: 'Home', nav_path: '/' }, ...navModules, { id: 'settings', icon: '⚙️', name: 'Settings', nav_path: '/settings' }].map((m, i) => (
                    <button key={m.id} onClick={() => { setMenuOpen(false); navigate(m.nav_path) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '11px 16px', background: 'none', border: 'none', borderTop: i ? '1px solid var(--border-color,#2a2a2a)' : 'none', color: 'var(--text-primary,#e8e6e0)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, textAlign: 'left' }}>
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

      {/* ── calendar grid + the side lists (todo / groceries, feature-detected) ── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {showPanel && side === 'left' && <SideLists hasTodo={hasTodo} hasGroceries={hasGroceries} side="left" onCollapse={() => setShowSide(false)} />}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>

      {/* ── day-of-week strip (Scroll + Month share the 7-col grid) ── */}
      {(view === 'current' || view === 'month') && (
        <div style={{ ...COL7, borderBottom: '1px solid var(--border-color,#2a2a2a)', flexShrink: 0 }}>
          {DOW.map(d => <div key={d} style={{ padding: '8px 0', textAlign: 'center', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-tertiary,#666)' }}>{d}</div>)}
        </div>
      )}

      {/* ── Scroll: one continuous stream of weeks; months flow into each other,
             the 1st is tinted + labelled in-cell (scrollbar hidden — touch wall) ── */}
      {view === 'current' && (
        <>
          <style>{`.cal-scroll::-webkit-scrollbar{display:none}.cal-scroll{scrollbar-width:none;-ms-overflow-style:none}`}</style>
          <div ref={scrollRef} onScroll={onScroll} className="cal-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {weeks.map((week, wi) => {
              const firstOf = week.find(d => d && d.getDate() === 1)
              const anchor = firstOf ? `${firstOf.getFullYear()}-${firstOf.getMonth()}` : undefined
              return (
                <div key={wi} {...(anchor ? { 'data-firstof': anchor } : {})} style={COL7}>
                  {week.map((d, ci) => {
                    if (!d) return <div key={ci} style={{ minHeight: 'clamp(74px, 11vh, 120px)', borderTop: wi ? '1px solid var(--border-color,#1c1c1c)' : 'none', borderLeft: ci ? '1px solid var(--border-color,#1c1c1c)' : 'none', background: 'var(--bg-secondary,#141414)', opacity: 0.4 }} />
                    const k = dkey(d)
                    const isToday = k === todayKey
                    const isFirst = d.getDate() === 1
                    const mc = MONTH_COLORS[d.getMonth()]
                    const dayEvents = byDay[k] || []
                    return (
                      <div key={ci} onClick={() => writable.length && openNew(k)}
                        style={{ minHeight: 'clamp(74px, 11vh, 120px)', minWidth: 0, overflow: 'hidden', padding: 5, cursor: writable.length ? 'pointer' : 'default', boxSizing: 'border-box',
                          borderTop: wi ? '1px solid var(--border-color,#2a2a2a)' : 'none',
                          borderLeft: isFirst ? `3px solid ${mc}` : (ci ? '1px solid var(--border-color,#2a2a2a)' : 'none'),
                          background: isToday ? `${mc}1f` : isFirst ? `${mc}14` : `${mc}0d` }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3 }}>
                          {isFirst && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', fontFamily: 'monospace', color: mc }}>{MON_ABBR[d.getMonth()]}{d.getMonth() === 0 ? ` ${d.getFullYear()}` : ''}</span>}
                          <span style={{ fontSize: 13, fontFamily: 'monospace', padding: '1px 4px', color: (isToday || isFirst) ? mc : 'var(--text-tertiary,#888)', fontWeight: (isToday || isFirst) ? 700 : 400 }}>{d.getDate()}</span>
                        </div>
                        {dayEvents.slice(0, 5).map(ev => (
                          <div key={`${ev.calendar_id}:${ev.id}:${k}`} onClick={e => { e.stopPropagation(); ev.source === 'budget' ? navigate('/budget') : openEdit(ev) }}
                            title={`${ev.title}${ev.all_day ? '' : ` · ${fmtTime(ev.start)}`}`}
                            style={{ fontSize: 11, lineHeight: '17px', padding: '0 5px', marginBottom: 2, borderRadius: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', background: `${calById[ev.calendar_id]?.color || ACCENT}33`, borderLeft: `2px solid ${calById[ev.calendar_id]?.color || ACCENT}` }}>
                            {!ev.all_day && <span style={{ color: 'var(--text-tertiary,#999)', fontFamily: 'monospace' }}>{fmtTime(ev.start)} </span>}{ev.title}
                          </div>
                        ))}
                        {dayEvents.length > 5 && <div style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', paddingLeft: 5 }}>+{dayEvents.length - 5} more</div>}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── Month: a single month, sized to fill the screen ── */}
      {view === 'month' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {monthGrid(cursor, weekStart).map((week, wi) => (
            <div key={wi} style={{ ...COL7, flex: 1, minHeight: 0 }}>
              {week.map((d, ci) => {
                const k = dkey(d)
                const isToday = k === todayKey
                const inMonth = d.getMonth() === cursor.getMonth()
                const isFirst = d.getDate() === 1
                const mc = MONTH_COLORS[d.getMonth()]
                const dayEvents = byDay[k] || []
                return (
                  <div key={ci} onClick={() => writable.length && openNew(k)}
                    style={{ minWidth: 0, overflow: 'hidden', padding: 5, cursor: writable.length ? 'pointer' : 'default', boxSizing: 'border-box',
                      borderTop: wi ? '1px solid var(--border-color,#2a2a2a)' : 'none',
                      borderLeft: isFirst ? `3px solid ${mc}` : (ci ? '1px solid var(--border-color,#2a2a2a)' : 'none'),
                      background: isToday ? `${mc}1f` : inMonth ? (isFirst ? `${mc}14` : `${mc}0d`) : 'none',
                      opacity: inMonth ? 1 : 0.4 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3 }}>
                      {isFirst && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', fontFamily: 'monospace', color: mc }}>{MON_ABBR[d.getMonth()]}{d.getMonth() === 0 ? ` ${d.getFullYear()}` : ''}</span>}
                      <span style={{ fontSize: 13, fontFamily: 'monospace', padding: '1px 4px', color: (isToday || isFirst) ? mc : 'var(--text-tertiary,#888)', fontWeight: (isToday || isFirst) ? 700 : 400 }}>{d.getDate()}</span>
                    </div>
                    {dayEvents.slice(0, 4).map(ev => (
                      <div key={`${ev.calendar_id}:${ev.id}:${k}`} onClick={e => { e.stopPropagation(); ev.source === 'budget' ? navigate('/budget') : openEdit(ev) }}
                        title={`${ev.title}${ev.all_day ? '' : ` · ${fmtTime(ev.start)}`}`}
                        style={{ fontSize: 11, lineHeight: '17px', padding: '0 5px', marginBottom: 2, borderRadius: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', background: `${calById[ev.calendar_id]?.color || ACCENT}33`, borderLeft: `2px solid ${calById[ev.calendar_id]?.color || ACCENT}` }}>
                        {!ev.all_day && <span style={{ color: 'var(--text-tertiary,#999)', fontFamily: 'monospace' }}>{fmtTime(ev.start)} </span>}{ev.title}
                      </div>
                    ))}
                    {dayEvents.length > 4 && <div style={{ fontSize: 10, color: 'var(--text-tertiary,#666)', paddingLeft: 5 }}>+{dayEvents.length - 4} more</div>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* ── Week / Day: hourly timeline ── */}
      {(view === 'week' || view === 'day') && (
        <TimeGrid
          days={view === 'week' ? wkDays : [new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())]}
          byDay={byDay} calById={calById} accent={ACCENT} todayKey={todayKey}
          onOpenEvent={ev => (ev.source === 'budget' ? navigate('/budget') : openEdit(ev))}
          onNewAt={(k, h) => writable.length && openNew(k, h)} />
      )}
          {(hasTodo || hasGroceries) && !showSide && (
            <button onClick={() => setShowSide(true)} title="show lists"
              style={{ position: 'absolute', top: 8, [side === 'left' ? 'left' : 'right']: 0, zIndex: 6, background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: side === 'left' ? '0 8px 8px 0' : '8px 0 0 8px', color: 'var(--text-secondary,#aaa)', fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: '10px 6px' }}>
              {side === 'left' ? '›' : '‹'}
            </button>
          )}
        </div>
        {showPanel && side === 'right' && <SideLists hasTodo={hasTodo} hasGroceries={hasGroceries} side="right" onCollapse={() => setShowSide(false)} />}
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
              <input style={inp} value={form.title} autoFocus={modal === 'new'} disabled={readonly} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Calendar</label>
                <select style={inp} value={form.calendar_id} disabled={readonly || modal !== 'new'} onChange={e => setForm(f => ({ ...f, calendar_id: e.target.value }))}>
                  {(modal === 'new' ? writable : cals).map(c => <option key={c.id} value={c.id}>{c.name}{c.account_label ? ` · ${c.account_label}` : ''}</option>)}
                </select>
              </div>
              <div style={{ alignSelf: 'flex-end', paddingBottom: 7 }}>
                <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--text-secondary,#aaa)' }}>
                  <input type="checkbox" checked={form.all_day} disabled={readonly} onChange={e => setForm(f => ({ ...f, all_day: e.target.checked }))} /> all day
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
              <textarea style={{ ...inp, minHeight: 54, resize: 'vertical' }} value={form.notes} disabled={readonly} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
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
