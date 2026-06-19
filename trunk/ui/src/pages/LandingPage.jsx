// =============================================================================
// LandingPage.jsx — Module hub
// thrive UI
// =============================================================================
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'

export default function LandingPage() {
  const { user }    = useAuth()
  const navigate    = useNavigate()
  const [modules, setModules] = useState([])
  const [hov,     setHov]     = useState(null)

  useEffect(() => {
    const fetchModules = () => api.get('/modules').then(setModules).catch(() => {})
    fetchModules()
    window.addEventListener('thrive:modules-changed', fetchModules)
    return () => window.removeEventListener('thrive:modules-changed', fetchModules)
  }, [])

  // only active (installed + enabled) modules with a page become feature tiles.
  // Headless modules (no nav_path, e.g. lmstudio) are surfaced via Settings only,
  // matching the nav-bar filter in App.jsx.
  const enabled = modules.filter(m => m.installed && m.enabled && !m.core && m.nav_path)

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '3rem 2rem' }}>
      <div style={{ marginBottom: '3rem' }}>
        <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 28, fontWeight: 700, letterSpacing: '0.06em' }}>thrive</div>
        <div style={{ fontSize: 13, color: 'var(--text-tertiary,#666)', marginTop: 6 }}>Welcome back, {user?.profile?.name || user?.username}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
        {enabled.length === 0 ? (
          <div style={{ background: 'var(--bg-secondary,#181818)', border: '2px dashed var(--border-color,#2a2a2a)', borderRadius: 12, padding: '32px 24px', textAlign: 'center', color: 'var(--text-tertiary,#555)', fontSize: 12, lineHeight: 1.8 }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>＋</div>
            No modules installed yet.<br />
            Go to Settings → Modules<br />to add features.
          </div>
        ) : (
          enabled.map(m => (
            <div key={m.id}
              onClick={() => navigate(m.nav_path || `/${m.id}`)}
              onMouseEnter={() => setHov(m.id)}
              onMouseLeave={() => setHov(null)}
              style={{
                background: 'var(--bg-secondary,#181818)',
                border: `1px solid ${hov === m.id ? (m.color || '#444') + '66' : 'var(--border-color,#2a2a2a)'}`,
                borderRadius: 12, padding: '28px 24px', cursor: 'pointer',
                transform: hov === m.id ? 'translateY(-2px)' : 'none',
                transition: 'border-color 0.15s, transform 0.12s',
              }}>
              <div style={{ fontSize: 32, marginBottom: 12, lineHeight: 1 }}>{m.icon || '📦'}</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{m.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary,#888)', lineHeight: 1.5 }}>{m.description}</div>
              <div style={{ marginTop: 14, fontSize: 10, color: m.color || 'var(--text-tertiary,#666)', fontFamily: 'monospace', letterSpacing: '0.06em' }}>Open →</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}