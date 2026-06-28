// =============================================================================
// App.jsx — thrive shell
// Minimal: auth gate, top nav, landing, settings
// =============================================================================
import { useState, useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider }   from './context/ToastContext'
import { ConfirmProvider } from './context/ConfirmModal'
import { VaultProvider }   from './context/VaultContext'
import { api } from './api'
import LoginPage   from './components/LoginPage'
import OnboardingScreen from './components/OnboardingScreen'
import ProfilePicker    from './components/ProfilePicker'
import OnScreenKeyboard from './components/OnScreenKeyboard'
import ErrorBoundary from './components/ErrorBoundary'
import LandingPage from './pages/LandingPage'
import SettingsPage from './pages/SettingsPage'
import ClockPage from './pages/ClockPage'
import { useModules, ModuleLocked, canOpen } from './access'
import { MODULES } from './moduleRegistry'

// Module UIs are discovered entirely at build time (see moduleRegistry.js).
// Routes + the ambient map below read from MODULES; nav is driven by GET /modules.

// ── top nav ───────────────────────────────────────────────────────────────────
// Custom nav icon order is persisted per-device (localStorage) — the icon
// arrangement is a property of this screen/kiosk, not the account.
const NAV_ORDER_KEY = 'thrive:navOrder'
const loadNavOrder = () => { try { return JSON.parse(localStorage.getItem(NAV_ORDER_KEY)) || [] } catch { return [] } }

// Live date + time for the top bar (#6) — visible on every non-immersive page.
// Tapping it opens the clock screen (#16).
function Clock({ onClick }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const date = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return (
    <div onClick={onClick} role="button" title="Open clock" aria-label="current date and time — open clock"
      style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginRight: 6, whiteSpace: 'nowrap',
               fontFamily: 'var(--font-mono,monospace)', fontSize: 11,
               cursor: onClick ? 'pointer' : 'default', padding: '4px 8px', borderRadius: 6,
               border: '1px solid transparent' }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.borderColor = 'var(--border-color,#2a2a2a)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent' }}>
      <span style={{ color: 'var(--text-tertiary,#666)' }}>{date}</span>
      <span style={{ color: 'var(--text-primary,#e8e6e0)', letterSpacing: '0.04em' }}>{time}</span>
    </div>
  )
}

function TopNav({ onOpenPicker }) {
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

  // active nav modules, arranged by the saved order; unknown/new ones fall to the end.
  // #7 Phase B: only modules the viewer can see (access != 'none').
  const active = modules.filter(m => m.installed && m.enabled && m.nav_path && m.access !== 'none')
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

      <Clock onClick={() => navigate('/clock')} />

      {/* identity switcher — current user (Household or a person); opens the picker */}
      <button onClick={onOpenPicker} title="Switch profile"
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 8, padding: '5px 10px', marginRight: 6, cursor: 'pointer', color: 'var(--text-secondary,#aaa)', fontFamily: 'var(--font-mono,monospace)', fontSize: 11 }}>
        <span style={{ fontSize: 13 }}>{user.role === 'household' ? '🏠' : (user.profile?.avatar || '👤')}</span>
        <span>{user.role === 'household' ? 'Household' : (user.profile?.name || user.username)}</span>
      </button>

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
  const [pickerOpen, setPickerOpen] = useState(false)
  const location = useLocation()
  // #7 Phase B: viewer's per-module access (null while loading) — gates routes below
  const modules = useModules()
  const accessById = modules ? Object.fromEntries(modules.map(m => [m.id, m.access])) : null
  useEffect(() => {
    const onImmersive = (e) => setImmersive(!!e.detail)
    window.addEventListener('thrive:immersive', onImmersive)
    return () => window.removeEventListener('thrive:immersive', onImmersive)
  }, [])
  return (
    <>
      {/* ambient + HUD render module components; isolate them so a bad one fails
          silently instead of taking down the whole shell */}
      <ErrorBoundary silent><AmbientBackground /></ErrorBoundary>
      {!immersive && <TopNav onOpenPicker={() => setPickerOpen(true)} />}
      {/* module HUD overlays (e.g. the FPS module) — painted on top, even in
          immersive so they can read frame-rate over a full-screen renderer */}
      <ErrorBoundary silent><ModuleOverlays /></ErrorBoundary>
      {pickerOpen && <ProfilePicker onClose={() => setPickerOpen(false)} />}
      <main style={{ marginTop: immersive ? 0 : 48, minHeight: immersive ? '100vh' : 'calc(100vh - 48px)' }}>
        {/* a page crash (e.g. a just-enabled module whose API still 404s) shows a
            fallback here; nav + the rest of the shell stay alive. Re-keyed per
            route so navigating away clears it. */}
        <ErrorBoundary resetKey={location.pathname}>
          <Routes>
            <Route path="/"         element={<RootRoute />} />
            {/* module routes — emitted from the registry, not hardcoded.
                Headless modules (no nav route, e.g. fps) declare no path/Page.
                #7 Phase B: gate each on the viewer's access level. */}
            {MODULES.filter(m => m.path && m.Page).map(m => {
              const Page = m.Page
              let element
              if (accessById === null) element = null                         // modules not loaded yet
              else {
                const lvl = accessById[m.id] || 'none'
                element = canOpen(lvl) ? <Page />
                        : lvl === 'view' ? <ModuleLocked />
                        : <Navigate to="/" replace />
              }
              return <Route key={m.id} path={m.path} element={element} />
            })}
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/clock"    element={<ClockPage />} />
            <Route path="*"         element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </>
  )
}

// ── gate ──────────────────────────────────────────────────────────────────────
const GateLoading = () => (
  <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary,#888)', fontFamily: 'monospace', fontSize: 13 }}>
    Loading…
  </div>
)

// Phase-1 Client placeholder: a box configured as a Client of a Host. Full client
// mode (a local shell proxied to the Host) is Phase 2; for now, offer the Host link.
function ClientStub({ hostUrl }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: 'var(--bg-primary,#0f0f0f)', fontFamily: 'monospace', color: 'var(--text-secondary,#aaa)', padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-primary,#e8e6e0)' }}>thrive</div>
      <div style={{ fontSize: 13 }}>Client of <span style={{ color: 'var(--text-primary,#e8e6e0)' }}>{hostUrl || '—'}</span></div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary,#666)', maxWidth: 320, lineHeight: 1.6 }}>
        Full client mode (a local shell proxied to the Host) is coming. For now, open the Host directly.
      </div>
      <button onClick={() => hostUrl && (window.location.href = hostUrl)}
        style={{ padding: '10px 20px', fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', background: 'var(--text-primary,#e8e6e0)', border: 'none', borderRadius: 6, color: 'var(--bg-primary,#0f0f0f)', fontWeight: 600, cursor: 'pointer' }}>
        Open Host
      </button>
    </div>
  )
}

function Gate() {
  const { user, loading, setupNeeded, role, hostUrl, enterHousehold } = useAuth()
  const triedHousehold = useRef(false)
  const [householdFailed, setHouseholdFailed] = useState(false)

  const needsSetup    = setupNeeded && role === 'unset'
  const wantHousehold = !loading && !user && !needsSetup && role !== 'client'

  // Kiosk: with no session (and past first-boot setup) auto-enter the shared
  // Household view instead of showing a login. Re-armed once a real user logs in,
  // so a later logout drops back to Household. LoginPage is the fallback if a
  // Household session can't be minted (e.g. backend unreachable).
  useEffect(() => {
    if (wantHousehold && !triedHousehold.current) {
      triedHousehold.current = true
      enterHousehold().catch(() => setHouseholdFailed(true))
    }
    if (user) { triedHousehold.current = false; setHouseholdFailed(false) }
  }, [wantHousehold, user, enterHousehold])

  if (loading) return <GateLoading />
  if (needsSetup) return <OnboardingScreen />
  if (role === 'client' && !user) return <ClientStub hostUrl={hostUrl} />
  if (!user) return householdFailed ? <LoginPage /> : <GateLoading />
  return <Shell />
}

export default function App() {
  // apply the saved UI opacity globally on load (Settings → UI)
  useEffect(() => {
    const v = parseFloat(localStorage.getItem('thrive:uiAlpha'))
    if (!isNaN(v)) document.documentElement.style.setProperty('--ui-alpha', String(v))
    // apply the saved UI scale (Settings → UI) — per-device zoom for the kiosk
    const s = parseFloat(localStorage.getItem('thrive:uiScale'))
    if (!isNaN(s) && s > 0) document.documentElement.style.zoom = String(s)
    // touch kiosk (e.g. the wall): hide the pointer — it's a touch panel. cage
    // (Wayland) draws a compositor cursor for the touchscreen's pointer interface
    // that `cursor:none` doesn't reliably reach, so use a 1x1 transparent cursor
    // image (chromium honors url() cursors over Wayland more reliably than none).
    if ((navigator.maxTouchPoints || 0) > 0) {
      const blank = 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==") 0 0, none'
      const st = document.createElement('style')
      st.textContent = '*,*::before,*::after{cursor:' + blank + ' !important}'
      document.head.appendChild(st)
    }
  }, [])
  return (
    <BrowserRouter>
      <AuthProvider>
        <VaultProvider>
          <ToastProvider>
            <ConfirmProvider>
              <Gate />
              <OnScreenKeyboard />
            </ConfirmProvider>
          </ToastProvider>
        </VaultProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}