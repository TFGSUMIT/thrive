// modules/budget/ui/index.jsx — budget module UI registration (build-time discovered)
// The budget module is a cluster: BudgetPage owns sub-routing (/budget/*) over its
// pages/ (accounts, transactions, categories, payees, scheduled, reports), with its
// own components/, utils/ and stylesheets co-located here. Core-shared bits (api,
// contexts, utils/vault) are reached via @trunk. The Plaid bank-sync settings panel
// is module-owned (shown in Settings when budget is active).
import BudgetPage from './pages/BudgetPage'
import PlaidPanel from './pages/PlaidPanel'

export default {
  id: 'budget',
  path: '/budget/*',
  Page: BudgetPage,
  settings: { title: 'Plaid', padded: true, Panel: PlaidPanel },
}
