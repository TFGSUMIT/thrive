// =============================================================================
// TransactionRow.jsx — Single transaction row
// thrive UI
//
// Tap a row to edit it in place (#1): the row's cells turn into controls
// (date / payee / category / memo / amount) bound to a local draft, and the
// balance cell is replaced by a ✓ Save / ✗ Cancel / 🗑 Delete cluster. Edits
// stage locally and commit as one PATCH on Save (so date/amount re-sorts only
// happen after you're done). Split / transfer / reconciled rows aren't a single
// value, so they fall back to the full TransactionForm via onEdit. Status (the
// colored dot) still cycles on tap; account is left fixed. Works on touch — no
// hover anywhere.
// =============================================================================
import { useState } from 'react'
import { fmtMoney, fmtDate, CLEARED_LABEL, CLEARED_TITLE } from '../utils/constants'
import FilterCombo from './FilterCombo'

export default function TransactionRow({
  t, showBalance, showAccount, selected, onSelect,
  onEdit, onDelete, onCycleStatus, onAccountClick, matchClass = '',
  categoryOptions = [], payeeOptions = [], accountOptions = [], onPatch,
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(null)

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

  // tap the row → edit in place (or hand locked/unverified rows to the full form)
  const enterEdit = () => {
    if (editing) return
    if (isUnverified || lockInline) { onEdit(); return }
    setDraft({
      date:        t.date || '',
      payee_id:    t.payee_id != null ? String(t.payee_id) : '',
      category_id: t.category_id != null ? String(t.category_id) : '',
      memo:        t.memo || '',
      amount:      t.amount != null ? String(t.amount) : '',
    })
    setEditing(true)
  }

  const cancel = () => { setEditing(false); setDraft(null) }

  const save = () => {
    const fields = {}
    if (draft.date && draft.date !== t.date) fields.date = draft.date
    const pid = draft.payee_id === '' ? null : Number(draft.payee_id)
    if (pid !== (t.payee_id ?? null)) fields.payee_id = pid
    const cid = draft.category_id === '' ? null : Number(draft.category_id)
    if (cid !== (t.category_id ?? null)) fields.category_id = cid
    const memo = (draft.memo ?? '').trim()
    if (memo !== (t.memo || '')) fields.memo = memo || null
    const amt = parseFloat(draft.amount)
    if (!isNaN(amt) && amt !== t.amount) fields.amount = amt
    if (Object.keys(fields).length) onPatch?.(t.id, fields)
    setEditing(false); setDraft(null)
  }

  // Enter commits, Esc cancels (text inputs only; the pickers handle their own keys)
  const keyNav = (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); save() }
    if (e.key === 'Escape') { e.preventDefault(); cancel() }
  }

  const stop = (e) => e.stopPropagation()

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
    <div
      className={`txn-row ${matchClass} ${selected ? 'txn-row--selected' : ''} ${editing ? 'txn-row--editing' : ''}`}
      onClick={editing ? undefined : enterEdit}
      title={editing ? undefined : 'Tap to edit'}
    >
      <input
        type="checkbox"
        className="txn-check"
        checked={selected}
        onChange={onSelect}
        onClick={stop}
      />
      <button
        className={`txn-cleared txn-status-col cleared-${clearedKey}${isUnverified ? ' cleared-unverified' : ''}`}
        title={CLEARED_TITLE[clearedKey]}
        onClick={(e) => { stop(e); (isUnverified ? onEdit : onCycleStatus)() }}
      >
        {CLEARED_LABEL[clearedKey]}
      </button>

      {/* Date */}
      {editing
        ? <input className="input txn-edit-field" type="date" value={draft.date}
            onClick={stop} onKeyDown={keyNav}
            onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} />
        : <span className="txn-date">{fmtDate(t.date)}</span>}

      {showAccount && (
        <span className="txn-account">
          <button className="btn btn-ghost txn-account-link" onClick={(e) => { stop(e); onAccountClick(t.account_id) }}>
            {t.account_name || ''}
          </button>
        </span>
      )}

      {/* Payee */}
      {editing
        ? <span className="txn-edit-field" onClick={stop}>
            <FilterCombo options={payeeOptions} value={draft.payee_id} placeholder="Payee…" width={140}
              onChange={v => setDraft(d => ({ ...d, payee_id: v }))} />
          </span>
        : <span className="txn-payee">
            {t.payee_name || (isUnverified ? t.import_description : null) || <span className="txn-cell-empty">+ payee</span>}
          </span>}

      {/* Category */}
      {editing
        ? <span className="txn-edit-field" onClick={stop}>
            <FilterCombo options={categoryOptions} value={draft.category_id} placeholder="Category…" width={140}
              onChange={v => setDraft(d => ({ ...d, category_id: v }))} />
          </span>
        : <span className="txn-category">{categoryDisplay}</span>}

      {/* Memo */}
      {editing
        ? <input className="input txn-edit-field" type="text" value={draft.memo} placeholder="Memo…"
            onClick={stop} onKeyDown={keyNav}
            onChange={e => setDraft(d => ({ ...d, memo: e.target.value }))} />
        : <span className="txn-memo">{t.memo || <span className="txn-cell-empty">+ memo</span>}</span>}

      {/* Amount */}
      {editing
        ? <input className="input txn-edit-field txn-amount-col" type="text" inputMode="decimal"
            value={draft.amount} placeholder="0.00" onClick={stop} onKeyDown={keyNav}
            onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))} />
        : <span className={`${amountClass} txn-amount-col`}>{fmtMoney(t.amount || 0)}</span>}

      {/* Balance — or, while editing, the Save / Cancel / Delete cluster */}
      {showBalance && !editing && (
        <span className="txn-balance txn-amount-col">
          {t.balance !== null && t.balance !== undefined ? fmtMoney(t.balance) : ''}
        </span>
      )}

      {editing && (
        <div className="txn-edit-actions" onClick={stop}>
          <button className="txn-edit-act txn-edit-act--save"   title="Save"   onClick={save}>✓</button>
          <button className="txn-edit-act txn-edit-act--cancel" title="Cancel" onClick={cancel}>✗</button>
          <button className="txn-edit-act txn-edit-act--delete" title="Delete" onClick={(e) => { stop(e); onDelete() }}>🗑</button>
        </div>
      )}
    </div>
  )
}
