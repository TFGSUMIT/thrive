// =============================================================================
// moduleRegistry.js — the build-time module registry (single source of truth)
//
// Discovers every module UI at build time via a Vite glob over
// modules/<name>/ui/index.jsx, each default-exporting its contract:
//     { id, path?, Page?, Ambient?, Overlay?, settings? }
//   • Page     — the nav route component (omit for a headless module)
//   • Ambient  — optional background renderer (painted BEHIND the UI)
//   • Overlay  — optional HUD renderer (painted ON TOP, even in immersive)
//   • settings — optional Settings panel: { title, Panel, defaultOpen?, padded? }
//
// Both the shell (App.jsx → routes + ambient) and Settings (→ settings panels)
// read MODULES from here. With modules/ empty the glob is empty and core stands
// alone. Nav remains driven by GET /modules (active set); this registry only
// supplies the compiled-in UI pieces.
// =============================================================================
const discovered = import.meta.glob('../../../modules/*/ui/index.jsx', { eager: true })

export const MODULES = Object.values(discovered).map(m => m.default).filter(Boolean)
