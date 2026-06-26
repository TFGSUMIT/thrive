// =============================================================================
// TransactionRow.jsx — Single transaction row
// thrive UI
//
// Each data cell (Date / Payee / Category / Memo / Amount) is click-to-edit:
// clicking opens an inline editor for just that field (InlineCellEdit) and
// commits a single-field PATCH — no need to open the full row form. Split and
// transfer rows still open the full form (their category/amount aren't a single
// value); reconciled rows are left read-only for safety.
// =============================================================================
import { useState } from 'react'
import { fmtMoney, fmtDate, CLEARED_LABEL, CLEARED_TITLE } from '../utils/constants'
import InlineCellEdit from './InlineCellEdit'

export default function TransactionRow({
  t, showBalance, showAccount, selected, onSelect,
  onEdit, onDelete, onCycleStatus, onAccountClick, matchClass = '',
  categoryOptions = [], payeeOptions = [], onPatch,
}) {
  const [edit, setEdit] = useState(null)   // 'date' | 'payee' | 'category' | 'memo' | 'amount' | null
  const close = () => setEdit(null)

  const isIncome     = (t.amount || 0) > 0
  const isUnverified = t.cleared === 'Unverified'
  const amountClass  = isUnverified
    ? 'sched-amount unverified'
    : t.amount === 0
      ? 'sched-amount zero'
      : isIncome ? 'sched-amount income' : 'sched-amount expense'
  const clearedKey = t.cleared === null || t.cleared === undefined ? 'null' : t.cleared

  const isTransfer = !!t.transfer_account_id
  // splits/transfers aren't a single value; reconciled rows are locked for safety
  const lockInline = t.has_splits || isTransfer || t.cleared === 'Reconciled'

  // open an inline editor for a field, or fall back to the full form when locked
  const startEdit = (field) => (e) => {
    e.stopPropagation()
    if (lockInline) { onEdit(); return }
    setEdit(field)
  }

  // commit a single field (skipping no-ops), then close the editor
  const commit = (field, raw) => {
    let fields = null
    if (field === 'category') {
      const id = raw == null || raw === '' ? null : Number(raw)
      if (id !== (t.category_id ?? null)) fields = { category_id: id }
    } else if (field === 'payee') {
      const id = raw == null || raw === '' ? null : Number(raw)
      if (id !== (t.payee_id ?? null)) fields = { payee_id: id }
    } else if (field === 'memo') {
      const v = (raw ?? '').trim()
      if (v !== (t.memo || '')) fields = { memo: v || null }
    } else if (field === 'date') {
      const v = (raw ?? '').trim()
      if (v && v !== t.date) fields = { date: v }
    } else if (field === 'amount') {
      const n = parseFloat(raw)
      if (!isNaN(n) && n !== t.amount) fields = { amount: n }
    }
    close()
    if (fields) onPatch?.(t.id, fields)
  }

  const editTitle = lockInline ? 'Edit transaction' : 'Click to edit'

  const categoryText = t.category_name || (isUnverified ? t.import_category : null)
  const categoryDisplay = t.has_splits
    ? <span className="split-badge">split</span>
    : (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        {isTransfer && (
          <span style={{
            fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.04em',
            padding: '1px 5px', borderRadius: 3,
            background: 'rgba(99,179,237,0.12)',
            color: '#63b3ed',
            border: '1px solid rgba(99,179,237,0.25)',
            flexShrink: 0,
          }}>⇄</span>
        )}
        {categoryText || <span className="txn-cell-empty">+ category</span>}
      </span>
    )

  return (
    <div className={`txn-row ${matchClass} ${selected ? 'txn-row--selected' : ''}`}>
      <input
        type="checkbox"
        className="txn-check"
        checked={selected}
        onChange={onSelect}
        onClick={e => e.stopPropagation()}
      />
      <button
        className={`txn-cleared txn-status-col cleared-${clearedKey}${isUnverified ? ' cleared-unverified' : ''}`}
        title={CLEARED_TITLE[clearedKey]}
        onClick={isUnverified ? onEdit : onCycleStatus}
      >
        {CLEARED_LABEL[clearedKey]}
      </button>

      {/* Date */}
      {edit === 'date'
        ? <span className="txn-date txn-editing"><InlineCellEdit kind="date" value={t.date} onCommit={v => commit('date', v)} onCancel={close} /></span>
        : <span className="txn-date txn-editable" title={editTitle} onClick={startEdit('date')}>{fmtDate(t.date)}</span>}

      {showAccount && (
        <span className="txn-account">
          <button className="btn btn-ghost txn-account-link" onClick={() => onAccountClick(t.account_id)}>
            {t.account_name || ''}
          </button>
        </span>
      )}

      {/* Payee */}
      {edit === 'payee'
        ? <span className="txn-payee txn-editing"><InlineCellEdit kind="picker" value={t.payee_id} options={payeeOptions} placeholder="Payee…" onCommit={v => commit('payee', v)} onCancel={close} /></span>
        : <span className="txn-payee txn-editable" title={editTitle} onClick={startEdit('payee')}>
            {t.payee_name || (isUnverified ? t.import_description : null) || <span className="txn-cell-empty">+ payee</span>}
          </span>}

      {/* Category */}
      {edit === 'category'
        ? <span className="txn-category txn-editing"><InlineCellEdit kind="picker" value={t.category_id} options={categoryOptions} placeholder="Category…" onCommit={v => commit('category', v)} onCancel={close} /></span>
        : <span className="txn-category txn-editable" title={editTitle} onClick={startEdit('category')}>{categoryDisplay}</span>}

      {/* Memo */}
      {edit === 'memo'
        ? <span className="txn-memo txn-editing"><InlineCellEdit kind="memo" value={t.memo} placeholder="Memo…" onCommit={v => commit('memo', v)} onCancel={close} /></span>
        : <span className="txn-memo txn-editable" title={editTitle} onClick={startEdit('memo')}>{t.memo || <span className="txn-cell-empty">+ memo</span>}</span>}

      {/* Amount */}
      {edit === 'amount'
        ? <span className={`${amountClass} txn-amount-col txn-editing`}><InlineCellEdit kind="amount" value={t.amount} onCommit={v => commit('amount', v)} onCancel={close} /></span>
        : <span className={`${amountClass} txn-amount-col txn-editable`} title={editTitle} onClick={startEdit('amount')}>{fmtMoney(t.amount || 0)}</span>}

      {showBalance && (
        <span className="txn-balance txn-amount-col">
          {t.balance !== null && t.balance !== undefined ? fmtMoney(t.balance) : ''}
        </span>
      )}
      <div className="txn-actions">
        <button className="btn btn-ghost" onClick={onEdit}>Edit</button>
        <button className="btn btn-ghost btn-danger" onClick={onDelete}>Delete</button>
      </div>
    </div>
  )
}
