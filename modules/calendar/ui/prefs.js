// Per-device calendar display prefs (localStorage) — a property of THIS screen,
// not the account (matches the ambient/nav-order convention). Currently just the
// week-start day. Changing it fires an event so an open calendar updates live.
export const WEEKSTART_KEY = 'thrive:calendar:weekStart'
export const PREFS_EVENT   = 'thrive:calendar-prefs-changed'

export const getWeekStart = () => {
  try { return localStorage.getItem(WEEKSTART_KEY) === 'sun' ? 'sun' : 'mon' } catch { return 'mon' }
}
export const setWeekStart = (v) => {
  const val = v === 'sun' ? 'sun' : 'mon'
  try { localStorage.setItem(WEEKSTART_KEY, val) } catch {}
  window.dispatchEvent(new Event(PREFS_EVENT))
}
