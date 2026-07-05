// tv module UI registration — a native LiveTV guide over Jellyfin, with a
// launcher to the full Jellyfin app for playback.
import TvPage from './TvPage'

export default {
  id: 'tv',
  path: '/tv',
  Page: TvPage,
}
