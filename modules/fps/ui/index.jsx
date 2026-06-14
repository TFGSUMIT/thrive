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
  settings: { title: 'FPS Meter', Panel: FpsPanel },
}
