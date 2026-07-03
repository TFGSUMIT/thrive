// search module UI registration — a native thrive front-end over SearXNG's JSON
// API (proxied at /search/ by nginx). No Ambient/Overlay/settings; just a page.
import SearchPage from './SearchPage'

export default {
  id: 'search',
  path: '/search',
  Page: SearchPage,
}
