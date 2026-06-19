// theme.js — the theme registry + how a theme gets applied.
//
// A theme is just a set of CSS-variable overrides. The actual values live in
// index.css: `:root` IS "Thrive Classic" (the default), and each alternate is a
// `:root[data-theme="<id>"]` block. Applying a theme = setting that attribute on
// <html>; everything styled with the vars re-colors instantly. Total coverage =
// keep routing colors through the vars (no hardcoded hexes).
//
// The choice is a PER-USER preference (accounts.prefs.theme, via /auth/me) so it
// follows your login across devices. We also mirror it into localStorage purely
// as a paint-time cache so a reload shows the right theme with no flash before
// /auth/me returns — the server value always wins.

export const THEMES = [
  { id: 'classic',  name: 'Thrive Classic' },
  { id: 'daybreak', name: 'Daybreak — light' },
]
export const DEFAULT_THEME = 'classic'
const CACHE_KEY = 'thrive:theme'

const valid = (id) => (THEMES.some(t => t.id === id) ? id : DEFAULT_THEME)

export function applyTheme(id) {
  const theme = valid(id)
  document.documentElement.dataset.theme = theme
  try { localStorage.setItem(CACHE_KEY, theme) } catch {}
  return theme
}

// paint-time hint: apply the cached theme before React renders (no flash on reload)
export function applyCachedTheme() {
  let cached = DEFAULT_THEME
  try { cached = localStorage.getItem(CACHE_KEY) || DEFAULT_THEME } catch {}
  document.documentElement.dataset.theme = valid(cached)
}

export function clearThemeCache() {
  try { localStorage.removeItem(CACHE_KEY) } catch {}
}
