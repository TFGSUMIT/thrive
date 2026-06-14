// modules/fps/ui/index.jsx — FPS Meter module UI registration (build-time discovered)
// A headless module: no nav route/Page — it contributes an `Overlay` (a top HUD
// badge painted above all UI when the module is active) and a Settings panel.
import FpsOverlay from './FpsOverlay'
import FpsPanel from './FpsPanel'

export default {
  id: 'fps',
  Overlay: FpsOverlay,
  settings: { title: 'FPS Meter', Panel: FpsPanel },
}
