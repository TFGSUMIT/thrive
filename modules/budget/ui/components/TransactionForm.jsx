// =============================================================================
// TransactionForm.jsx — Add / edit / verify transaction form with split support
// thrive UI
// =============================================================================

import { useEffect, useState } from 'react'
import { api } from '@trunk/api'
import { todayStr, fmtMoney } from '../utils/constants'
import { CreatablePayeeSelect, CreatableCategorySelect } from './CreatableSelect'

// Status picker styles — checkbox-style chips, single-select (radio behavior)
const STATUS_ROW  = { display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1 }
const statusChip  = (on, disabled) => ({
  display: 'flex', alignItems: 'center', gap: 7, userSelect: 'none', whiteSpace: 'nowrap',
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1,
  fontSize: 13, padding: '7px 12px', borderRadius: 6,
  border: `1px solid ${on ? 'var(--accent, #7c8cff)' : 'var(--border, #333)'}`,
  background: on ? 'var(--accent-dim, rgba(124,140,255,0.14))' : 'transparent',
  color: on ? 'var(--accent, #7c8cff)' : 'inherit',
})
const statusBox = (on) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 16, height: 16, borderRadius: 4, fontSize: 11, lineHeight: 1, flexShrink: 0,
  border: `1px solid ${on ? 'var(--accent, #7c8cff)' : 'var(--border, #555)'}`,
  background: on ? 'var(--accent, #7c8cff)' : 'transparent',
  color: on ? 'var(--bg-primary, #0f0f0f)' : 'transparent',
})

// ---------------------------------------------------------------------------
// SplitEditor — inline split row editor
// ---------------------------------------------------------------------------
function SplitEditor({ splits, onChange, totalAmount, categories, showToast, onCategoryCreated }) {
    const splitTotal  = splits.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
    const remaining   = Math.round((totalAmount - splitTotal) * 100) / 100
    const isBalanced  = Math.abs(remaining) < 0.005

    // Update a single row by merging fields — single setState call avoids stale
    // closure overwrites when two fields need to change at once.
    function updateRow(i, fields) {
        onChange(splits.map((r, idx) => idx === i ? { ...r, ...fields } : r))
    }

    function addRow() {
        onChange([...splits, {
            category_id: '',
            _mainCatId: '',
            amount: remaining !== 0 ? String(Math.round(remaining * 100) / 100) : '',
            memo: '',
        }])
    }

    function removeRow(i) {
        onChange(splits.filter((_, idx) => idx !== i))
    }

    return (
        <div className="split-editor">
            {splits.map((row, i) => {
                return (
                    <div key={i} className="split-row">
                        <div className="split-row-cats">
                            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                                <CreatableCategorySelect
                                    categories={categories}
                                    value={row.category_id || ''}
                                    onChange={val => updateRow(i, { category_id: val, _mainCatId: '' })}
                                    onCreated={onCategoryCreated}
                                    showToast={showToast}
                                />
                            </div>
                        </div>
                        <input
                            className="input split-amount"
                            type="number"
                            step="0.01"
                            placeholder="Amount"
                            value={row.amount}
                            onChange={e => updateRow(i, { amount: e.target.value })}
                        />
                        <input
                            className="input split-memo"
                            type="text"
                            placeholder="Memo (optional)"
                            value={row.memo || ''}
                            onChange={e => updateRow(i, { memo: e.target.value })}
                        />
                        <button type="button" className="btn btn-ghost btn-danger split-remove"
                            onClick={() => removeRow(i)}>✕</button>
                    </div>
                )
            })}
            <div className="split-footer">
                <button type="button" className="btn" onClick={addRow}>+ Add line</button>
                <span className={`split-remaining ${isBalanced ? 'split-balanced' : 'split-unbalanced'}`}>
                    {isBalanced
                        ? '✓ Balanced'
                        : `${remaining > 0 ? '+' : ''}${fmtMoney(remaining)} remaining`}
                </span>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// TransactionForm
// ---------------------------------------------------------------------------
export default function TransactionForm({
    existing, defaultAccountId,
    accounts, payees, categories,
    onCancel, onSaved, showToast,
    onPayeeCreated, onCategoryCreated,
}) {
    const [accountId, setAccountId] = useState(existing?.account_id ?? defaultAccountId ?? '')
    const [date, setDate] = useState(existing?.date ?? todayStr())
    const [payeeId, setPayeeId] = useState(existing?.payee_id ? String(existing.payee_id) : '')
    const [amount, setAmount] = useState(existing?.amount ?? '')
    const [memo, setMemo] = useState(existing?.memo ?? '')
    const [cleared, setCleared] = useState(existing?.cleared ?? '')
    const [categoryId, setCategoryId] = useState('')
    const [transferAccountId, setTransferAccountId] = useState('')
    const [splitMode, setSplitMode] = useState(false)
    const [splits, setSplits] = useState([])

    const isTransfer = categoryId === 'transfer'
    const mainCategories = categories.filter(c => c.parent_id === null)

    useEffect(() => {
        if (!existing) return

        if (existing.has_splits && existing.splits?.length > 0) {
            setSplitMode(true)
            setSplits(existing.splits.map(s => ({
                category_id: s.category_id ? String(s.category_id) : '',
                _mainCatId: '',
                amount: String(s.amount),
                memo: s.memo || '',
            })))
            if (existing.payee_id) setPayeeId(String(existing.payee_id))
            return
        }

        if (existing.transfer_account_id) {
            setCategoryId('transfer')
            setTransferAccountId(existing.transfer_account_id.toString())
            return
        }
        if (existing.category_id) setCategoryId(String(existing.category_id))

        if (existing.cleared === 'Unverified' && !existing.matched_transaction_id && existing.import_description) {
            api.get(`/transactions/lookup/payee?raw_name=${encodeURIComponent(existing.import_description)}`)
                .then(res => { if (res.payee_id) setPayeeId(String(res.payee_id)) })
                .catch(() => { })
        } else if (existing.payee_id) {
            setPayeeId(String(existing.payee_id))
        }
    }, [existing, categories])

    function enterSplitMode() {
        setSplitMode(true)
        if (splits.length === 0) {
            setSplits([
                { category_id: '', _mainCatId: '', amount: amount ? String(amount) : '', memo: '' },
                { category_id: '', _mainCatId: '', amount: '', memo: '' },
            ])
        }
    }

    function exitSplitMode() {
        setSplitMode(false)
        setSplits([])
    }

    const isExistingUnverified   = existing?.cleared === 'Unverified' && !!existing?.matched_transaction_id
    const isUnmatchedUnverified  = existing?.cleared === 'Unverified' && !existing?.matched_transaction_id

    const splitTotal   = splits.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
    const splitBalance = Math.abs(splitTotal - parseFloat(amount || 0)) < 0.005

    async function handleSubmit(e) {
        e.preventDefault()
        if (!accountId) return showToast('Account required', 'error')
        if (!date) return showToast('Date required', 'error')
        if (amount === '') return showToast('Amount required', 'error')
        if (isTransfer && !transferAccountId) return showToast('Transfer account required', 'error')
        if (splitMode && !splitBalance) return showToast('Split amounts must equal transaction total', 'error')
        if (splitMode && splits.some(s => !s.category_id)) return showToast('All split lines need a category', 'error')

        const body = {
            account_id: parseInt(accountId),
            date,
            payee_id: payeeId ? parseInt(payeeId) : null,
            amount: parseFloat(amount),
            memo: memo || null,
            cleared: cleared || null,
        }

        if (isTransfer) {
            body.transfer_account_id = parseInt(transferAccountId)
            body.category_id = null
        } else if (!splitMode) {
            body.category_id = categoryId ? parseInt(categoryId) : null
        } else {
            body.category_id = null
        }

        // Strip internal UI-only fields before sending splits
        const cleanSplits = splits.map(({ category_id, amount, memo }) => ({
            category_id: parseInt(category_id),
            amount: parseFloat(amount),
            memo: memo || null,
        }))

        try {
            if (existing) {
                const patchBody = { ...body }
                if (isExistingUnverified || isUnmatchedUnverified) {
                    patchBody.cleared = 'Unverified'
                } else if (cleared === '') {
                    patchBody.cleared = 'none'
                }
                await api.patch(`/transactions/${existing.id}`, patchBody)

                if (splitMode) {
                    await api.put(`/transactions/${existing.id}/splits`, cleanSplits)
                } else if (existing.has_splits) {
                    await api.put(`/transactions/${existing.id}/splits`, [])
                }

                if ((isExistingUnverified || isUnmatchedUnverified) && body.payee_id) {
                    const verifyBody = {
                        payee_id: body.payee_id,
                        memo: body.memo || null,
                        raw_name: existing.import_description || null,
                        cleared: body.cleared || 'Cleared',
                    }
                    if (splitMode) {
                        verifyBody.splits = cleanSplits
                    } else {
                        verifyBody.category_id = body.category_id || null
                        verifyBody.transfer_account_id = body.transfer_account_id || null
                    }
                    await api.post(`/transactions/${existing.id}/verify`, verifyBody)
                    showToast('Verified', 'success')
                } else {
                    showToast('Updated', 'success')
                }
            } else {
                const res = await api.post('/transactions/', body)
                if (splitMode && res.id) {
                    await api.put(`/transactions/${res.id}/splits`, cleanSplits)
                }
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
                <label>Account</label>
                <select className="input" value={accountId} onChange={e => setAccountId(e.target.value)}>
                    <option value="">— select —</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
            </div>
            <div className="form-row">
                <label>Date</label>
                <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="form-row">
                <label>Payee</label>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {existing?.cleared === 'Unverified' && existing?.import_description && (
                        <span className="muted" style={{ fontSize: '11px' }}>Imported: {existing.import_description}</span>
                    )}
                    <CreatablePayeeSelect
                        payees={payees}
                        value={payeeId}
                        onChange={setPayeeId}
                        onCreated={onPayeeCreated}
                        showToast={showToast}
                    />
                </div>
            </div>

            {/* Category / Transfer / Split */}
            {!splitMode ? (
                <div className="form-row" style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <label style={{ whiteSpace: 'nowrap', paddingTop: '8px' }}>Category</label>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {existing?.cleared === 'Unverified' && existing?.import_category && (
                            <span className="muted" style={{ fontSize: '11px' }}>Imported: {existing.import_category}</span>
                        )}
                        <CreatableCategorySelect
                            categories={categories}
                            value={categoryId}
                            onChange={setCategoryId}
                            onCreated={onCategoryCreated}
                            showToast={showToast}
                            accounts={accounts}
                            currentAccountId={accountId}
                            isTransfer={isTransfer}
                            transferAccountId={transferAccountId}
                            onEnterTransfer={() => { setCategoryId('transfer'); setTransferAccountId('') }}
                            onExitTransfer={() => { setCategoryId(''); setTransferAccountId('') }}
                            onTransferChange={setTransferAccountId}
                        />
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {!isTransfer && (
                                <button type="button" className="btn split-toggle-btn" onClick={enterSplitMode}>
                                    ⊕ Split transaction
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="form-row" style={{ alignItems: 'flex-start' }}>
                    <label style={{ paddingTop: '8px' }}>Split</label>
                    <div style={{ flex: 1 }}>
                        <SplitEditor
                            splits={splits}
                            onChange={setSplits}
                            totalAmount={parseFloat(amount) || 0}
                            categories={categories}
                            showToast={showToast}
                            onCategoryCreated={onCategoryCreated}
                        />
                        <button type="button" className="btn split-toggle-btn" onClick={exitSplitMode}
                            style={{ marginTop: '8px' }}>
                            ✕ Remove split
                        </button>
                    </div>
                </div>
            )}

            <div className="form-row">
                <label>Amount</label>
                <input className="input" type="number" step="0.01" placeholder="-99.99 = outflow"
                    value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div className="form-row">
                <label>Memo</label>
                <input className="input" type="text" value={memo}
                    onChange={e => setMemo(e.target.value)} placeholder="(optional)" />
            </div>
            <div className="form-row">
                <label>Status</label>
                {isExistingUnverified ? (
                    <div style={STATUS_ROW}>
                        <span style={statusChip(true, true)}><span style={statusBox(true)}>✓</span> Unverified</span>
                    </div>
                ) : (
                    <div style={STATUS_ROW}>
                        {[['', 'Uncleared'], ['Cleared', 'Cleared'], ['Reconciled', 'Reconciled']].map(([val, label]) => {
                            const on = cleared === val
                            return (
                                <span key={label} role="button" style={statusChip(on)} onClick={() => setCleared(val)}>
                                    <span style={statusBox(on)}>{on ? '✓' : ''}</span> {label}
                                </span>
                            )
                        })}
                    </div>
                )}
            </div>
            <div className="form-actions">
                {(isExistingUnverified || isUnmatchedUnverified) ? (
                    <button type="submit" className="btn btn-primary"
                        disabled={
                            !payeeId ||
                            (!splitMode && !categoryId && !isTransfer) ||
                            (isTransfer && !transferAccountId) ||
                            (splitMode && !splitBalance)
                        }>
                        Verify
                    </button>
                ) : (
                    <button type="submit" className="btn btn-primary">{existing ? 'Save' : 'Add'}</button>
                )}
                <button type="button" className="btn" onClick={onCancel}>Cancel</button>
            </div>
        </form>
    )
}