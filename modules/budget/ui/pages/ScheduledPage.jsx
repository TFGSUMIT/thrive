import { useEffect, useState } from 'react'
import { api } from '@trunk/api'
import { useToast } from '@trunk/context/ToastContext'
import { useConfirm } from '@trunk/context/ConfirmModal'
import './Page.css'

const FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']
const DOM_FREQS = new Set(['monthly', 'quarterly'])
const ANCHOR_FREQS = new Set(['weekly', 'biweekly', 'yearly'])

const fmtMoney = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function nextOccurrence(s) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    if (s.frequency === 'monthly') {
        let next = new Date(today.getFullYear(), today.getMonth(), s.day)
        if (next < today) next = new Date(today.getFullYear(), today.getMonth() + 1, s.day)
        return next
    }
    if (s.frequency === 'quarterly') {
        let next = new Date(today.getFullYear(), today.getMonth(), s.day)
        while (next < today) next = new Date(next.getFullYear(), next.getMonth() + 3, s.day)
        return next
    }
    if (!s.anchor_date) return null
    const anchor = new Date(s.anchor_date + 'T00:00:00')
    if (s.frequency === 'yearly') {
        let next = new Date(today.getFullYear(), anchor.getMonth(), anchor.getDate())
        if (next < today) next.setFullYear(next.getFullYear() + 1)
        return next
    }
    const interval = s.frequency === 'biweekly' ? 14 : 7
    let next = new Date(anchor)
    while (next < today) next.setDate(next.getDate() + interval)
    return next
}

const fmtDate = (d) => d
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : ''

export default function ScheduledPage() {
    const { showToast } = useToast()
    const { confirm } = useConfirm()

    const [scheduled, setScheduled] = useState([])
    const [accounts, setAccounts] = useState([])
    const [payees, setPayees] = useState([])
    const [categories, setCategories] = useState([])
    const [loading, setLoading] = useState(true)

    const [showAdd, setShowAdd] = useState(false)
    const [editingId, setEditingId] = useState(null)
    const [sortBy, setSortBy] = useState('date_asc')
    const [expandedId, setExpandedId] = useState(null)

    async function load() {
        setLoading(true)
        try {
            const [s, a, p, c] = await Promise.all([
                api.get('/scheduled/'),
                api.get('/budget/accounts/'),
                api.get('/payees/'),
                api.get('/categories/'),
            ])
            setScheduled(s)
            setAccounts(a)
            setPayees(p)
            setCategories(c)
        } catch (e) {
            showToast(e.message, 'error')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { load() }, [])

    async function handleDelete(id, payeeName) {
        const ok = await confirm(`Delete scheduled '${payeeName}'?`, { danger: true })
        if (!ok) return
        try {
            await api.del(`/scheduled/${id}`)
            showToast('Deleted', 'success')
            load()
        } catch (e) {
            showToast(e.message, 'error')
        }
    }

    const sorted = [...scheduled].sort((a, b) => {
        switch (sortBy) {
            case 'date_asc': return (nextOccurrence(a) || 0) - (nextOccurrence(b) || 0)
            case 'date_desc': return (nextOccurrence(b) || 0) - (nextOccurrence(a) || 0)
            case 'payee_az': return a.payee_name.localeCompare(b.payee_name)
            case 'payee_za': return b.payee_name.localeCompare(a.payee_name)
            case 'amount_high': return b.amount - a.amount
            case 'amount_low': return a.amount - b.amount
            case 'id': return a.id - b.id
            default: return 0
        }
    })

    const monthlyEstimate = scheduled.reduce((sum, s) => {
        if (s.amount === 0) return sum
        const m = {
            weekly: 4.333,
            biweekly: 2.167,
            monthly: 1,
            quarterly: 1 / 3,
            yearly: 1 / 12,
        }[s.frequency] || 0
        return sum + s.amount * m
    }, 0)

    return (
        <div className="page">
            <div className="page-header">
                <h1 className="page-title">Scheduled</h1>
                <span className="muted">
                    {scheduled.length} scheduled · {fmtMoney(monthlyEstimate)}/mo est.
                </span>
            </div>

            <div className="sched-toolbar">
                <button
                    className="btn btn-primary"
                    onClick={() => { setShowAdd(true); setEditingId(null) }}
                >
                    + Add scheduled
                </button>
                <select
                    className="input sort-select"
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value)}
                >
                    <option value="date_asc">Next date ↑</option>
                    <option value="date_desc">Next date ↓</option>
                    <option value="payee_az">Payee A-Z</option>
                    <option value="payee_za">Payee Z-A</option>
                    <option value="amount_high">Amount high → low</option>
                    <option value="amount_low">Amount low → high</option>
                    <option value="id">ID</option>
                </select>
            </div>

            {showAdd && (
                <ScheduledForm
                    accounts={accounts}
                    payees={payees}
                    categories={categories}
                    onCancel={() => setShowAdd(false)}
                    onSaved={() => { setShowAdd(false); load() }}
                    showToast={showToast}
                />
            )}

            {loading ? (
                <div className="muted">Loading…</div>
            ) : (
                <div className="acct-list">
                    {sorted.length === 0 ? (
                        <div className="cat-row"><span className="muted">No scheduled transactions yet</span></div>
                    ) : (
                        sorted.map(s => (
                            editingId === s.id ? (
                                <ScheduledForm
                                    key={s.id}
                                    existing={s}
                                    accounts={accounts}
                                    payees={payees}
                                    categories={categories}
                                    onCancel={() => setEditingId(null)}
                                    onSaved={() => { setEditingId(null); load() }}
                                    showToast={showToast}
                                />
                            ) : (
                                <ScheduledCard
                                    key={s.id}
                                    s={s}
                                    expanded={expandedId === s.id}
                                    onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
                                    onEdit={() => { setEditingId(s.id); setShowAdd(false); setExpandedId(null) }}
                                    onDelete={() => handleDelete(s.id, s.payee_name)}
                                />
                            )
                        ))
                    )}
                </div>
            )}
        </div>
    )
}

function ScheduledCard({ s, expanded, onToggle, onEdit, onDelete }) {
    const isZero = s.amount === 0
    const isIncome = s.amount > 0
    const amountClass = isZero
        ? 'sched-amount zero'
        : (isIncome ? 'sched-amount income' : 'sched-amount expense')

    const next = nextOccurrence(s)
    const meta = [
        fmtDate(next),
        s.account_name,
        s.category_name,
    ].filter(Boolean).join(' · ')

    return (
        <div className={`sched-row acct-clickable ${expanded ? 'expanded' : ''}`}>
            <div className="sched-info" onClick={onToggle}>
                <div className="sched-name-row">
                    <span className="sched-id">{s.id}</span>
                    <span className="sched-payee">{s.payee_name}</span>
                    <span className="sched-meta-inline">{meta}</span>
                </div>
            </div>
            <div className={amountClass} onClick={onToggle}>{fmtMoney(s.amount)}</div>

            {expanded && (
                <div className="row-expanded">
                    <div className="sched-meta-inline">
                        {s.frequency}
                        {s.day !== null && s.day !== undefined && ` · day ${s.day}`}
                        {s.anchor_date && ` · anchor ${s.anchor_date}`}
                    </div>
                    <div className="row-expanded-actions">
                        <button className="btn" onClick={onEdit}>Edit</button>
                        <button className="btn btn-danger-solid" onClick={onDelete}>Delete</button>
                    </div>
                </div>
            )}
        </div>
    )
}

function ScheduledForm({ existing, accounts, payees, categories, onCancel, onSaved, showToast }) {
    const [payeeId, setPayeeId] = useState(existing?.payee_id ?? '')
    const [amount, setAmount] = useState(existing?.amount ?? '')
    const [frequency, setFrequency] = useState(existing?.frequency ?? 'monthly')
    const [day, setDay] = useState(existing?.day ?? '')
    const [anchorDate, setAnchorDate] = useState(existing?.anchor_date ?? '')
    const [accountId, setAccountId] = useState(existing?.account_id ?? '')

    const [mainCategoryId, setMainCategoryId] = useState('')
    const [subCategoryId, setSubCategoryId] = useState('')
    const [transferAccountId, setTransferAccountId] = useState('')

    const isTransfer = mainCategoryId === 'transfer'
    const usesAnchor = ANCHOR_FREQS.has(frequency)
    const usesDay = DOM_FREQS.has(frequency)

    const mainCategories = categories.filter(c => c.parent_id === null)
    const subCategories = categories.filter(c => c.parent_id !== null)
    const filteredSubs = subCategories.filter(c => c.parent_id === parseInt(mainCategoryId))

    useEffect(() => {
        if (!existing) return
        if (existing.transfer_account_id) {
            setMainCategoryId('transfer')
            setTransferAccountId(existing.transfer_account_id.toString())
            return
        }
        const cat = categories.find(c => c.id === existing.category_id)
        if (!cat) return
        if (cat.parent_id) {
            setMainCategoryId(cat.parent_id.toString())
            setSubCategoryId(cat.id.toString())
        } else {
            setMainCategoryId(cat.id.toString())
            setSubCategoryId('')
        }
    }, [existing, categories])

    async function handleSubmit(e) {
        e.preventDefault()
        if (!payeeId) return showToast('Payee required', 'error')
        if (amount === '') return showToast('Amount required', 'error')
        if (usesDay && !day) return showToast('Day required for ' + frequency, 'error')
        if (usesAnchor && !anchorDate) return showToast('Anchor date required for ' + frequency, 'error')
        if (isTransfer && !transferAccountId) return showToast('Transfer account required', 'error')

        const body = {
            payee_id: parseInt(payeeId),
            amount: parseFloat(amount),
            frequency,
            day: usesDay ? parseInt(day) : null,
            anchor_date: usesAnchor ? anchorDate : null,
            account_id: accountId ? parseInt(accountId) : null,
        }

        if (isTransfer) {
            body.transfer_account_id = parseInt(transferAccountId)
            body.category_id = null
        } else {
            body.category_id = subCategoryId
                ? parseInt(subCategoryId)
                : mainCategoryId
                    ? parseInt(mainCategoryId)
                    : null
        }

        try {
            if (existing) {
                await api.patch(`/scheduled/${existing.id}`, body)
                showToast('Updated', 'success')
            } else {
                await api.post('/scheduled/', body)
                showToast('Added', 'success')
            }
            onSaved()
        } catch (e) {
            showToast(e.message, 'error')
        }
    }

    return (
        <form className="sched-form" onSubmit={handleSubmit}>
            <div className="form-row">
                <label>Payee</label>
                <select className="input" value={payeeId} onChange={e => setPayeeId(e.target.value)}>
                    <option value="">— select —</option>
                    {payees.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
            </div>

            <div className="form-row">
                <label>Amount</label>
                <input
                    className="input"
                    type="number"
                    step="0.01"
                    placeholder="-99.99 = outflow"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                />
            </div>

            <div className="form-row">
                <label>Frequency</label>
                <select className="input" value={frequency} onChange={e => setFrequency(e.target.value)}>
                    {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
            </div>

            {usesDay && (
                <div className="form-row">
                    <label>Day of month</label>
                    <input
                        className="input"
                        type="number"
                        min="1"
                        max="31"
                        value={day}
                        onChange={e => setDay(e.target.value)}
                    />
                </div>
            )}

            {usesAnchor && (
                <div className="form-row">
                    <label>Anchor date</label>
                    <input
                        className="input"
                        type="date"
                        value={anchorDate}
                        onChange={e => setAnchorDate(e.target.value)}
                    />
                </div>
            )}

            <div className="form-row">
                <label>Account</label>
                <select className="input" value={accountId} onChange={e => setAccountId(e.target.value)}>
                    <option value="">— none —</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
            </div>

            <div className="form-row" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <label style={{ whiteSpace: 'nowrap' }}>Category</label>
                <select
                    className="input"
                    style={{ flex: 1 }}
                    value={mainCategoryId}
                    onChange={e => {
                        setMainCategoryId(e.target.value)
                        setSubCategoryId('')
                        setTransferAccountId('')
                    }}
                >
                    <option value="">— none —</option>
                    <option value="transfer">Transfer</option>
                    {mainCategories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>

                {isTransfer ? (
                    <select
                        className="input"
                        style={{ flex: 1 }}
                        value={transferAccountId}
                        onChange={e => setTransferAccountId(e.target.value)}
                    >
                        <option value="">— select account —</option>
                        {accounts
                            .filter(a => a.id !== parseInt(accountId))
                            .map(a => <option key={a.id} value={a.id}>{a.name}</option>)
                        }
                    </select>
                ) : filteredSubs.length > 0 && (
                    <select
                        className="input"
                        style={{ flex: 1 }}
                        value={subCategoryId}
                        onChange={e => setSubCategoryId(e.target.value)}
                    >
                        <option value="">— select —</option>
                        {filteredSubs.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                )}
            </div>

            <div className="form-actions">
                <button type="submit" className="btn btn-primary">{existing ? 'Save' : 'Add'}</button>
                <button type="button" className="btn" onClick={onCancel}>Cancel</button>
            </div>
        </form>
    )
}