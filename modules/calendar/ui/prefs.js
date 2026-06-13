// Per-device calendar display prefs (localStorage) — a property of THIS screen,
// not the account (matches the ambient/nav-order convention). Currently just the
// week-start day. Changing it fires an event so an open calendar updates live.
export const WEEKSTART_KEY = 'thrive:calendar:weekStart'
export const PREFS_EVENT   = 'thrive:calendar-prefs-changed'

// Default Sunday-first (US convention). Only an explicit 'mon' choice flips it.
export const getWeekStart = () => {
  try { return localStorage.getItem(WEEKSTART_KEY) === 'mon' ? 'mon' : 'sun' } catch { return 'sun' }
}
export const setWeekStart = (v) => {
  const val = v === 'sun' ? 'sun' : 'mon'
  try { localStorage.setItem(WEEKSTART_KEY, val) } catch {}
  window.dispatchEvent(new Event(PREFS_EVENT))
}
