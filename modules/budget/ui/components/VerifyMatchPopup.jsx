// =============================================================================
// VerifyMatchPopup.jsx — Side-by-side verify popup with split/transfer support
// thrive UI
// =============================================================================

import { useEffect, useState } from 'react'
import { api } from '@trunk/api'
import { fmtMoney, fmtDate } from '../utils/constants'
import { CreatablePayeeSelect, CreatableCategorySelect } from './CreatableSelect'

function SplitEditor({ splits, onChange, totalAmount, categories, showToast }) {
    const splitTotal = splits.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
    const remaining = Math.round((totalAmount - splitTotal) * 100) / 100
    const isBalanced = Math.abs(remaining) < 0.005

    function updateRow(i, field, value) {
        onChange(splits.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
    }

    function addRow() {
        onChange([...splits, {
            category_id: '',
            amount: remaining !== 0 ? String(Math.round(remaining * 100) / 100) : '',
            memo: '',
        }])
    }

    function removeRow(i) {
        onChange(splits.filter((_, idx) => idx !== i))
    }

    return (
        <div className="split-editor">
            {splits.map((row, i) => (
                <div key={i} className="split-row">
                    <div className="split-row-cats">
                        <CreatableCategorySelect
                            categories={categories}
                            value={row.category_id || ''}
                            onChange={val => updateRow(i, 'category_id', val)}
                            onCreated={() => { }}
                            showToast={showToast}
                        />
                    </div>
                    <input className="input split-amount" type="number" step="0.01" placeholder="Amount"
                        value={row.amount} onChange={e => updateRow(i, 'amount', e.target.value)} />
                    <input className="input split-memo" type="text" placeholder="Memo"
                        value={row.memo || ''} onChange={e => updateRow(i, 'memo', e.target.value)} />
                    <button type="button" className="btn btn-ghost btn-danger split-remove" onClick={() => removeRow(i)}>✕</button>
                </div>
            ))}
            <div className="split-footer">
                <button type="button" className="btn" onClick={addRow}>+ Add line</button>
                <span className={`split-remaining ${isBalanced ? 'split-balanced' : 'split-unbalanced'}`}>
                    {isBalanced ? '✓ Balanced' : `${remaining > 0 ? '+' : ''}${fmtMoney(remaining)} remaining`}
                </span>
            </div>
        </div>
    )
}

// mode: 'category' | 'split' | 'transfer'
export default function VerifyMatchPopup({
    transactionId, onCancel, onVerified, showToast,
    onPayeeCreated, onCategoryCreated,
}) {
    const [uv, setUv] = useState(null)
    const [og, setOg] = useState(null)
    const [payees, setPayees] = useState([])
    const [categories, setCategories] = useState([])
    const [accounts, setAccounts] = useState([])
    const [loading, setLoading] = useState(true)

    const [payeeId, setPayeeId] = useState('')
    const [categoryId, setCategoryId] = useState('')
    const [transferAccountId, setTransferAccountId] = useState('')
    const [memo, setMemo] = useState('')
    const [mode, setMode] = useState('category') // 'category' | 'split' | 'transfer'
    const [splits, setSplits] = useState([])

    useEffect(() => {
        async function load() {
            try {
                const [uvData, pList, cList, aList] = await Promise.all([
                    api.get(`/transactions/${transactionId}`),
                    api.get('/payees/'),
                    api.get('/categories/'),
                    api.get('/budget/accounts/'),
                ])
                const ogData = await api.get(`/transactions/${uvData.matched_transaction_id}`)
                setUv(uvData); setOg(ogData); setPayees(pList); setCategories(cList); setAccounts(aList)
                setMemo([ogData.memo, uvData.memo].filter(Boolean).join(' | ') || '')

                // Pre-fill payee
                if (uvData.import_description) {
                    try {
                        const lookup = await api.get(`/transactions/lookup/payee?raw_name=${encodeURIComponent(uvData.import_description)}`)
                        setPayeeId(lookup.payee_id ? String(lookup.payee_id) : (ogData.payee_id ? String(ogData.payee_id) : ''))
                    } catch { if (ogData.payee_id) setPayeeId(String(ogData.payee_id)) }
                } else if (ogData.payee_id) {
                    setPayeeId(String(ogData.payee_id))
                }

                // Pre-fill mode from existing og transaction
                if (ogData.transfer_account_id) {
                    setMode('transfer')
                    setTransferAccountId(String(ogData.transfer_account_id))
                } else if (ogData.has_splits && ogData.splits?.length > 0) {
                    setMode('split')
                    setSplits(ogData.splits.map(s => ({
                        category_id: s.category_id || '',
                        amount: String(s.amount),
                        memo: s.memo || '',
                    })))
                } else if (ogData.category_id) {
                    setCategoryId(String(ogData.category_id))
                }
            } catch (e) {
                showToast('Failed to load: ' + e.message, 'error')
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [transactionId])

    async function handlePayeeCreated() {
        const fresh = await api.get('/payees/')
        setPayees(fresh)
        onPayeeCreated?.()
    }

    async function handleCategoryCreated() {
        const fresh = await api.get('/categories/')
        setCategories(fresh)
        onCategoryCreated?.()
    }

    function enterSplitMode() {
        setMode('split')
        if (splits.length === 0 && og) {
            setSplits([
                { category_id: '', amount: String(og.amount), memo: '' },
                { category_id: '', amount: '', memo: '' },
            ])
        }
    }

    function enterTransferMode() {
        setMode('transfer')
        setSplits([])
        setCategoryId('')
    }

    function exitToCategory() {
        setMode('category')
        setSplits([])
        setTransferAccountId('')
    }

    const splitTotal = splits.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
    const splitBalance = og ? Math.abs(splitTotal - og.amount) < 0.005 : false

    const canVerify = payeeId && (
        mode === 'transfer' ? transferAccountId :
        mode === 'split'    ? splitBalance :
        categoryId
    )

    async function handleVerify() {
        if (mode === 'split' && !splitBalance) { showToast('Split amounts must equal transaction total', 'error'); return }
        if (mode === 'split' && splits.some(s => !s.category_id)) { showToast('All split lines need a category', 'error'); return }

        const verifyBody = {
            payee_id: payeeId ? parseInt(payeeId) : null,
            memo: memo || null,
            raw_name: uv?.import_description || null,
        }

        if (mode === 'transfer') {
            verifyBody.transfer_account_id = parseInt(transferAccountId)
        } else if (mode === 'split') {
            verifyBody.splits = splits.map(s => ({
                category_id: parseInt(s.category_id),
                amount: parseFloat(s.amount),
                memo: s.memo || null,
            }))
        } else {
            verifyBody.category_id = categoryId ? parseInt(categoryId) : null
        }

        try {
            await api.post(`/transactions/${transactionId}/verify`, verifyBody)
            showToast('Verified', 'success')
            onVerified()
        } catch (e) {
            showToast(e.message, 'error')
        }
    }

    if (loading) return (
        <div className="verify-popup-overlay">
            <div className="verify-popup"><div className="muted">Loading…</div></div>
        </div>
    )
    if (!uv || !og) return null

    // Accounts available for transfer = all except the current account
    const transferTargets = accounts.filter(a => a.id !== uv.account_id)

    return (
        <div className="verify-popup-overlay">
            <div className="verify-popup">
                <div className="verify-popup-title">Verify Match</div>
                <div className="verify-popup-cols">
                    <div className="verify-side">
                        <div className="verify-side-header verify-col--uv">Imported</div>
                        <div className="verify-field"><span className="verify-label">Date</span><span>{fmtDate(uv.date)}</span></div>
                        <div className="verify-field"><span className="verify-label">Payee</span><span>{uv.import_description || '—'}</span></div>
                        <div className="verify-field"><span className="verify-label">Category</span><span>{uv.import_category || '—'}</span></div>
                        <div className="verify-field"><span className="verify-label">Memo</span><span>{uv.memo || '—'}</span></div>
                        <div className="verify-field"><span className="verify-label">Amount</span><span>{fmtMoney(uv.amount)}</span></div>
                        <div className="verify-field"><span className="verify-label">Status</span><span style={{ color: '#f59e0b' }}>Unverified</span></div>
                    </div>

                    <div className="verify-side">
                        <div className="verify-side-header verify-col--og">Merged</div>
                        <div className="verify-field"><span className="verify-label">Date</span><span>{fmtDate(og.date)}</span></div>
                        <div className="verify-field">
                            <span className="verify-label">Payee</span>
                            <CreatablePayeeSelect
                                payees={payees}
                                value={payeeId}
                                onChange={setPayeeId}
                                onCreated={handlePayeeCreated}
                                showToast={showToast}
                            />
                        </div>

                        {mode === 'category' && (
                            <div className="verify-field" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                                <span className="verify-label">Category</span>
                                <CreatableCategorySelect
                                    categories={categories}
                                    value={categoryId}
                                    onChange={setCategoryId}
                                    onCreated={handleCategoryCreated}
                                    showToast={showToast}
                                />
                                <div className="verify-mode-btns">
                                    <button type="button" className="btn split-toggle-btn" onClick={enterSplitMode}>⊕ Split</button>
                                    <button type="button" className="btn split-toggle-btn" onClick={enterTransferMode}>⇄ Transfer</button>
                                </div>
                            </div>
                        )}

                        {mode === 'split' && (
                            <div className="verify-field" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                                <span className="verify-label">Split</span>
                                <SplitEditor
                                    splits={splits}
                                    onChange={setSplits}
                                    totalAmount={og.amount}
                                    categories={categories}
                                    showToast={showToast}
                                />
                                <button type="button" className="btn split-toggle-btn" onClick={exitToCategory}>✕ Remove split</button>
                            </div>
                        )}

                        {mode === 'transfer' && (
                            <div className="verify-field" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                                <span className="verify-label">Transfer to</span>
                                <select
                                    className="input"
                                    value={transferAccountId}
                                    onChange={e => setTransferAccountId(e.target.value)}
                                >
                                    <option value="">Select account…</option>
                                    {transferTargets.map(a => (
                                        <option key={a.id} value={a.id}>
                                            {a.name}{a.number ? ` (…${String(a.number).slice(-4)})` : ''}
                                        </option>
                                    ))}
                                </select>
                                <button type="button" className="btn split-toggle-btn" onClick={exitToCategory}>✕ Remove transfer</button>
                            </div>
                        )}

                        <div className="verify-field">
                            <span className="verify-label">Memo</span>
                            <input className="input" value={memo} onChange={e => setMemo(e.target.value)} />
                        </div>
                        <div className="verify-field"><span className="verify-label">Amount</span><span>{fmtMoney(og.amount)}</span></div>
                        <div className="verify-field"><span className="verify-label">Status</span><span>{og.cleared || 'Uncleared'}</span></div>
                    </div>
                </div>

                <div className="form-actions" style={{ marginTop: '16px' }}>
                    <button className="btn btn-primary" onClick={handleVerify}
                        disabled={!canVerify}
                        title={!canVerify ? 'Payee and category/transfer required' : ''}>
                        Verify
                    </button>
                    <button className="btn" onClick={onCancel}>Cancel</button>
                </div>
            </div>
        </div>
    )
}