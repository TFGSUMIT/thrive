import ConnectionsPage from './ConnectionsPage'

// Connections module — per-profile external logins (encrypted). Opt-in: shows a
// nav page only when installed + enabled.
export default {
  id: 'connections',
  path: '/connections',
  Page: ConnectionsPage,
}
