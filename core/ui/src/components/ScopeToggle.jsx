// =============================================================================
// ScopeToggle.jsx — shared Household / Mine / All control for personal-aware views
//
// Part of the personal-data platform (Phase 1). A module that has personal rows
// (an `owner_user_id` column) drops this in to let the viewer switch between the
// shared household data, their own personal data, or both. Value is one of
// 'all' | 'household' | 'mine' — pass it through to the API as ?scope=…
//
//   import ScopeToggle from '@core/components/ScopeToggle'
//   <ScopeToggle value={scope} onChange={setScope} />
//
// Renders nothing when the viewer has no profile (a shared/kiosk login can't own
// personal data — there's only the household), so modules can always include it.
// =============================================================================
import { useAuth } from '../context/AuthContext'

const LABELS = { all: 'All', household: 'Household', mine: 'Mine' }

export default function ScopeToggle({ value, onChange, options = ['all', 'household', 'mine'] }) {
  const { user } = useAuth()
  if (!user?.profile) return null   // no profile → nothing personal is possible

  return (
    <div role="tablist" style={{ display: 'inline-flex', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 8, overflow: 'hidden' }}>
      {options.map((opt, i) => {
        const active = value === opt
        return (
          <button key={opt} role="tab" aria-selected={active} onClick={() => onChange(opt)}
            style={{
              fontFamily: 'var(--font-mono,monospace)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '5px 12px', cursor: 'pointer', border: 'none',
              borderLeft: i ? '1px solid var(--border-color,#2a2a2a)' : 'none',
              background: active ? 'var(--accent,#e8e6e0)' : 'transparent',
              color: active ? 'var(--bg-primary,#0f0f0f)' : 'var(--text-secondary,#aaa)',
              fontWeight: active ? 600 : 400,
            }}>
            {LABELS[opt] || opt}
          </button>
        )
      })}
    </div>
  )
}
