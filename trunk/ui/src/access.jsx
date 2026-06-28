// =============================================================================
// access.jsx — per-profile module access (#7 Phase B) on the frontend.
// GET /modules returns each module's `access` level for the current viewer
// (none | view | read | write); admins always get 'write'. Default is 'none'
// (locked down — #18), so a module only shows once an admin grants it.
// =============================================================================
import { useState, useEffect } from 'react'
import { api } from './api'
import { useAuth } from './context/AuthContext'

// Live module list (with per-viewer access). null while loading; refetches on
// login / profile-switch and on module install/enable changes.
export function useModules() {
  const { user } = useAuth()
  const [modules, setModules] = useState(null)
  useEffect(() => {
    if (!user) { setModules([]); return }
    let alive = true
    const load = () => api.get('/modules').then(m => { if (alive) setModules(m) }).catch(() => {})
    load()
    window.addEventListener('thrive:modules-changed', load)
    return () => { alive = false; window.removeEventListener('thrive:modules-changed', load) }
  }, [user])
  return modules
}

// visible in nav / landing: active AND not locked out
export const canSee  = (m) => !!(m && m.installed && m.enabled && m.access && m.access !== 'none')
// may open the module's page (view = tile shows but page is gated)
export const canOpen = (level) => level === 'read' || level === 'write'

export function ModuleLocked() {
  return (
    <div style={{ minHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <div style={{ fontSize: 40 }}>🔒</div>
      <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 13, color: 'var(--text-secondary,#aaa)' }}>
        You don't have access to this module.
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary,#666)' }}>Ask an admin to grant access in Settings.</div>
    </div>
  )
}
