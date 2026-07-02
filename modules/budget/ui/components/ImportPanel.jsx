// =============================================================================
// ImportPanel.jsx — CSV and Plaid import flow with column mapper and preview
// thrive UI
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { api } from '@trunk/api'
import { FIELD_META, FIELDS } from '../utils/constants'
import { parseCSV, matchRows, plaidRowsToCsv } from '../utils/csv'

// Import result → human summary. Overlap-safe imports (#13) can absorb rows
// into existing transactions or skip exact re-imports — say so.
function importSummary(res) {
    const bits = [`Imported ${res.inserted} transaction${res.inserted === 1 ? '' : 's'}`]
    if (res.absorbed) bits.push(`${res.absorbed} matched existing`)
    if (res.skipped)  bits.push(`${res.skipped} already imported`)
    return bits.join(' · ')
}

export default function ImportPanel({
    accounts, defaultAccountId, preloadedRows,
    onCancel, onImported, showToast,
}) {
    const isPlaid = !!preloadedRows

    const [importAccountId, setImportAccountId] = useState(defaultAccountId ?? '')
    const [dragging, setDragging] = useState(false)
    const [csv, setCsv] = useState(() => isPlaid ? plaidRowsToCsv(preloadedRows) : null)
    const [rows, setRows] = useState(null)
    const [loadingMatch, setLoadingMatch] = useState(false)
    const [mapping, setMapping] = useState(() => isPlaid ? { date: 'date', payee: 'description', amount: 'amount' } : {})
    const [memoExtra, setMemoExtra] = useState([])
    const [armed, setArmed] = useState(null)
    const dropRef = useRef(null)

    const importPreviewLimit = parseInt(localStorage.getItem('importPreviewLimit') || '20')

    function handleDragOver(e) { e.preventDefault(); setDragging(true) }
    function handleDragLeave(e) { if (!dropRef.current?.contains(e.relatedTarget)) setDragging(false) }

    async function handleDrop(e) {
        e.preventDefault()
        setDragging(false)
        const dropped = e.dataTransfer.files[0]
        if (!dropped) return
        if (!dropped.name.endsWith('.csv')) { showToast('CSV files only', 'error'); return }
        const reader = new FileReader()
        reader.onload = (ev) => {
            const parsed = parseCSV(ev.target.result)
            if (!parsed.rows.length) { showToast('No rows found in CSV', 'error'); return }
            setCsv(parsed)
            setMapping({})
            setMemoExtra([])
            setArmed(null)
            setRows(null)
        }
        reader.readAsText(dropped)
    }

    function handleBubbleClick(field) {
        setArmed(prev => prev === field ? null : field)
    }

    function handleColumnClick(col) {
        if (!armed) return
        if (armed === 'memo') {
            // Toggle this column in the memo list — no limit, can share with other fields.
            // Keep memo armed so the user can keep clicking additional columns.
            setMemoExtra(me => me.includes(col) ? me.filter(c => c !== col) : [...me, col])
            return
        }
        setMapping(prev => {
            const next = { ...prev }
            // Un-assign this column from any other non-memo field
            Object.keys(next).forEach(f => { if (next[f] === col) delete next[f] })
            // Also remove from memo list when claimed by another field
            setMemoExtra(me => me.filter(c => c !== col))
            if (next[armed] === col) { delete next[armed] }
            else { next[armed] = col }
            return next
        })
        setArmed(null)
    }

    function colField(col) { return Object.entries(mapping).find(([, c]) => c === col)?.[0] || null }
    function colIsMemoExtra(col) { return memoExtra.includes(col) }

    // Category is optional for Plaid — no category data comes from Plaid.
    // memo is always optional and lives in memoExtra, not mapping, so exclude it here.
    const requiredMapped = FIELDS
        .filter(f => FIELD_META[f].required && f !== 'memo' && !(isPlaid && f === 'category'))
        .every(f => mapping[f])

    async function runMatch(currentCsv, currentMapping) {
        if (!importAccountId) return
        setLoadingMatch(true)
        try {
            const existing = await api.get(`/transactions/?account_id=${importAccountId}&limit=500`)
            if (!currentCsv?.rows) return
            setRows(matchRows(currentCsv.rows, existing, currentMapping))
        } catch (err) {
            showToast('Failed to fetch existing transactions: ' + err.message, 'error')
        } finally {
            setLoadingMatch(false)
        }
    }

    useEffect(() => {
        if (requiredMapped && csv && importAccountId) runMatch(csv, mapping)
    }, [mapping, importAccountId, csv])

    const matchCount = rows ? rows.filter(r => r.matched).length : 0
    const newCount = rows ? rows.filter(r => !r.matched).length : 0

    async function handleImport() {
        if (!rows || !importAccountId) return

        // Build memo string from all selected memo columns (joined with " | ")
        const buildMemo = (row) => {
            const parts = memoExtra.map(col => row[col]).filter(Boolean)
            return parts.length ? parts.join(' | ') : null
        }

        if (isPlaid) {
            const payload = rows.map(row => ({
                account_id: parseInt(importAccountId),
                date: row[mapping.date] || '',
                amount: parseFloat(row[mapping.amount] || '0'),
                description: mapping.payee ? (row[mapping.payee] || null) : null,
                plaid_id: row.plaid_id || null,
                matched_transaction_id: row._matchedId || null,
                memo: buildMemo(row),
            }))
            try {
                const res = await api.post('/plaid/import', payload)
                showToast(importSummary(res), 'success')
                onImported?.()
            } catch (e) {
                showToast(e.message, 'error')
            }
        } else {
            const payload = rows.map(row => ({
                account_id: parseInt(importAccountId),
                date: row[mapping.date] || '',
                amount: parseFloat(row[mapping.amount] || '0'),
                memo: buildMemo(row),
                matched_transaction_id: row._matchedId || null,
                import_description: mapping.payee ? (row[mapping.payee] || null) : null,
                import_category: mapping.category ? (row[mapping.category] || null) : null,
            }))
            try {
                const res = await api.post('/transactions/import', payload)
                showToast(importSummary(res), 'success')
                onImported?.()
            } catch (e) {
                showToast(e.message, 'error')
            }
        }
    }

    return (
        <div className="sched-form">
            <div className="form-row">
                <label>Account</label>
                <select className="input" value={importAccountId} onChange={e => { setImportAccountId(e.target.value); setRows(null) }}>
                    <option value="">— select account —</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
            </div>

            {isPlaid && csv && (
                <div className="import-plaid-badge">
                    ↻ Plaid sync — {preloadedRows.length} transactions fetched
                </div>
            )}

            {importAccountId && !csv && (
                <div
                    ref={dropRef}
                    className={`import-drop-zone ${dragging ? 'import-drop-zone--active' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    Drop CSV here
                </div>
            )}

            {csv && (
                <>
                    <div className="import-bubbles">
                        {FIELDS.map(f => {
                            const meta = FIELD_META[f]
                            const mapped = f === 'memo' ? memoExtra.length > 0 : mapping[f]
                            const isArmed = armed === f
                            const isOptionalForPlaid = isPlaid && f === 'category'
                            return (
                                <button
                                    key={f}
                                    className={`import-bubble ${isArmed ? 'import-bubble--armed' : ''} ${mapped ? 'import-bubble--mapped' : ''}`}
                                    style={{ '--bubble-color': meta.color }}
                                    onClick={() => handleBubbleClick(f)}
                                    title={isOptionalForPlaid ? 'Optional for Plaid' : meta.required ? 'Required' : 'Optional'}
                                >
                                    {meta.label}
                                    {isOptionalForPlaid && !mapped && <span className="import-bubble-optional"> opt</span>}
                                    {f !== 'memo' && mapped && <span className="import-bubble-col"> → {mapped}</span>}
                                    {f === 'memo' && memoExtra.length > 0 && (
                                        <span className="import-bubble-col" title={memoExtra.join(', ')}>
                                            → {memoExtra.length} col{memoExtra.length > 1 ? 's' : ''}
                                        </span>
                                    )}
                                </button>
                            )
                        })}
                        {armed && (
                            <span className="import-armed-hint muted">
                                Click a column header to map to <strong>{FIELD_META[armed].label}</strong>
                            </span>
                        )}
                    </div>

                    <div className="import-preview">
                        {loadingMatch && <div className="muted" style={{ padding: '8px 12px' }}>Matching…</div>}
                        {rows && (
                            <div className="import-preview-header">
                                <span>
                                    {rows.length} rows ·{' '}
                                    <span className="import-tag import-tag--new">{newCount} new</span>{' '}
                                    <span className="import-tag import-tag--matched">{matchCount} matched</span>
                                </span>
                                <button className="btn btn-ghost" onClick={() => {
                                    if (!isPlaid) { setCsv(null); setRows(null); setMapping({}); setMemoExtra([]) }
                                    else { setRows(null) }
                                }}>✕ Clear</button>
                            </div>
                        )}
                        <div className="import-table" style={{ maxHeight: `${importPreviewLimit * 36}px` }}>
                            <div className="import-csv-header">
                                {rows && <span></span>}
                                {csv.headers.map(col => {
                                    const field = colField(col)
                                    const isMExtra = colIsMemoExtra(col)
                                    const color = field ? FIELD_META[field].color : isMExtra ? FIELD_META.memo.color : null
                                    return (
                                        <button
                                            key={col}
                                            className={`import-col-header ${armed ? 'import-col-header--clickable' : ''}`}
                                            style={color ? { color, borderColor: color } : {}}
                                            onClick={() => handleColumnClick(col)}
                                        >
                                            {col}
                                            {field && <span className="import-col-tag" style={{ background: color }}>{FIELD_META[field].label}</span>}
                                            {isMExtra && !field && <span className="import-col-tag" style={{ background: FIELD_META.memo.color }}>Memo+</span>}
                                        </button>
                                    )
                                })}
                            </div>
                            {(rows || csv.rows).slice(0, importPreviewLimit).map((row, i) => (
                                <div key={i} className={`import-csv-row ${row.matched ? 'import-row--matched' : ''}`}>
                                    {rows && (
                                        <span className={`import-status ${row.matched ? 'import-status--matched' : 'import-status--new'}`}>
                                            {row.matched ? '=' : '+'}
                                        </span>
                                    )}
                                    {csv.headers.map(col => {
                                        const field = colField(col)
                                        const isMExtra = colIsMemoExtra(col)
                                        const color = field ? FIELD_META[field].color : isMExtra ? FIELD_META.memo.color : null
                                        return (
                                            <span key={col} className="import-csv-cell" style={color ? { color } : {}}>
                                                {row[col]}
                                            </span>
                                        )
                                    })}
                                </div>
                            ))}
                        </div>
                        {(rows || csv.rows).length > importPreviewLimit && (
                            <div className="muted" style={{ padding: '6px 12px', fontSize: '12px' }}>
                                Showing {importPreviewLimit} of {(rows || csv.rows).length} rows
                            </div>
                        )}
                    </div>
                </>
            )}

            <div className="form-actions">
                {rows && requiredMapped && importAccountId && (
                    <button className="btn btn-primary" disabled={rows.length === 0} onClick={handleImport}>
                        Import {rows.length} ({newCount} new · {matchCount} matched)
                    </button>
                )}
                {!requiredMapped && csv && (
                    <span className="muted" style={{ fontSize: '12px' }}>Map all required fields to enable import</span>
                )}
                <button className="btn" onClick={onCancel}>Cancel</button>
            </div>
        </div>
    )
}