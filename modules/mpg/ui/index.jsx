// modules/mpg/ui/index.jsx — MPG module UI registration (build-time discovered)
// Standalone fuel/MPG tracker. Feature-detects the vehicles module: its vehicle
// selector fetches /api/vehicles and degrades gracefully (no selector) when the
// vehicles module isn't installed. Vision photo-extract feature-detects lmstudio.
import MPGPage from './MPGPage'

export default {
  id: 'mpg',
  path: '/mpg',
  Page: MPGPage,
}
