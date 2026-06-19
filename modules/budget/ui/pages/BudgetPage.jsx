// =============================================================================
// BudgetPage.jsx — Budget module shell: left context sidebar + section content
// thrive UI — reached via the 💰 icon in the top bar (/budget/*)
//
// The monolith ran these as top-level routes with a shared sidebar; here the
// whole budget app is nested under /budget/* with its own sidebar, so it lives
// behind a single module nav entry.
// =============================================================================
import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { api } from '@trunk/api'
import { useVault } from '@trunk/context/VaultContext'
import AccountsPage     from './AccountsPage'
import TransactionsPage from './TransactionsPage'
import CategoriesPage   from './CategoriesPage'
import PayeesPage       from './PayeesPage'
import ScheduledPage    from './ScheduledPage'
import CategoryBreakdown from './CategoryBreakdown'
import CashFlowTrend     from './CashFlowTrend'

// budget stylesheets (monolith CSS + var aliases). budget-theme.css must load
// first so the aliased variables are defined before the rest reference them.
import './budget-theme.css'
import './base.css'
import './transactions.css'
import './accounts.css'
import './categories.css'
import './payees.css'
import './import.css'
import '../components/Nav.css'

const SIDEBAR_W = 220
const fmtMoney = n => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const FINANCE_ITEMS = [
  { id: 'transactions', label: 'Transactions' },
  { id: 'categories',   label: 'Categories'   },
  { id: 'payees',       label: 'Payees'       },
  { id: 'scheduled',    label: 'Scheduled'    },
]

// ── context sidebar ───────────────────────────────────────────────────────────
function BudgetSidebar({ refreshKey }) {
  const navigate = useNavigate()
  const { pathname: path } = useLocation()
  const [accounts,     setAccounts]     = useState([])
  const [accountsOpen, setAccountsOpen] = useState(true)
  const [reportsOpen,  setReportsOpen]  = useState(false)

  useEffect(() => {
    const fetchAccounts = () => api.get('/budget/accounts/').then(setAccounts).catch(() => {})
    fetchAccounts()
    // re-fetch when the Accounts page changes the list/order (drag-reorder, add, delete)
    window.addEventListener('thrive:accounts-changed', fetchAccounts)
    return () => window.removeEventListener('thrive:accounts-changed', fetchAccounts)
  }, [refreshKey])

  return (
    <div style={{
      position: 'fixed', left: 0, top: 48, bottom: 0, width: SIDEBAR_W,
      background: 'var(--bg-secondary,#181818)', borderRight: '1px solid var(--border-color,#2a2a2a)',
      overflowY: 'auto', zIndex: 100, display: 'flex', flexDirection: 'column',
    }}>
      {/* Reports — collapsible */}
      <div>
        <button className={`nav-accounts-toggle ${path.startsWith('/budget/reports') ? 'active' : ''}`}
          onClick={() => setReportsOpen(o => !o)}>
          <span>Reports</span>
          <span className={`nav-accounts-chevron ${reportsOpen ? 'open' : ''}`}>▼</span>
        </button>
        <div className={`nav-accounts ${reportsOpen ? 'expanded' : ''}`}>
          <div className="nav-section">
            <button className={`nav-item ${path === '/budget/reports' ? 'active' : ''}`}
              onClick={() => navigate('/budget/reports')}>Category Breakdown</button>
            <button className={`nav-item ${path === '/budget/reports/cash-flow' ? 'active' : ''}`}
              onClick={() => navigate('/budget/reports/cash-flow')}>Cash Flow</button>
          </div>
        </div>
      </div>

      {/* Budget / accounts — collapsible, lists accounts + balances */}
      <button className={`nav-accounts-toggle ${path.startsWith('/budget/accounts') ? 'active' : ''}`}
        onClick={() => { setAccountsOpen(o => !o); navigate('/budget/accounts') }}>
        <span>Accounts</span>
        <span className={`nav-accounts-chevron ${accountsOpen ? 'open' : ''}`}>▼</span>
      </button>
      <div className={`nav-accounts ${accountsOpen ? 'expanded' : ''}`}>
        {accounts.map(a => (
          <button key={a.id} className="nav-account"
            onClick={() => navigate(`/budget/transactions?accountId=${a.id}`)}>
            <span className="nav-account-name" style={a.on_budget ? {} : { opacity: 0.45 }}>{a.name}</span>
            <span className="nav-account-balance" style={a.on_budget ? {} : { opacity: 0.45, color: 'var(--text-tertiary,#666)' }}>{fmtMoney(a.balance)}</span>
          </button>
        ))}
      </div>

      {/* other finance sections */}
      {FINANCE_ITEMS.map(item => (
        <div key={item.id} className="nav-section">
          <button className={`nav-item ${path.startsWith(`/budget/${item.id}`) ? 'active' : ''}`}
            onClick={() => navigate(`/budget/${item.id}`)}>{item.label}</button>
        </div>
      ))}
    </div>
  )
}

// wrapper: feed accountId (?accountId=) and any plaid rows (router state) into
// TransactionsPage's `initial` prop, exactly like the monolith's TransactionsRoute
function TransactionsRoute({ onBalanceChange }) {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const accountId = searchParams.get('accountId') || ''
  const txnState  = location.state || {}
  return (
    <TransactionsPage
      key={`txn-${accountId}-${txnState._plaidKey || ''}`}
      initial={{ accountId: accountId ? parseInt(accountId) : undefined, plaidRows: txnState.plaidRows }}
      onBalanceChange={onBalanceChange}
    />
  )
}

// ── page shell ────────────────────────────────────────────────────────────────
export default function BudgetPage() {
  const navigate = useNavigate()
  const { vaultToken } = useVault()
  const [refreshKey, setRefreshKey] = useState(0)

  // AccountsPage.onNav(section, params) → navigate within the module
  const handleNav = (id, params = {}) => {
    const { accountId, ...stateParams } = params
    const search = accountId ? `?accountId=${accountId}` : ''
    const state  = Object.keys(stateParams).length ? stateParams : undefined
    navigate(`/budget/${id}${search}`, { state })
  }

  return (
    <>
      <BudgetSidebar refreshKey={refreshKey} />
      <div style={{ marginLeft: SIDEBAR_W }}>
        <Routes>
          <Route index             element={<Navigate to="accounts" replace />} />
          <Route path="accounts"   element={<AccountsPage onNav={handleNav} vaultToken={vaultToken} />} />
          <Route path="transactions" element={<TransactionsRoute onBalanceChange={() => setRefreshKey(k => k + 1)} />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="payees"     element={<PayeesPage />} />
          <Route path="scheduled"  element={<ScheduledPage />} />
          <Route path="reports"    element={<CategoryBreakdown />} />
          <Route path="reports/cash-flow" element={<CashFlowTrend />} />
          <Route path="*"          element={<Navigate to="accounts" replace />} />
        </Routes>
      </div>
    </>
  )
}
