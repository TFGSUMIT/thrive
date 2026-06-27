// =============================================================================
// InlineCellEdit.jsx — in-place editor for a single transaction cell
// thrive UI
//
// Click a transaction cell to edit just that field without opening the full row
// form. Two flavors:
//   kind="picker"  — searchable list (Category / Payee). Reuses the .creatable-*
//                    dropdown styles. ✕ clears (commits null). Outside click / Esc
//                    cancels; clicking an option commits its id.
//   kind="date|amount|memo" — a focused <input>. Enter or blur commits the draft,
//                    Esc cancels.
//
// Props:
//   kind        — 'picker' | 'date' | 'amount' | 'memo'
//   value       — current value (id for picker, raw value for inputs)
//   options     — [{ id, label }] (picker only)
//   placeholder — input placeholder
//   onCommit    — (next) => void   (picker: id|null; inputs: string)
//   onCancel    — () => void
// =============================================================================
import { useEffect, useRef, useState } from 'react'

export default function InlineCellEdit({ kind, value, options = [], placeholder, onCommit, onCancel, accounts = [], onTransfer }) {
  const wrapRef  = useRef(null)
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState(value ?? '')
  const [mode,  setMode]  = useState('category')   // 'category' | 'transfer' (account list)

  // focus on mount; select existing text so typing replaces it
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select?.() }, [])

  // picker discards on outside click (text inputs commit on blur instead)
  useEffect(() => {
    if (kind !== 'picker') return
    function handler(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) onCancel() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [kind, onCancel])

  if (kind === 'picker') {
    const q = query.trim().toLowerCase()
    const transferMode = mode === 'transfer'
    const canTransfer  = accounts.length > 0 && typeof onTransfer === 'function'
    const list         = transferMode ? accounts : options
    const filtered     = q ? list.filter(o => o.label.toLowerCase().includes(q)) : list
    const pick         = (o) => transferMode ? onTransfer(o.id) : onCommit(o.id)
    return (
      <div className="creatable-wrap" ref={wrapRef} style={{ width: '100%' }}>
        <div className="creatable-input-row">
          <input
            ref={inputRef}
            className="input"
            type="text"
            placeholder={transferMode ? 'Account…' : placeholder}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') onCancel()
              else if (e.key === 'Enter' && filtered[0]) pick(filtered[0])
            }}
            autoComplete="off"
          />
          {!transferMode && value != null && value !== '' && (
            <button type="button" className="creatable-clear" tabIndex={-1}
              onMouseDown={e => { e.preventDefault(); onCommit(null) }}>✕</button>
          )}
        </div>
        <div className="creatable-dropdown">
          {transferMode ? (
            <div className="creatable-option creatable-option--transfer"
              onMouseDown={e => { e.preventDefault(); setMode('category'); setQuery(''); inputRef.current?.focus() }}>
              ← Categories
            </div>
          ) : (canTransfer && (
            <div className="creatable-option creatable-option--transfer"
              onMouseDown={e => { e.preventDefault(); setMode('transfer'); setQuery(''); inputRef.current?.focus() }}>
              ⇄ Transfer
            </div>
          ))}
          {filtered.slice(0, 40).map(o => (
            <div key={o.id}
              className={`creatable-option ${!transferMode && String(o.id) === String(value) ? 'creatable-option--selected' : ''}`}
              onMouseDown={e => { e.preventDefault(); pick(o) }}>
              {o.label}
            </div>
          ))}
          {filtered.length === 0 && <div className="creatable-empty">{transferMode ? 'No accounts' : 'No matches'}</div>}
        </div>
      </div>
    )
  }

  const type = kind === 'date' ? 'date' : 'text'
  const inputMode = kind === 'amount' ? 'decimal' : undefined
  return (
    <input
      ref={inputRef}
      className="input"
      type={type}
      inputMode={inputMode}
      style={{ width: '100%' }}
      value={draft}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Escape') onCancel()
        else if (e.key === 'Enter') onCommit(draft)
      }}
      onBlur={() => onCommit(draft)}
      autoComplete="off"
    />
  )
}
