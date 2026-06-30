// =============================================================================
// TransactionRow.jsx — Single transaction row
// thrive UI
//
// Tap a row to edit it in place (#1): the cells turn into controls (date / payee /
// category / memo / amount), the balance cell becomes ✓ Save / ✗ Cancel / 🗑 Delete,
// and edits stage in a local draft and commit on Save. The category cell is one
// dropdown that does category OR transfer OR split — so you can re-categorise,
// re-point/convert a transfer, or split/un-split, all in place. Splitting expands
// editable category+amount lines under the row. Only unverified (import/verify) rows
// fall back to the full form. Status (the dot) cycles on tap; account is fixed.
// Works on touch — no hover anywhere.
// =============================================================================
import { useState } from 'react'
import { fmtMoney, fmtDate, CLEARED_LABEL, CLEARED_TITLE } from '../utils/constants'

export default function TransactionRow({
  t, showBalance, showAccount, selected, onSelect,
  onEdit, onDelete, onCycleStatus, onAccountClick, matchClass = '',
  categoryOptions = [], payeeOptions = [], accountOptions = [], onPatch, onSaveSplit,
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
  // Only unverified import rows keep the dedicated verify/form flow; everything
  // else (incl. transfers + splits) edits in place.
  const fullFormOnly = isUnverified

  // tap the row → edit in place (or hand unverified rows to the verify/form flow)
  const enterEdit = () => {
    if (editing) return
    if (fullFormOnly) { onEdit(); return }
    setDraft({
      date:                t.date || '',
      payee_id:            t.payee_id != null ? String(t.payee_id) : '',
      category_id:         t.category_id != null ? String(t.category_id) : '',
      transfer_account_id: t.transfer_account_id != null ? String(t.transfer_account_id) : '',
      memo:                t.memo || '',
      amount:              t.amount != null ? String(t.amount) : '',
      splits:              (t.splits || []).map(s => ({
        category_id: s.category_id != null ? String(s.category_id) : '',
        amount:      String(s.amount),
        memo:        s.memo || '',
      })),
    })
    setEditing(true)
  }

  const cancel = () => { setEditing(false); setDraft(null) }

  // "split mode" = the draft is holding split lines (and not a single cat/transfer)
  const splitMode = editing && draft && draft.splits.length > 0
    && draft.category_id === '' && draft.transfer_account_id === ''
  const splitSum  = (draft?.splits || []).reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
  const total     = parseFloat(draft?.amount) || 0
  const remaining = Math.round((total - splitSum) * 100) / 100

  const updateLine = (i, patch) => setDraft(d => ({ ...d, splits: d.splits.map((l, idx) => idx === i ? { ...l, ...patch } : l) }))
  const addLine    = () => setDraft(d => ({ ...d, splits: [...d.splits, { category_id: '', amount: '', memo: '' }] }))
  const removeLine = (i) => setDraft(d => ({ ...d, splits: d.splits.filter((_, idx) => idx !== i) }))

  const save = () => {
    if (splitMode) {
      const fields = {
        date:     draft.date || t.date,
        payee_id: draft.payee_id === '' ? null : Number(draft.payee_id),
        memo:     (draft.memo ?? '').trim() || null,
        amount:   total,
      }
      const lines = draft.splits
        .filter(l => l.amount !== '' || l.category_id !== '')
        .map(l => ({ category_id: l.category_id === '' ? null : Number(l.category_id),
                     amount: parseFloat(l.amount) || 0, memo: l.memo || null }))
      onSaveSplit?.(t.id, fields, lines)
      setEditing(false); setDraft(null)
      return
    }
    const fields = {}
    if (draft.date && draft.date !== t.date) fields.date = draft.date
    const pid = draft.payee_id === '' ? null : Number(draft.payee_id)
    if (pid !== (t.payee_id ?? null)) fields.payee_id = pid
    const memo = (draft.memo ?? '').trim()
    if (memo !== (t.memo || '')) fields.memo = memo || null
    const amt = parseFloat(draft.amount)
    if (!isNaN(amt) && amt !== t.amount) fields.amount = amt
    // category cell: transfer XOR category. transfer_account_id → make/keep a
    // transfer; a non-null category_id → normal category (backend converts away
    // from a transfer/split). If the row WAS a split and we're here, a category
    // was chosen → that un-splits it server-side.
    if (draft.transfer_account_id !== '') {
      const tid = Number(draft.transfer_account_id)
      if (tid !== (t.transfer_account_id ?? null)) fields.transfer_account_id = tid
    } else {
      const cid = draft.category_id === '' ? null : Number(draft.category_id)
      const changed = cid !== (t.category_id ?? null) || t.transfer_account_id != null || t.has_splits
      if (changed && cid != null) fields.category_id = cid
    }
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

  // category cell selection: cat:<id> | xfer:<id> | __split__ | '' (none)
  const catCellValue = splitMode ? '__split__'
    : draft?.transfer_account_id ? `xfer:${draft.transfer_account_id}`
    : draft?.category_id ? `cat:${draft.category_id}` : ''
  const onCatCell = (e) => {
    const v = e.target.value
    if (v === '__split__') setDraft(d => ({ ...d, category_id: '', transfer_account_id: '',
      splits: d.splits.length ? d.splits : [
        { category_id: '', amount: d.amount || '', memo: '' },
        { category_id: '', amount: '', memo: '' },
      ] }))
    else if (v.startsWith('xfer:')) setDraft(d => ({ ...d, transfer_account_id: v.slice(5), category_id: '', splits: [] }))
    else if (v.startsWith('cat:'))  setDraft(d => ({ ...d, category_id: v.slice(4), transfer_account_id: '', splits: [] }))
    else                            setDraft(d => ({ ...d, category_id: '', transfer_account_id: '', splits: [] }))
  }

  const categoryText = t.category_name || (isUnverified ? t.import_category : null)
  const categoryDisplay = t.has_splits
    ? <span className="split-badge">split</span>
    : (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        {isTransfer && (
          <span style={{
            fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.04em',
            padding: '1px 5px', borderRadius: 3,
            background: 'rgba(99,179,237,0.12)', color: '#63b3ed',
            border: '1px solid rgba(99,179,237,0.25)', flexShrink: 0,
          }}>⇄</span>
        )}
        {categoryText || <span className="txn-cell-empty">+ category</span>}
      </span>
    )

  return (
    <>
    <div
      className={`txn-row ${matchClass} ${selected ? 'txn-row--selected' : ''} ${editing ? 'txn-row--editing' : ''}`}
      onClick={editing ? undefined : enterEdit}
      title={editing ? undefined : 'Tap to edit'}
    >
      <input type="checkbox" className="txn-check" checked={selected} onChange={onSelect} onClick={stop} />
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

      {/* Payee — native dropdown */}
      {editing
        ? <select className="input txn-edit-field" value={draft.payee_id} onClick={stop}
            onChange={e => setDraft(d => ({ ...d, payee_id: e.target.value }))}>
            <option value="">— payee —</option>
            {payeeOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        : <span className="txn-payee">
            {t.payee_name || (isUnverified ? t.import_description : null) || <span className="txn-cell-empty">+ payee</span>}
          </span>}

      {/* Category — one dropdown for category / transfer / split */}
      {!editing
        ? <span className="txn-category">{categoryDisplay}</span>
        : <select className="input txn-edit-field" onClick={stop} value={catCellValue} onChange={onCatCell}>
            <option value="">— category —</option>
            <option value="__split__">⋔ Split…</option>
            {(isTransfer ? ['Transfer to', 'Category'] : ['Category', 'Transfer to']).map(group =>
              group === 'Category'
                ? <optgroup key="cat" label="Category">
                    {categoryOptions.map(o => <option key={`c${o.id}`} value={`cat:${o.id}`}>{o.label}</option>)}
                  </optgroup>
                : <optgroup key="xfer" label="Transfer to">
                    {accountOptions.filter(a => String(a.id) !== String(t.account_id)).map(o =>
                      <option key={`a${o.id}`} value={`xfer:${o.id}`}>⇄ {o.label}</option>)}
                  </optgroup>
            )}
          </select>}

      {/* Memo */}
      {editing
        ? <input className="input txn-edit-field" type="text" value={draft.memo} placeholder="Memo…"
            onClick={stop} onKeyDown={keyNav}
            onChange={e => setDraft(d => ({ ...d, memo: e.target.value }))} />
        : <span className="txn-memo">{t.memo || <span className="txn-cell-empty">+ memo</span>}</span>}

      {/* Amount (the total — splits must sum to it) */}
      {editing
        ? <input className="input txn-edit-field txn-amount-col" type="text" inputMode="decimal"
            value={draft.amount} placeholder="0.00" onClick={stop} onKeyDown={keyNav}
            onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))} />
        : <span className={`${amountClass} txn-amount-col`}>{fmtMoney(t.amount || 0)}</span>}

      {/* Balance cell — holds the action cluster while editing */}
      {showBalance && (
        editing
          ? <div className="txn-edit-actions" onClick={stop}>{actionButtons}</div>
          : <span className="txn-balance txn-amount-col">
              {t.balance !== null && t.balance !== undefined ? fmtMoney(t.balance) : ''}
            </span>
      )}
      {!showBalance && editing && (
        <div className="txn-edit-actions txn-edit-actions--float" onClick={stop}>{actionButtons}</div>
      )}
    </div>

    {/* Split lines — editable category+amount rows under the transaction */}
    {splitMode && (
      <div className="txn-split-edit" onClick={stop}>
        {draft.splits.map((line, i) => (
          <div key={i} className="txn-split-line">
            <select className="input" value={line.category_id}
              onChange={e => updateLine(i, { category_id: e.target.value })}>
              <option value="">— category —</option>
              {categoryOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <input className="input txn-amount-col" type="text" inputMode="decimal" placeholder="0.00"
              value={line.amount} onChange={e => updateLine(i, { amount: e.target.value })} />
            <button className="txn-edit-act txn-edit-act--cancel" title="Remove line" onClick={() => removeLine(i)}>✗</button>
          </div>
        ))}
        <div className="txn-split-foot">
          <button className="btn btn-ghost txn-split-add" onClick={addLine}>+ add line</button>
          <span className={`txn-split-remaining ${remaining === 0 ? 'split-balanced' : 'split-unbalanced'}`}>
            {remaining === 0 ? 'balanced' : `remaining ${fmtMoney(remaining)}`}
          </span>
        </div>
      </div>
    )}
    </>
  )
}
