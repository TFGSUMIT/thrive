// =============================================================================
// App.jsx — thrive shell
// Minimal: auth gate, top nav, landing, settings
// =============================================================================
import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider }   from './context/ToastContext'
import { ConfirmProvider } from './context/ConfirmModal'
import { VaultProvider }   from './context/VaultContext'
import { api } from './api'
import LoginPage   from './components/LoginPage'
import LandingPage from './pages/LandingPage'
import SettingsPage from './pages/SettingsPage'
import { MODULES } from './moduleRegistry'

// Module UIs are discovered entirely at build time (see moduleRegistry.js).
// Routes + the ambient map below read from MODULES; nav is driven by GET /modules.

// ── top nav ───────────────────────────────────────────────────────────────────
// Custom nav icon order is persisted per-device (localStorage) — the icon
// arrangement is a property of this screen/kiosk, not the account.
const NAV_ORDER_KEY = 'thrive:navOrder'
const loadNavOrder = () => { try { return JSON.parse(localStorage.getItem(NAV_ORDER_KEY)) || [] } catch { return [] } }

function TopNav() {
  const { user, logout } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()
  const [hov, setHov] = useState(null)
  const [modules, setModules] = useState([])
  const [order,  setOrder]  = useState(loadNavOrder)   // array of module ids
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)

  useEffect(() => {
    if (!user) { setModules([]); return }
    const fetchModules = () => api.get('/modules').then(setModules).catch(() => {})
    fetchModules()
    window.addEventListener('thrive:modules-changed', fetchModules)
    return () => window.removeEventListener('thrive:modules-changed', fetchModules)
  }, [user])

  // active nav modules, arranged by the saved order; unknown/new ones fall to the end
  const active = modules.filter(m => m.installed && m.enabled && m.nav_path)
  const byId   = new Map(active.map(m => [m.id, m]))
  const navModules = [
    ...order.filter(id => byId.has(id)).map(id => byId.get(id)),
    ...active.filter(m => !order.includes(m.id)),
  ]

  const persistOrder = (ids) => {
    setOrder(ids)
    try { localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(ids)) } catch {}
  }
  const dropOn = (targetId) => {
    if (dragId && dragId !== targetId) {
      const ids = navModules.map(m => m.id)
      ids.splice(ids.indexOf(dragId), 1)            // pull the dragged id out
      ids.splice(ids.indexOf(targetId), 0, dragId)  // drop it in front of the target
      persistOrder(ids)
    }
    setDragId(null); setOverId(null)
  }

  const path = location.pathname
  // active module icon sits on a pill tinted with the module's own color; a 1px
  // (transparent when idle) border keeps sizing stable across states.
  const iconBtn = (id, color) => {
    const active = path.startsWith(`/${id}`) || (id === 'home' && path === '/')
    return {
      width: 36, height: 36, borderRadius: 8,
      background: active ? (color ? `${color}26` : 'var(--bg-tertiary,#2a2a2a)') : hov === id ? 'var(--bg-tertiary,#222)' : 'none',
      border: `1px solid ${active && color ? `${color}66` : 'transparent'}`,
      cursor: 'pointer', fontSize: 16,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: active ? 1 : hov === id ? 0.85 : 0.5,
      transition: 'opacity 0.12s, background 0.12s, border-color 0.12s',
    }
  }

  if (!user) return null
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 48, zIndex: 200, background: 'var(--bg-secondary,#181818)', borderBottom: '1px solid var(--border-color,#2a2a2a)', display: 'flex', alignItems: 'center', padding: '0 12px', gap: 2 }}>
      <button onClick={() => navigate('/')} style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', background: 'none', border: 'none', color: 'var(--text-primary,#e8e6e0)', cursor: 'pointer', padding: '0 10px 0 4px', marginRight: 4, opacity: 0.9 }}>
        thrive
      </button>
      <div style={{ width: 1, height: 20, background: 'var(--border-color,#333)', marginRight: 6 }} />

      {/* module icons — dynamic + drag-to-reorder (order saved per device) */}
      {navModules.map(m => {
        const isOver = overId === m.id && dragId && dragId !== m.id
        return (
          <button key={m.id} onClick={() => navigate(m.nav_path)} title={m.name}
            draggable
            onDragStart={e => { setDragId(m.id); e.dataTransfer.effectAllowed = 'move' }}
            onDragEnter={() => setOverId(m.id)}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
            onDrop={e => { e.preventDefault(); dropOn(m.id) }}
            onDragEnd={() => { setDragId(null); setOverId(null) }}
            style={{
              ...iconBtn(m.id, m.color),
              cursor: 'grab',
              opacity: dragId === m.id ? 0.3 : iconBtn(m.id, m.color).opacity,
              boxShadow: isOver ? 'inset 2px 0 0 var(--text-primary,#e8e6e0)' : 'none',
            }}
            onMouseEnter={() => setHov(m.id)}
            onMouseLeave={() => setHov(null)}>
            {m.icon || '📦'}
          </button>
        )
      })}

      <div style={{ flex: 1 }} />
      <button onClick={() => navigate('/settings')} title="Settings"
        style={iconBtn('settings')}
        onMouseEnter={() => setHov('settings')}
        onMouseLeave={() => setHov(null)}>
        ⚙️
      </button>
    </div>
  )
}

// ── ambient background ────────────────────────────────────────────────────────
// A single per-device choice (`thrive:ambient` = { module, cfg }) drives which
// module's renderer paints behind all UI — only one ever does. A module's page
// "Set as background" button writes this key. The ambient renders only when its
// module is installed+enabled and you're not already on that module's own
// (full-quality) page. Forced to cheap quality.
const AMBIENT_KEY = 'thrive:ambient'
// background renderers keyed by module id, derived from the registry: a module
// becomes ambient-capable simply by declaring an `Ambient` component above
const AMBIENTS = Object.fromEntries(
  MODULES.filter(m => m.Ambient).map(m => [m.id, { path: m.path.replace('/*', ''), Comp: m.Ambient }])
)
function readAmbient() {
  try {
    const a = JSON.parse(localStorage.getItem(AMBIENT_KEY))
    if (a && a.module) return a
  } catch {}
  // back-compat: legacy blackhole-only key
  try {
    const legacy = JSON.parse(localStorage.getItem('thrive:blackhole:bg'))
    if (legacy) return { module: 'blackhole', cfg: legacy }
  } catch {}
  return null
}
function AmbientBackground() {
  const { user } = useAuth()
  const location = useLocation()
  const [modules, setModules] = useState([])
  const [ambient, setAmbient] = useState(readAmbient)

  useEffect(() => {
    if (!user) { setModules([]); return }
    const check = () => api.get('/modules').then(setModules).catch(() => {})
    check()
    const onAmbient = () => setAmbient(readAmbient())
    window.addEventListener('thrive:modules-changed', check)
    window.addEventListener('thrive:ambient-changed', onAmbient)
    return () => {
      window.removeEventListener('thrive:modules-changed', check)
      window.removeEventListener('thrive:ambient-changed', onAmbient)
    }
  }, [user])

  if (!ambient) return null
  const slot = AMBIENTS[ambient.module]
  const mod  = modules.find(m => m.id === ambient.module)
  if (!slot || !mod || !mod.installed || !mod.enabled) return null
  // never paint the ambient behind a full-screen renderer page (its own OR another's —
  // those pages fill the viewport with their own canvas)
  if (Object.values(AMBIENTS).some(s => location.pathname.startsWith(s.path))) return null

  const { Comp } = slot
  const cfg = ambient.cfg || {}
  return (
    <Comp
      params={cfg.params || {}}
      toggles={cfg.toggles || {}}
      quality="auto"           /* ambient/always-on -> self-tunes down on weak GPUs */
      opacity={0.6}
    />
  )
}

// ── module overlays (HUD) ─────────────────────────────────────────────────────
// A module may declare an `Overlay` component (like `Ambient`, but painted ON
// TOP of everything, even in immersive mode). Core renders the overlays of every
// active (installed+enabled) module — it names none of them. e.g. the FPS module.
const OVERLAYS = MODULES.filter(m => m.Overlay).map(m => ({ id: m.id, Comp: m.Overlay }))
function ModuleOverlays() {
  const { user } = useAuth()
  const [modules, setModules] = useState([])
  useEffect(() => {
    if (!user) { setModules([]); return }
    const check = () => api.get('/modules').then(setModules).catch(() => {})
    check()
    window.addEventListener('thrive:modules-changed', check)
    return () => window.removeEventListener('thrive:modules-changed', check)
  }, [user])
  return OVERLAYS
    .filter(o => { const m = modules.find(x => x.id === o.id); return m && m.installed && m.enabled })
    .map(o => { const Comp = o.Comp; return <Comp key={o.id} /> })
}

// ── root ────────────────────────────────────────────────────────────────────
// What loads at '/' is the server-wide "front page" setting (Settings → Front
// page): a module's nav_path, or the module tiles (LandingPage). When unset it
// auto-resolves — the only active module if there's just one, else Home, else tiles.
function RootRoute() {
  const [dest, setDest] = useState(undefined)   // undefined=loading | string nav_path | null=tiles
  useEffect(() => {
    let cancelled = false
    Promise.all([api.get('/modules'), api.get('/settings').catch(() => ({}))])
      .then(([ms, settings]) => {
        if (cancelled) return
        const navMods = ms.filter(m => m.installed && m.enabled && m.nav_path)
        const fp = settings?.front_page
        let d
        if (fp === 'landing') d = null                                   // explicit: module tiles
        else if (fp && navMods.find(m => m.id === fp)) d = navMods.find(m => m.id === fp).nav_path
        else if (navMods.length === 1) d = navMods[0].nav_path           // default: the only module
        else { const home = navMods.find(m => m.id === 'home'); d = home ? home.nav_path : null }
        setDest(d)
      })
      .catch(() => { if (!cancelled) setDest(null) })
    return () => { cancelled = true }
  }, [])
  if (dest === undefined) return null            // brief: avoid flashing tiles before redirect
  if (dest) return <Navigate to={dest} replace />
  return <LandingPage />
}

// ── shell ─────────────────────────────────────────────────────────────────────
function Shell() {
  // Immersive mode: a page (e.g. /blackhole) can hide ALL thrive chrome — top
  // nav included — leaving just its own canvas, so F11 gives a clean fullscreen.
  // The page owns the toggle and the way back out (Esc); it fires this event.
  const [immersive, setImmersive] = useState(false)
  useEffect(() => {
    const onImmersive = (e) => setImmersive(!!e.detail)
    window.addEventListener('thrive:immersive', onImmersive)
    return () => window.removeEventListener('thrive:immersive', onImmersive)
  }, [])
  return (
    <>
      <AmbientBackground />
      {!immersive && <TopNav />}
      {/* module HUD overlays (e.g. the FPS module) — painted on top, even in
          immersive so they can read frame-rate over a full-screen renderer */}
      <ModuleOverlays />
      <main style={{ marginTop: immersive ? 0 : 48, minHeight: immersive ? '100vh' : 'calc(100vh - 48px)' }}>
        <Routes>
          <Route path="/"         element={<RootRoute />} />
          {/* module routes — emitted from the registry, not hardcoded.
              Headless modules (no nav route, e.g. fps) declare no path/Page. */}
          {MODULES.filter(m => m.path && m.Page).map(m => {
            const Page = m.Page
            return <Route key={m.id} path={m.path} element={<Page />} />
          })}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*"         element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  )
}

// ── gate ──────────────────────────────────────────────────────────────────────
function Gate() {
  const { user, loading } = useAuth()
  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary,#888)', fontFamily: 'monospace', fontSize: 13 }}>
      Loading…
    </div>
  )
  if (!user) return <LoginPage />
  return <Shell />
}

export default function App() {
  // apply the saved UI opacity globally on load (Settings → UI)
  useEffect(() => {
    const v = parseFloat(localStorage.getItem('thrive:uiAlpha'))
    if (!isNaN(v)) document.documentElement.style.setProperty('--ui-alpha', String(v))
  }, [])
  return (
    <BrowserRouter>
      <AuthProvider>
        <VaultProvider>
          <ToastProvider>
            <ConfirmProvider>
              <Gate />
            </ConfirmProvider>
          </ToastProvider>
        </VaultProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}