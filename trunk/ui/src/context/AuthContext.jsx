import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { applyTheme, clearThemeCache, DEFAULT_THEME } from '../theme'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  const [user,        setUser]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [setupNeeded, setSetupNeeded] = useState(false)

  const refresh = useCallback(async () => {
    try { const me = await api.get('/auth/me'); setUser(me) }
    catch { setUser(null); try { const s = await api.get('/auth/status'); setSetupNeeded(!!s.setup_needed) } catch {} }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    const fn = () => setUser(null)
    window.addEventListener('thrive:unauthorized', fn)
    return () => window.removeEventListener('thrive:unauthorized', fn)
  }, [])

  // theme follows the logged-in account (prefs.theme). On sign-out / no account,
  // fall back to Thrive Classic and drop the paint-time cache.
  useEffect(() => {
    if (user) applyTheme(user.prefs?.theme || DEFAULT_THEME)
    else if (!loading) { applyTheme(DEFAULT_THEME); clearThemeCache() }
  }, [user, loading])

  const login    = async (u, p) => { const r = await api.post('/auth/login',   { username: u, password: p }); setUser(r); return r }
  const register = async (data) => { const r = await api.post('/auth/register', data); setSetupNeeded(false); setUser(r); return r }
  const logout   = async ()     => { try { await api.post('/auth/logout') } catch {}; setUser(null) }

  // self-serve per-user UI prefs (theme, …): persist server-side, merge locally so
  // the theme effect re-applies instantly
  const updatePrefs = useCallback(async (patch) => {
    const r = await api.patch('/auth/me/prefs', patch)
    setUser(u => (u ? { ...u, prefs: r.prefs } : u))
    return r.prefs
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, setupNeeded, login, register, logout, refresh, updatePrefs }}>
      {children}
    </AuthContext.Provider>
  )
}