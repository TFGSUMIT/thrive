// Background.jsx — the shell's ambient background: a single per-device choice
// (`thrive:ambient`) picks what paints BEHIND all UI. One of:
//   blackhole / grovekeeper (WebGL renderers) · logo (the thrive mark) ·
//   image (custom URL or upload) · color (solid) · none.
// Chosen in Settings → Device → Background. This absorbs what used to be the
// standalone `blackhole` and `grovekeeper` modules (#15): their renderer libs
// live in trunk/ (Vite-aliased) and are imported here directly — core owns the
// background, no module wrappers needed.
import { useEffect, useState } from 'react'
import BlackHoleBackground from 'blackhole-lensing/react/BlackHoleBackground'
import TreeBackground from 'grovekeeper/react/TreeBackground'

export const BACKGROUND_KEY = 'thrive:ambient'

// The selectable kinds, in display order. `webgl` ones need the renderer libs.
export const BACKGROUND_OPTS = [
  { kind: 'none',        label: 'None' },
  { kind: 'blackhole',   label: 'Black hole' },
  { kind: 'grovekeeper', label: 'Grove' },
  { kind: 'logo',        label: 'Thrive logo' },
  { kind: 'color',       label: 'Color' },
  { kind: 'image',       label: 'Image' },
]

// Canonical read → { kind, ... } | null. Back-compat: the previous shape was
// { module: 'blackhole'|'grovekeeper', cfg }, and an even older blackhole-only key.
export function readBackground() {
  try {
    const a = JSON.parse(localStorage.getItem(BACKGROUND_KEY))
    if (a) {
      if (a.kind) return a
      if (a.module === 'blackhole' || a.module === 'grovekeeper')
        return { kind: a.module, cfg: a.cfg || {} }
    }
  } catch {}
  try {
    const legacy = JSON.parse(localStorage.getItem('thrive:blackhole:bg'))
    if (legacy) return { kind: 'blackhole', cfg: legacy }
  } catch {}
  // Nothing ever chosen on this device → default to the thrive logo. (An explicit
  // "None" is stored as { kind: 'none' }, so it's distinct from this unset case.)
  return { kind: 'logo' }
}

// Persist a choice (per-device) and notify the live <Background/> + other tabs.
// Every choice — including "none" — is stored, so it overrides the logo default.
export function writeBackground(choice) {
  localStorage.setItem(BACKGROUND_KEY, JSON.stringify(choice || { kind: 'none' }))
  window.dispatchEvent(new CustomEvent('thrive:ambient-changed'))
}

// ── saved presets (per device) ────────────────────────────────────────────────
// Named blackhole/grove looks, stored client-side (the whole background system is
// per-device localStorage, so presets match). Each: { name, kind, cfg:{params,toggles} }.
const PRESETS_KEY = 'thrive:bg-presets'
export function readBgPresets() {
  try { const a = JSON.parse(localStorage.getItem(PRESETS_KEY)); return Array.isArray(a) ? a : [] } catch { return [] }
}
export function saveBgPreset(name, kind, cfg) {
  const all = readBgPresets().filter(p => !(p.kind === kind && p.name === name))
  all.push({ name, kind, cfg })
  localStorage.setItem(PRESETS_KEY, JSON.stringify(all))
  return all
}
export function deleteBgPreset(name, kind) {
  const all = readBgPresets().filter(p => !(p.kind === kind && p.name === name))
  localStorage.setItem(PRESETS_KEY, JSON.stringify(all))
  return all
}
export const LOGO_SCALE_DEFAULT = 40   // vmin

const fill = { position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none' }

export default function Background() {
  const [bg, setBg] = useState(readBackground)
  useEffect(() => {
    const on = () => setBg(readBackground())
    window.addEventListener('thrive:ambient-changed', on)
    window.addEventListener('storage', on)   // reflect changes made in another tab
    return () => {
      window.removeEventListener('thrive:ambient-changed', on)
      window.removeEventListener('storage', on)
    }
  }, [])

  if (!bg || bg.kind === 'none') return null
  const cfg = bg.cfg || {}
  switch (bg.kind) {
    case 'blackhole':
      return <BlackHoleBackground quality="auto" opacity={0.6} params={cfg.params || {}} toggles={cfg.toggles || {}} />
    case 'grovekeeper':
      return <TreeBackground quality="auto" opacity={0.6} params={cfg.params || {}} toggles={cfg.toggles || {}} />
    case 'color':
      return <div style={{ ...fill, background: bg.color || 'var(--bg-primary,#0f0f0f)' }} />
    case 'image':
      return bg.url
        ? <div style={{ ...fill, background: `var(--bg-primary,#0f0f0f) url("${bg.url}") center/cover no-repeat` }} />
        : null
    case 'logo': {
      const size = Math.max(5, Math.min(95, bg.scale || LOGO_SCALE_DEFAULT))
      return (
        <div style={{ ...fill, background: 'var(--bg-primary,#0f0f0f)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src="/brand/thrive-logo.svg" alt="" draggable="false"
            style={{ width: `${size}vmin`, maxWidth: '92vw', opacity: 0.5 }} />
        </div>
      )
    }
    default:
      return null
  }
}
