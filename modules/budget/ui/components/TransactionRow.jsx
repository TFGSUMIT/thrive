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
  // Only splits truly can't edit in a single row (multiple category/amount lines).
  // Transfers + reconciled rows DO edit in place — the backend mirrors a transfer's
  // amount/date/memo to its paired leg, and the transfer target (category) stays
  // read-only inline (change it via the full form). Unverified rows keep the
  // import/verify flow.
  const fullFormOnly = t.has_splits || isUnverified

  // tap the row → edit in place (or hand split/unverified rows to the full form)
  const enterEdit = () => {
    if (editing) return
    if (fullFormOnly) { onEdit(); return }
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

  const actionButtons = (
    <>
      <button className="txn-edit-act txn-edit-act--save"   title="Save"   onClick={save}>✓</button>
      <button className="txn-edit-act txn-edit-act--cancel" title="Cancel" onClick={cancel}>✗</button>
      <button className="txn-edit-act txn-edit-act--delete" title="Delete" onClick={(e) => { stop(e); onDelete() }}>🗑</button>
    </>
  )

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

      {/* Category — a transfer's target is read-only inline (its badge); other
          rows get the category picker */}
      {editing && !isTransfer
        ? <span className="txn-edit-field" onClick={stop}>
            <FilterCombo options={categoryOptions} value={draft.category_id} placeholder="Category…" width={140}
              onChange={v => setDraft(d => ({ ...d, category_id: v }))} />
          </span>
        : <span className="txn-category" title={editing && isTransfer ? 'Edit the transfer target in the full form' : undefined}>{categoryDisplay}</span>}

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

      {/* Balance cell — while editing it holds the Save / Cancel / Delete cluster
          (in-flow in the same grid slot, so every column stays aligned) */}
      {showBalance && (
        editing
          ? <div className="txn-edit-actions" onClick={stop}>{actionButtons}</div>
          : <span className="txn-balance txn-amount-col">
              {t.balance !== null && t.balance !== undefined ? fmtMoney(t.balance) : ''}
            </span>
      )}

      {/* views with no balance column (all-accounts): float the cluster at the right */}
      {!showBalance && editing && (
        <div className="txn-edit-actions txn-edit-actions--float" onClick={stop}>{actionButtons}</div>
      )}
    </div>
  )
}
