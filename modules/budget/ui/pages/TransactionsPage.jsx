// =============================================================================
// TransactionsPage.jsx — Transaction list, filters, Plaid sync, bulk actions
// thrive UI
// =============================================================================

import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '@trunk/api'
import { useToast } from '@trunk/context/ToastContext'
import { useConfirm } from '@trunk/context/ConfirmModal'
import { fmtMoney, SYNC_OPTIONS } from '../utils/constants'
import TransactionRow from '../components/TransactionRow'
import TransactionForm from '../components/TransactionForm'
import ImportPanel from '../components/ImportPanel'
import VerifyMatchPopup from '../components/VerifyMatchPopup'
import BulkActionBar from '../components/BulkActionBar'
import FilterCombo from '../components/FilterCombo'
import './Page.css'

const PAGE_SIZE = 50

export default function TransactionsPage({ initial = {}, onBalanceChange }) {
    const { showToast } = useToast()
    const { confirm } = useConfirm()

    const [transactions, setTransactions] = useState([])
    const [accounts, setAccounts] = useState([])
    const [payees, setPayees] = useState([])
    const [categories, setCategories] = useState([])
    const [loading, setLoading] = useState(true)
    const [loadingMore, setLoadingMore] = useState(false)
    const [hasMore, setHasMore] = useState(true)
    const [offset, setOffset] = useState(0)
    const [plaidAcctIds, setPlaidAcctIds] = useState(new Set())
    const [syncingPlaid, setSyncingPlaid] = useState(false)
    const [syncOption, setSyncOption] = useState(SYNC_OPTIONS[2])
    const [selected, setSelected] = useState(new Set())

    const [accountId, setAccountId] = useState(initial.accountId ? String(initial.accountId) : '')
    const [fromDate, setFromDate] = useState('')
    const [toDate, setToDate] = useState('')
    const [payeeId, setPayeeId] = useState('')
    const [categoryId, setCategoryId] = useState('')
    const [memoSearch, setMemoSearch] = useState('')
    const [memoQuery, setMemoQuery] = useState('')   // debounced memo for fetching
    const [sort, setSort] = useState('date')
    const [dir, setDir] = useState('desc')

    // debounce free-text memo search so we don't fire a request per keystroke
    useEffect(() => {
        const id = setTimeout(() => setMemoQuery(memoSearch.trim()), 350)
        return () => clearTimeout(id)
    }, [memoSearch])

    const [showAdd, setShowAdd] = useState(false)
    const [showImport, setShowImport] = useState(!!initial.plaidRows)
    const [editingId, setEditingId] = useState(null)
    const [verifyId, setVerifyId] = useState(null)
    const [plaidPreload, setPlaidPreload] = useState(initial.plaidRows || null)

    const sentinelRef = useRef(null)

    // ── Data loading ──────────────────────────────────────────────────────────

    async function loadLookups() {
        try {
            const [a, p, c, conns] = await Promise.all([
                api.get('/budget/accounts/'),
                api.get('/payees/'),
                api.get('/categories/'),
                api.get('/plaid/connections'),
            ])
            setAccounts(a)
            setPayees(p)
            setCategories(c)
            setPlaidAcctIds(new Set(conns.map(c => c.account_id)))
            onBalanceChange?.()
        } catch (e) {
            showToast(e.message, 'error')
        }
    }

    async function fetchPage(currentOffset, replace = false) {
        if (replace) setLoading(true)
        else setLoadingMore(true)
        const params = new URLSearchParams()
        if (accountId) params.set('account_id', accountId)
        if (fromDate) params.set('from_date', fromDate)
        if (toDate) params.set('to_date', toDate)
        if (payeeId) params.set('payee_id', payeeId)
        if (categoryId) params.set('category_id', categoryId)
        if (memoQuery) params.set('memo', memoQuery)
        params.set('sort', sort)
        params.set('dir', dir)
        params.set('limit', PAGE_SIZE)
        params.set('offset', currentOffset)
        try {
            const data = await api.get(`/transactions/?${params}`)
            if (replace) {
                setTransactions(data)
                setSelected(new Set())
            } else {
                setTransactions(prev => [...prev, ...data])
            }
            setHasMore(data.length === PAGE_SIZE)
            setOffset(currentOffset + data.length)
        } catch (e) {
            showToast(e.message, 'error')
        } finally {
            if (replace) setLoading(false)
            else setLoadingMore(false)
        }
    }

    // Reset and reload from the top whenever filters or sort change
    useEffect(() => {
        setOffset(0)
        setHasMore(true)
        fetchPage(0, true)
    }, [accountId, fromDate, toDate, payeeId, categoryId, memoQuery, sort, dir])

    useEffect(() => { loadLookups() }, [])
    useEffect(() => {
        api.get('/plaid/connections')
            .then(conns => setPlaidAcctIds(new Set(conns.map(c => c.account_id))))
            .catch(() => { })
    }, [accountId])

    // ── Infinite scroll sentinel ──────────────────────────────────────────────

    const handleIntersect = useCallback((entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
            fetchPage(offset)
        }
    }, [hasMore, loading, loadingMore, offset, accountId, fromDate, toDate, payeeId, categoryId, memoQuery, sort, dir])

    useEffect(() => {
        const el = sentinelRef.current
        if (!el) return
        const observer = new IntersectionObserver(handleIntersect, { rootMargin: '200px' })
        observer.observe(el)
        return () => observer.disconnect()
    }, [handleIntersect])

    // In-place refresh used by edit / delete / bulk actions (#29). Re-fetches the
    // window you've ALREADY scrolled to (offset 0 → current depth) and swaps it in
    // without toggling the full-screen `loading` state or collapsing back to page 1.
    // Keeps content height steady, so scroll position + loaded rows stay put instead
    // of snapping to the top. Running balances stay correct (server recomputes for
    // the window). Limit is clamped to the backend's 500 cap.
    async function reload() {
        const count = Math.min(Math.max(transactions.length, PAGE_SIZE), 500)
        const params = new URLSearchParams()
        if (accountId) params.set('account_id', accountId)
        if (fromDate) params.set('from_date', fromDate)
        if (toDate) params.set('to_date', toDate)
        if (payeeId) params.set('payee_id', payeeId)
        if (categoryId) params.set('category_id', categoryId)
        if (memoQuery) params.set('memo', memoQuery)
        params.set('sort', sort)
        params.set('dir', dir)
        params.set('limit', count)
        params.set('offset', 0)
        try {
            const data = await api.get(`/transactions/?${params}`)
            setTransactions(data)
            setSelected(new Set())
            setOffset(data.length)
            setHasMore(data.length === count)
        } catch (e) {
            showToast(e.message, 'error')
        }
    }

    // ── Single row actions ────────────────────────────────────────────────────

    async function handleDelete(t) {
        // A transfer leg is linked to a matching transaction on another account.
        // Tell the user, and that the other leg is unlinked (not deleted).
        const otherAcct = (t.category_name || '').replace(/^Transfer:\s*/, '')
        const msg = t.transfer_account_id
            ? `Delete this transfer? Its matching transaction on ${otherAcct || 'the other account'} will be unlinked and marked Uncleared — not deleted.`
            : `Delete transaction '${t.payee_name || 'this'}'?`
        const ok = await confirm(msg, { danger: true })
        if (!ok) return
        try {
            await api.del(`/transactions/${t.id}`)
            showToast('Deleted', 'success')
            reload(); loadLookups()
        } catch (e) { showToast(e.message, 'error') }
    }

    async function handleCycleStatus(t) {
        const next = {
            null: 'Cleared', Cleared: 'Reconciled', Reconciled: 'none',
        }[t.cleared === null || t.cleared === undefined ? 'null' : t.cleared]
        try {
            await api.patch(`/transactions/${t.id}`, { cleared: next })
            reload()
        } catch (e) { showToast(e.message, 'error') }
    }

    // Inline single-field edit from a row cell. Category/payee/memo update in place
    // (no scroll jump); amount/date affect ordering + running balance, so reload.
    async function handlePatch(id, fields) {
        // transfers create a paired row in the other account → reload to show it +
        // the correct "Transfer:…" name; amount/date affect order/running balance.
        const reloadsAfter = 'amount' in fields || 'date' in fields || 'transfer_account_id' in fields
        if (!reloadsAfter) {
            const extra = {}
            if ('category_id' in fields) {
                // match the backend's "Parent:Sub" display name (was only showing the leaf)
                const cat = categories.find(c => c.id === fields.category_id)
                const par = cat && cat.parent_id ? categories.find(c => c.id === cat.parent_id) : null
                extra.category_name = cat ? (par ? `${par.name}:${cat.name}` : cat.name) : null
            }
            if ('payee_id' in fields) extra.payee_name = payees.find(p => p.id === fields.payee_id)?.name ?? null
            setTransactions(prev => prev.map(t => (t.id === id ? { ...t, ...fields, ...extra } : t)))
        }
        try {
            await api.patch(`/transactions/${id}`, fields)
            if (reloadsAfter) { reload(); loadLookups() }
        } catch (e) {
            showToast(e.message, 'error')
            reload()   // revert the optimistic change
        }
    }

    // ── Plaid sync ────────────────────────────────────────────────────────────

    async function handlePlaidSync() {
        if (!accountId) return
        setSyncingPlaid(true)
        try {
            const body = { account_id: parseInt(accountId) }
            if (syncOption.start_date) { body.start_date = syncOption.start_date }
            else { body.days = syncOption.days }
            const result = await api.post('/plaid/sync', body)
            if (!result.rows || result.rows.length === 0) {
                showToast(`Up to date — ${result.skipped} already imported`, 'info')
                return
            }
            setPlaidPreload(result.rows)
            setShowImport(true)
            setShowAdd(false)
            setEditingId(null)
        } catch (e) {
            showToast(e.message || 'Sync failed', 'error')
        } finally {
            setSyncingPlaid(false)
        }
    }

    // ── Selection ─────────────────────────────────────────────────────────────

    function toggleSelect(id) {
        setSelected(prev => {
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })
    }

    function toggleSelectAll() {
        if (selected.size === transactions.length) setSelected(new Set())
        else setSelected(new Set(transactions.map(t => t.id)))
    }

    // ── Bulk actions ──────────────────────────────────────────────────────────

    async function handleBulkDelete() {
        const ok = await confirm(`Delete ${selected.size} transaction${selected.size !== 1 ? 's' : ''}?`, { danger: true })
        if (!ok) return
        try {
            const res = await api.post('/transactions/bulk/delete', { ids: [...selected] })
            showToast(`Deleted ${res.deleted}`, 'success')
            reload(); loadLookups()
        } catch (e) { showToast(e.message, 'error') }
    }

    async function handleBulkStatus(cleared) {
        try {
            const res = await api.post('/transactions/bulk/status', { ids: [...selected], cleared })
            showToast(`Updated ${res.updated}`, 'success')
            reload()
        } catch (e) { showToast(e.message, 'error') }
    }

    async function handleBulkCategory(categoryId) {
        try {
            const res = await api.post('/transactions/bulk/category', {
                ids: [...selected],
                category_id: categoryId ? parseInt(categoryId) : null,
            })
            showToast(`Updated ${res.updated}`, 'success')
            reload()
        } catch (e) { showToast(e.message, 'error') }
    }

    async function handleBulkPayee(payeeId) {
        try {
            const res = await api.post('/transactions/bulk/payee', {
                ids: [...selected],
                payee_id: payeeId ? parseInt(payeeId) : null,
            })
            showToast(`Updated ${res.updated}`, 'success')
            reload()
        } catch (e) { showToast(e.message, 'error') }
    }

    async function handleBulkVerify() {
        try {
            const res = await api.post('/transactions/bulk/verify', { ids: [...selected] })
            showToast(`Verified ${res.verified}${res.skipped ? `, skipped ${res.skipped}` : ''}`, 'success')
            reload(); loadLookups()
        } catch (e) { showToast(e.message, 'error') }
    }

    // ── Derived ───────────────────────────────────────────────────────────────

    const selectedAccount = accounts.find(a => a.id === parseInt(accountId))
    const accountHasPlaid = accountId && plaidAcctIds.has(parseInt(accountId))
    const allSelected = transactions.length > 0 && selected.size === transactions.length
    const someSelected = selected.size > 0 && !allSelected

    // filter-control helpers
    const sortedPayees = [...payees].sort((a, b) => a.name.localeCompare(b.name))
    const mainCats = categories.filter(c => c.parent_id === null).sort((a, b) => a.name.localeCompare(b.name))
    const childrenOf = (pid) => categories.filter(c => c.parent_id === pid).sort((a, b) => a.name.localeCompare(b.name))
    const filtersActive = !!(fromDate || toDate || payeeId || categoryId || memoSearch)

    // combobox option lists (category options are flattened: "Parent" + "Parent: Sub")
    const payeeOptions = sortedPayees.map(p => ({ id: p.id, label: p.name }))
    const categoryOptions = mainCats.flatMap(p => [
        { id: p.id, label: p.name },
        ...childrenOf(p.id).map(ch => ({ id: ch.id, label: `${p.name}: ${ch.name}` })),
    ])
    const accountOptions = accounts.map(a => ({ id: a.id, label: a.name + (a.number ? ` (${a.number})` : '') }))

    // chronological order is required for the running-balance column to be meaningful
    const chronological = sort === 'date' && dir === 'desc'
    const showBalanceCol = !!accountId && chronological

    // clickable column header: toggle direction if already active, else activate (date defaults desc, others asc)
    function toggleSort(col) {
        if (sort === col) setDir(d => (d === 'asc' ? 'desc' : 'asc'))
        else { setSort(col); setDir(col === 'date' || col === 'amount' ? 'desc' : 'asc') }
    }
    const sortArrow = (col) => (sort === col ? (dir === 'asc' ? ' ▲' : ' ▼') : '')

    function clearFilters() {
        setFromDate(''); setToDate(''); setPayeeId(''); setCategoryId(''); setMemoSearch('')
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="page page-wide">
            <div className="page-header">
                <h1 className="page-title">Transactions</h1>
                <span className="muted">
                    {transactions.length} shown
                    {selectedAccount && ` · ${selectedAccount.name} bal ${fmtMoney(selectedAccount.balance || 0)}`}
                </span>
            </div>

            <div className="txn-filters">
                <select className="input" value={accountId} onChange={e => setAccountId(e.target.value)}>
                    <option value="">All accounts</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <input className="input" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} title="From date" />
                <input className="input" type="date" value={toDate} onChange={e => setToDate(e.target.value)} title="To date" />
                <FilterCombo options={payeeOptions} value={payeeId} onChange={setPayeeId} placeholder="All payees" />
                <FilterCombo options={categoryOptions} value={categoryId} onChange={setCategoryId} placeholder="All categories" width={190} />
                <input className="input" type="text" placeholder="Search memo…" value={memoSearch} onChange={e => setMemoSearch(e.target.value)} />
                {filtersActive && (
                    <button className="btn" onClick={clearFilters} title="Clear filters">Clear</button>
                )}
                <button className="btn btn-primary" onClick={() => {
                    setShowAdd(true); setShowImport(false); setEditingId(null); setPlaidPreload(null)
                }}>+ Add</button>
                <button className="btn" onClick={() => {
                    setShowImport(true); setShowAdd(false); setEditingId(null); setPlaidPreload(null)
                }}>Import</button>
                {accountHasPlaid && (
                    <div className="txn-plaid-sync">
                        <select
                            className="txn-plaid-sync-select"
                            value={SYNC_OPTIONS.indexOf(syncOption)}
                            onChange={e => setSyncOption(SYNC_OPTIONS[parseInt(e.target.value)])}
                        >
                            {SYNC_OPTIONS.map((opt, i) => <option key={i} value={i}>{opt.label}</option>)}
                        </select>
                        <button
                            className="txn-plaid-sync-btn"
                            onClick={handlePlaidSync}
                            disabled={syncingPlaid}
                        >
                            {syncingPlaid ? 'Fetching…' : '↻ Sync Plaid'}
                        </button>
                    </div>
                )}
            </div>

            {showAdd && (
                <TransactionForm
                    accounts={accounts} payees={payees} categories={categories}
                    defaultAccountId={accountId}
                    onCancel={() => setShowAdd(false)}
                    onSaved={() => { setShowAdd(false); reload(); loadLookups() }}
                    showToast={showToast}
                    onPayeeCreated={loadLookups}
                    onCategoryCreated={loadLookups}
                />
            )}

            {showImport && (
                <ImportPanel
                    accounts={accounts}
                    defaultAccountId={accountId}
                    preloadedRows={plaidPreload}
                    onCancel={() => { setShowImport(false); setPlaidPreload(null) }}
                    onImported={() => { setShowImport(false); setPlaidPreload(null); reload(); loadLookups() }}
                    showToast={showToast}
                />
            )}

            {verifyId && (
                <VerifyMatchPopup
                    transactionId={verifyId}
                    onCancel={() => setVerifyId(null)}
                    onVerified={() => { setVerifyId(null); reload(); loadLookups() }}
                    showToast={showToast}
                    onPayeeCreated={loadLookups}
                    onCategoryCreated={loadLookups}
                />
            )}

            {loading ? (
                <div className="muted">Loading…</div>
            ) : transactions.length === 0 ? (
                <div className="muted">No transactions match the filters.</div>
            ) : (
                <div className={`txn-table ${showBalanceCol ? 'has-balance' : (accountId ? '' : 'all-accounts')}`}>
                    <div className="txn-row txn-header">
                        <input
                            type="checkbox"
                            className="txn-check"
                            checked={allSelected}
                            ref={el => { if (el) el.indeterminate = someSelected }}
                            onChange={toggleSelectAll}
                            title="Select all"
                        />
                        <span className="txn-status-col txn-sortable" title="Sort by status (○ uncleared · ◐ cleared · ● reconciled)" onClick={() => toggleSort('status')}>{sortArrow('status').trim() || '·'}</span>
                        <span className="txn-sortable" onClick={() => toggleSort('date')}>Date{sortArrow('date')}</span>
                        {!accountId && <span className="txn-sortable" onClick={() => toggleSort('account')}>Account{sortArrow('account')}</span>}
                        <span className="txn-sortable" onClick={() => toggleSort('payee')}>Payee{sortArrow('payee')}</span>
                        <span className="txn-sortable" onClick={() => toggleSort('category')}>Category{sortArrow('category')}</span>
                        <span className="txn-sortable" onClick={() => toggleSort('memo')}>Memo{sortArrow('memo')}</span>
                        <span className="txn-amount-col txn-sortable" onClick={() => toggleSort('amount')}>Amount{sortArrow('amount')}</span>
                        {showBalanceCol && <span className="txn-amount-col">Balance</span>}
                    </div>
                    {(() => {
                        // Reorder so matched pairs are always adjacent, preventing
                        // unrelated rows from being visually trapped inside the pair border.
                        const byId = Object.fromEntries(transactions.map(t => [t.id, t]))
                        const ordered = []
                        const emitted = new Set()
                        for (const t of transactions) {
                            if (emitted.has(t.id)) continue
                            ordered.push(t)
                            emitted.add(t.id)
                            if (t.matched_transaction_id && byId[t.matched_transaction_id] && !emitted.has(t.matched_transaction_id)) {
                                ordered.push(byId[t.matched_transaction_id])
                                emitted.add(t.matched_transaction_id)
                            }
                        }

                        // Recompute running balance after reordering so each row shows
                        // the correct balance for its new visual position.
                        // transactions[0].balance is always the backend's starting running
                        // value regardless of cleared status, so it's a safe anchor.
                        const hasBalance = transactions.length > 0 && transactions[0].balance !== undefined
                        let runningCents = hasBalance ? Math.round(transactions[0].balance * 100) : 0
                        const rebalanced = ordered.map(t => {
                            const bal = hasBalance ? runningCents / 100 : t.balance
                            if (hasBalance && t.cleared !== 'Unverified') {
                                runningCents = Math.round(runningCents - t.amount * 100)
                            }
                            return { ...t, balance: bal }
                        })

                        const pairMap = {}
                        rebalanced.forEach(t => {
                            if (t.matched_transaction_id) {
                                const key = Math.min(t.id, t.matched_transaction_id) + '-' + Math.max(t.id, t.matched_transaction_id)
                                pairMap[t.id] = key
                                pairMap[t.matched_transaction_id] = key
                            }
                        })
                        const rendered = []
                        const seenPairKeys = {}
                        rebalanced.forEach(t => {
                            const pairKey = pairMap[t.id]
                            const isFirst = pairKey && !seenPairKeys[pairKey]
                            if (pairKey) seenPairKeys[pairKey] = true
                            const row = editingId === t.id ? (
                                <TransactionForm
                                    key={t.id}
                                    existing={t}
                                    accounts={accounts} payees={payees} categories={categories}
                                    onCancel={() => setEditingId(null)}
                                    onSaved={() => { setEditingId(null); reload(); loadLookups() }}
                                    showToast={showToast}
                                    onPayeeCreated={loadLookups}
                                    onCategoryCreated={loadLookups}
                                />
                            ) : (
                                <TransactionRow
                                    key={t.id} t={t}
                                    showBalance={showBalanceCol} showAccount={!accountId}
                                    categoryOptions={categoryOptions} payeeOptions={payeeOptions} accountOptions={accountOptions}
                                    onPatch={handlePatch}
                                    selected={selected.has(t.id)}
                                    onSelect={() => toggleSelect(t.id)}
                                    onEdit={() => {
                                        if (t.cleared === 'Unverified' && t.matched_transaction_id) {
                                            setVerifyId(t.id); setEditingId(null)
                                        } else {
                                            setEditingId(t.id)
                                            setShowAdd(false); setShowImport(false); setVerifyId(null)
                                        }
                                    }}
                                    onDelete={() => handleDelete(t)}
                                    onCycleStatus={() => handleCycleStatus(t)}
                                    onAccountClick={(id) => setAccountId(String(id))}
                                    matchClass={pairKey ? (isFirst ? 'match-pair match-pair--top' : 'match-pair match-pair--bottom') : ''}
                                />
                            )
                            rendered.push(row)
                        })
                        return rendered
                    })()}
                </div>
            )}

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} style={{ height: 1 }} />
            {loadingMore && <div className="muted" style={{ padding: '12px', textAlign: 'center' }}>Loading more…</div>}
            {!hasMore && transactions.length > 0 && (
                <div className="muted" style={{ padding: '12px', textAlign: 'center', fontSize: '12px' }}>
                    All {transactions.length} transactions loaded
                </div>
            )}

            {selected.size > 0 && (
                <BulkActionBar
                    count={selected.size}
                    transactions={transactions}
                    selected={selected}
                    categories={categories}
                    payees={payees}
                    onClear={() => setSelected(new Set())}
                    onDelete={handleBulkDelete}
                    onStatus={handleBulkStatus}
                    onCategory={handleBulkCategory}
                    onPayee={handleBulkPayee}
                    onVerify={handleBulkVerify}
                />
            )}
        </div>
    )
}