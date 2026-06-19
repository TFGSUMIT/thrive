// =============================================================================
// modules/home/ui/index.jsx — the home module's UI registration
//
// Discovered at build time by core's Vite glob (modules/<name>/ui/index.jsx).
// Default-export the module's UI contract: an id, its route path, the page
// component, and optionally an `Ambient` background renderer. Module code reaches
// core's shared helpers through the `@trunk` alias (api, contexts, etc.).
// =============================================================================
import HomePage from './HomePage'

export default {
  id: 'home',
  path: '/home',
  Page: HomePage,
}
