// modules/fps/ui/index.jsx — FPS Meter module UI registration (build-time discovered)
// A page (/fps, live readout + badge toggle) + an `Overlay` (the top HUD badge
// painted above all UI when the module is active) + a Settings panel.
import FpsPage from './FpsPage'
import FpsOverlay from './FpsOverlay'
import FpsPanel from './FpsPanel'

export default {
  id: 'fps',
  path: '/fps',
  Page: FpsPage,
  Overlay: FpsOverlay,
  // group:'device' → render inside core's Device settings card (with Power/Wi-Fi/UI)
  // instead of as a standalone card. Core stays module-agnostic; the module opts in.
  settings: { title: 'FPS Meter', Panel: FpsPanel, group: 'device' },
}
