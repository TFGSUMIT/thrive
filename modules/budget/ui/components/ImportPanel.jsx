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

const fmtAmt = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Number(n)).toFixed(2)}`

// Columns for a PDF group's preview table — mirrors the CSV/Plaid import table
// (same field colours) so the two views read the same. PDF rows are already
// structured, so these are fixed (no column-mapping bubbles needed).
const PDF_COLS = [
    { key: 'date', meta: FIELD_META.date, cell: r => r.date },
    { key: 'description', meta: FIELD_META.payee, cell: r => r.description },
    { key: 'amount', meta: FIELD_META.amount, cell: r => fmtAmt(r.amount), align: 'right' },
]

// PDF statement parsing (#84): the backend extracts the PDF's text layer
// (/statements/text), then each page goes to the LOCAL model via the lmstudio
// module's generic /extract with this budget-domain prompt. Cross-module tie
// lives here in the frontend per convention (like MPG → /lmstudio/vision), so
// neither backend knows about the other.
const STATEMENT_PROMPT = `You are parsing one page of a bank statement. Extract EVERY transaction row visible in the text into a JSON array. Each element: {"account":"...","date":"YYYY-MM-DD","description":"...","amount":-12.34}
Rules:
- account: the account this transaction belongs to. A combined statement lists MULTIPLE accounts under section headers (e.g. "Joint Checking", "Savings", "Account ending 0887"). Set account to that section's label INCLUDING its account number or last-4 digits exactly as printed (e.g. "Joint Checking 0887"). If this page is a continuation with no account header visible, set account to null.
- amount: negative for money OUT (withdrawals, purchases, payments, transfers out, fees), positive for money IN (deposits, credits, interest, refunds).
- Use the transaction/posted date. If the year is missing, infer it from the statement period shown on the page.
- description: the merchant/payee text as printed, cleaned of extra whitespace.
- Skip running-balance columns, daily balance summaries, section headers, subtotals/totals, and anything that is not an individual transaction.
- If the page has no transactions, return [].
Return ONLY the JSON array, no other text.`

// Auto-map a detected statement account ("Joint Checking 0887") to a thrive
// budget account. Last-4 digits are the disambiguator (there are several
// "Checking"/"Savings" accounts), with a name-token fallback.
function suggestAccountId(label, accounts) {
    if (!label) return ''
    const digits = (String(label).match(/\d{4,}/g) || []).map(d => d.slice(-4))
    for (const a of accounts) {
        if (a.number && digits.includes(String(a.number).slice(-4))) return String(a.id)
    }
    // name-token fallback: every significant word of an account name appears in the label
    const lab = String(label).toLowerCase()
    for (const a of accounts) {
        const toks = String(a.name).toLowerCase().split(/\s+/).filter(t => t.length > 2)
        if (toks.length && toks.every(t => lab.includes(t))) return String(a.id)
    }
    return ''
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
    const [pdfBusy, setPdfBusy] = useState(null)   // progress line while parsing a statement
    const [pdfInfo, setPdfInfo] = useState(null)   // { name, pages, count, skipped } once parsed
    const [pdfGroups, setPdfGroups] = useState(null)  // [{label, rows, accountId, matchedRows}]
    const [pdfImporting, setPdfImporting] = useState(false)
    const dropRef = useRef(null)

    const importPreviewLimit = parseInt(localStorage.getItem('importPreviewLimit') || '20')

    function handleDragOver(e) { e.preventDefault(); setDragging(true) }
    function handleDragLeave(e) { if (!dropRef.current?.contains(e.relatedTarget)) setDragging(false) }

    async function handleDrop(e) {
        e.preventDefault()
        setDragging(false)
        const dropped = e.dataTransfer.files[0]
        if (!dropped || pdfBusy) return
        const name = dropped.name.toLowerCase()
        if (name.endsWith('.pdf')) { handlePdf(dropped); return }
        if (!name.endsWith('.csv')) { showToast('Drop a CSV or PDF statement', 'error'); return }
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

    // PDF statement → text pages (backend) → rows via the local model (#84).
    // A combined statement holds MULTIPLE accounts, so each row carries a
    // detected `account`; we forward-fill it across continuation pages, group by
    // it, auto-map each group to a thrive account, and let the user confirm —
    // then each group commits via the dedup-safe /transactions/import (#13).
    async function handlePdf(file) {
        setPdfBusy('Reading PDF…')
        setPdfInfo(null); setPdfGroups(null); setCsv(null); setRows(null)
        try {
            const fd = new FormData()
            fd.append('file', file)
            // raw fetch: api.js is JSON-only; the browser sets the multipart boundary
            const up = await fetch('/api/statements/text', { method: 'POST', credentials: 'include', body: fd })
            if (!up.ok) {
                let detail = `Upload failed (${up.status})`
                try { detail = (await up.json()).detail || detail } catch {}
                throw new Error(detail)
            }
            const doc = await up.json()
            const pages = doc.pages.filter(p => p.has_text)
            const skipped = doc.pages.length - pages.length
            if (!pages.length) throw new Error('No text layer in this PDF (scanned image?) — not supported yet')

            const all = []   // ordered {account, date, description, amount}
            for (let i = 0; i < pages.length; i++) {
                setPdfBusy(`AI parsing page ${i + 1}/${pages.length}…`)
                let out
                try {
                    out = await api.post('/lmstudio/extract', { text: pages[i].text, prompt: STATEMENT_PROMPT })
                } catch (err) {
                    if (err.message === 'Not Found')
                        throw new Error('PDF import needs the LM Studio module (Settings → Modules)')
                    throw new Error(`Page ${i + 1}: ${err.message}`)
                }
                const parsed = Array.isArray(out.result) ? out.result
                    : (Array.isArray(out.result?.transactions) ? out.result.transactions : [])
                for (const r of parsed) {
                    const amt = typeof r.amount === 'number' ? r.amount : parseFloat(r.amount)
                    if (!r.date || !isFinite(amt)) continue
                    all.push({
                        account: r.account ? String(r.account).trim() : '',
                        date: String(r.date), description: String(r.description || '').trim(), amount: amt,
                    })
                }
            }
            if (!all.length) throw new Error('The model found no transactions in this statement')

            // Forward-fill account across continuation pages (rows are in doc order).
            let last = ''
            for (const r of all) { if (r.account) last = r.account; else r.account = last }

            // Group by detected account, preserving first-seen order.
            const order = []
            const byAcct = new Map()
            for (const r of all) {
                const key = r.account || 'Unknown account'
                if (!byAcct.has(key)) { byAcct.set(key, []); order.push(key) }
                byAcct.get(key).push({ date: r.date, description: r.description, amount: r.amount })
            }
            const groups = order.map(label => ({
                label, rows: byAcct.get(label),
                accountId: suggestAccountId(label, accounts),
                matchedRows: null,
            }))

            setPdfGroups(groups)
            setPdfInfo({ name: file.name, pages: pages.length, count: all.length, accounts: groups.length, skipped })
            // match any auto-mapped groups up front
            groups.forEach((g, i) => { if (g.accountId) matchGroup(i, g.accountId) })
        } catch (err) {
            showToast(err.message, 'error')
        } finally {
            setPdfBusy(null)
        }
    }

    // (Re)match a PDF group's rows against existing transactions on the chosen
    // account, so the preview shows new-vs-already-there (reuses CSV matchRows).
    async function matchGroup(idx, accountId) {
        // clear stale match state immediately on (re)assignment
        setPdfGroups(gs => gs.map((g, i) => i === idx ? { ...g, accountId, matchedRows: null } : g))
        if (!accountId) return
        try {
            const existing = await api.get(`/transactions/?account_id=${accountId}&limit=500`)
            const list = Array.isArray(existing) ? existing : []
            setPdfGroups(gs => gs.map((g, i) => (i === idx && g.accountId === accountId)
                ? { ...g, matchedRows: matchRows(g.rows, list, { date: 'date', amount: 'amount' }) } : g))
        } catch (e) {
            showToast('Match failed: ' + e.message, 'error')
        }
    }

    async function importPdf() {
        const mapped = pdfGroups.filter(g => g.accountId)
        if (!mapped.length) return
        setPdfImporting(true)
        const agg = { inserted: 0, absorbed: 0, skipped: 0 }
        try {
            for (const g of mapped) {
                const src = g.matchedRows || g.rows
                const payload = src.map(r => ({
                    account_id: parseInt(g.accountId),
                    date: r.date,
                    amount: r.amount,
                    import_description: r.description || null,
                    matched_transaction_id: r._matchedId || null,
                }))
                const res = await api.post('/transactions/import', payload)
                agg.inserted += res.inserted || 0
                agg.absorbed += res.absorbed || 0
                agg.skipped  += res.skipped  || 0
            }
            showToast(importSummary(agg), 'success')
            onImported?.()
        } catch (e) {
            showToast(e.message, 'error')
        } finally {
            setPdfImporting(false)
        }
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
            {/* single-account selector — for CSV/Plaid. A PDF statement carries
                its own per-account sections, so it's hidden in that mode. */}
            {!pdfGroups && (
                <div className="form-row">
                    <label>Account</label>
                    <select className="input" value={importAccountId} onChange={e => { setImportAccountId(e.target.value); setRows(null) }}>
                        <option value="">— select account —</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                </div>
            )}

            {isPlaid && csv && (
                <div className="import-plaid-badge">
                    ↻ Plaid sync — {preloadedRows.length} transactions fetched
                </div>
            )}

            {!csv && !pdfGroups && !isPlaid && (
                <div
                    ref={dropRef}
                    className={`import-drop-zone ${dragging ? 'import-drop-zone--active' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    {pdfBusy || 'Drop a CSV, or a PDF statement to read with local AI'}
                </div>
            )}

            {/* PDF statement → one section per detected account, each mapped to a
                thrive account (auto-matched on last-4) and previewed. */}
            {pdfGroups && (
                <>
                    <div className="import-plaid-badge">
                        📄 {pdfInfo.name} — {pdfInfo.count} transactions · {pdfGroups.length} account{pdfGroups.length === 1 ? '' : 's'} detected
                        {pdfInfo.skipped > 0 && ` · ${pdfInfo.skipped} page${pdfInfo.skipped === 1 ? '' : 's'} had no text`}
                        <button className="btn btn-ghost" style={{ marginLeft: 'auto' }}
                            onClick={() => { setPdfGroups(null); setPdfInfo(null) }}>✕ Clear</button>
                    </div>
                    {pdfGroups.map((g, idx) => {
                        const src = g.matchedRows || g.rows
                        const nNew = g.matchedRows ? g.matchedRows.filter(r => !r.matched).length : null
                        const nMat = g.matchedRows ? g.matchedRows.filter(r => r.matched).length : null
                        return (
                            <div key={g.label} style={{ border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 8, marginTop: 10, overflow: 'hidden' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', background: 'var(--bg-tertiary,#1e1e1e)' }}>
                                    <span style={{ fontWeight: 600, fontSize: 13 }}>{g.label}</span>
                                    <span className="muted" style={{ fontSize: 11 }}>{g.rows.length} txn{g.rows.length === 1 ? '' : 's'}</span>
                                    <span className="muted">→</span>
                                    <select className="input" style={{ width: 'auto' }} value={g.accountId}
                                        onChange={e => matchGroup(idx, e.target.value)}>
                                        <option value="">— skip this account —</option>
                                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.number ? ` ·${String(a.number).slice(-4)}` : ''}</option>)}
                                    </select>
                                    {g.matchedRows && (
                                        <span style={{ fontSize: 11 }}>
                                            <span className="import-tag import-tag--new">{nNew} new</span>{' '}
                                            <span className="import-tag import-tag--matched">{nMat} matched</span>
                                        </span>
                                    )}
                                </div>
                                {g.accountId && (
                                    <>
                                        <div className="import-table" style={{ maxHeight: `${importPreviewLimit * 34}px` }}>
                                            <div className="import-csv-header">
                                                <span className="import-status"></span>
                                                {PDF_COLS.map(c => (
                                                    <span key={c.key} className="import-col-header" style={{ color: c.meta.color }}>
                                                        {c.key}
                                                        <span className="import-col-tag" style={{ background: c.meta.color }}>{c.meta.label}</span>
                                                    </span>
                                                ))}
                                            </div>
                                            {src.slice(0, importPreviewLimit).map((r, i) => (
                                                <div key={i} className={`import-csv-row ${r.matched ? 'import-row--matched' : ''}`}>
                                                    <span className={`import-status ${r.matched ? 'import-status--matched' : 'import-status--new'}`}>{r.matched ? '=' : '+'}</span>
                                                    {PDF_COLS.map(c => (
                                                        <span key={c.key} className="import-csv-cell" style={{ color: c.meta.color, textAlign: c.align || 'left' }}>{c.cell(r)}</span>
                                                    ))}
                                                </div>
                                            ))}
                                        </div>
                                        {src.length > importPreviewLimit && (
                                            <div className="muted" style={{ padding: '6px 12px', fontSize: 12 }}>
                                                Showing {importPreviewLimit} of {src.length} rows
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )
                    })}
                </>
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
                {pdfGroups && (() => {
                    const mapped = pdfGroups.filter(g => g.accountId)
                    const total = mapped.reduce((n, g) => n + g.rows.length, 0)
                    return (
                        <button className="btn btn-primary" disabled={pdfImporting || !mapped.length} onClick={importPdf}>
                            {pdfImporting ? 'Importing…' : `Import ${total} into ${mapped.length} account${mapped.length === 1 ? '' : 's'}`}
                        </button>
                    )
                })()}
                <button className="btn" onClick={onCancel}>Cancel</button>
            </div>
        </div>
    )
}