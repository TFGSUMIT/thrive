// =============================================================================
// CreatableSelect.jsx — Inline-creatable payee and category selectors
// thrive UI
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { api } from '@trunk/api'

// ---------------------------------------------------------------------------
// CreatablePayeeSelect
// Props:
//   payees       — array of {id, name}
//   value        — selected payee_id (string or number) or ''
//   onChange     — (id) => void
//   onCreated    — (newPayee) => void  — called after creation so parent can refresh list
//   showToast    — from useToast
// ---------------------------------------------------------------------------
export function CreatablePayeeSelect({ payees, value, onChange, onCreated, showToast }) {
    const [query, setQuery] = useState('')
    const [open, setOpen] = useState(false)
    const [creating, setCreating] = useState(false)
    const inputRef = useRef(null)
    const boxRef = useRef(null)

    // Sync display name when value changes externally
    useEffect(() => {
        if (value) {
            const p = payees.find(p => String(p.id) === String(value))
            if (p) setQuery(p.name)
        } else {
            setQuery('')
        }
    }, [value, payees])

    // Close on outside click
    useEffect(() => {
        function handler(e) {
            if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

    const filtered = query.trim()
        ? payees.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
        : payees

    const exactMatch = payees.some(p => p.name.toLowerCase() === query.trim().toLowerCase())
    const showCreate = query.trim() && !exactMatch

    function selectPayee(p) {
        setQuery(p.name)
        onChange(p.id)
        setOpen(false)
    }

    function clear() {
        setQuery('')
        onChange('')
        setOpen(true)
        inputRef.current?.focus()
    }

    async function handleCreate() {
        const name = query.trim()
        if (!name) return
        setCreating(true)
        try {
            const res = await api.post('/payees/', { name })
            onCreated?.(res)
            selectPayee(res)
            showToast(`Created payee '${name}'`, 'success')
        } catch (e) {
            showToast(e.message, 'error')
        } finally {
            setCreating(false)
        }
    }

    return (
        <div className="creatable-wrap" ref={boxRef}>
            <div className="creatable-input-row">
                <input
                    ref={inputRef}
                    className="input"
                    type="text"
                    placeholder="Search or create payee…"
                    value={query}
                    onChange={e => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange('') }}
                    onFocus={() => setOpen(true)}
                    autoComplete="off"
                />
                {value && (
                    <button type="button" className="creatable-clear" onClick={clear} tabIndex={-1}>✕</button>
                )}
            </div>
            {open && (
                <div className="creatable-dropdown">
                    {filtered.slice(0, 20).map(p => (
                        <div
                            key={p.id}
                            className={`creatable-option ${String(p.id) === String(value) ? 'creatable-option--selected' : ''}`}
                            onMouseDown={() => selectPayee(p)}
                        >
                            {p.name}
                        </div>
                    ))}
                    {filtered.length === 0 && !showCreate && (
                        <div className="creatable-empty">No payees found</div>
                    )}
                    {showCreate && (
                        <div
                            className="creatable-option creatable-option--create"
                            onMouseDown={handleCreate}
                        >
                            {creating ? 'Creating…' : `+ Create "${query.trim()}"`}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// CreatableCategorySelect
// Props:
//   categories   — array of {id, name, parent_id}
//   value        — selected category_id (string or number) or ''
//   onChange     — (id) => void
//   onCreated    — (newCategory) => void
//   showToast
// ---------------------------------------------------------------------------
export function CreatableCategorySelect({ categories, value, onChange, onCreated, showToast,
    accounts, currentAccountId, isTransfer, transferAccountId, onEnterTransfer, onExitTransfer, onTransferChange }) {
    const mainCategories = categories.filter(c => c.parent_id === null)
    const subCategories = categories.filter(c => c.parent_id !== null)

    // Derive initial main/sub from value
    function deriveMain(val) {
        if (!val) return ''
        const cat = categories.find(c => String(c.id) === String(val))
        if (!cat) return ''
        return cat.parent_id ? String(cat.parent_id) : String(cat.id)
    }
    function deriveSub(val) {
        if (!val) return ''
        const cat = categories.find(c => String(c.id) === String(val))
        if (!cat || !cat.parent_id) return ''
        return String(cat.id)
    }

    const [mainId, setMainId] = useState(() => deriveMain(value))
    const [subId, setSubId] = useState(() => deriveSub(value))
    const [mainQuery, setMainQuery] = useState('')
    const [subQuery, setSubQuery] = useState('')
    const [mainOpen, setMainOpen] = useState(false)
    const [subOpen, setSubOpen] = useState(false)
    const [creatingMain, setCreatingMain] = useState(false)
    const [creatingSub, setCreatingSub] = useState(false)
    const mainRef = useRef(null)
    const subRef = useRef(null)

    // ── transfer-account picker — active only when the parent passes `accounts`.
    // YNAB-style: "Transfer" is a pinned option in the category list; choosing it
    // turns this field into an account picker (no separate button). ──
    const transferEnabled = Array.isArray(accounts)
    const [acctQuery, setAcctQuery] = useState('')
    const [acctOpen, setAcctOpen] = useState(false)
    const acctRef = useRef(null)
    const transferAccounts = transferEnabled
        ? accounts.filter(a => String(a.id) !== String(currentAccountId))
        : []

    // Sync when value changes externally
    useEffect(() => {
        setMainId(deriveMain(value))
        setSubId(deriveSub(value))
    }, [value, categories])

    // Sync query labels
    useEffect(() => {
        if (mainId) {
            const cat = mainCategories.find(c => String(c.id) === mainId)
            if (cat) setMainQuery(cat.name)
        } else {
            setMainQuery('')
        }
    }, [mainId, categories])

    useEffect(() => {
        if (subId) {
            const cat = subCategories.find(c => String(c.id) === subId)
            if (cat) setSubQuery(cat.name)
        } else {
            setSubQuery('')
        }
    }, [subId, categories])

    // Close on outside click
    useEffect(() => {
        function handler(e) {
            if (mainRef.current && !mainRef.current.contains(e.target)) setMainOpen(false)
            if (subRef.current && !subRef.current.contains(e.target)) setSubOpen(false)
            if (acctRef.current && !acctRef.current.contains(e.target)) setAcctOpen(false)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

    // drop the account list open the moment transfer mode is entered (YNAB-style)
    useEffect(() => { if (isTransfer) setAcctOpen(true) }, [isTransfer])
    // sync the account label from the selected transfer account
    useEffect(() => {
        if (transferAccountId) {
            const a = (accounts || []).find(a => String(a.id) === String(transferAccountId))
            setAcctQuery(a ? a.name + (a.number ? ` (${a.number})` : '') : '')
        } else setAcctQuery('')
    }, [transferAccountId, accounts])

    const filteredMain = mainQuery.trim()
        ? mainCategories.filter(c => c.name.toLowerCase().includes(mainQuery.toLowerCase()))
        : mainCategories

    const filteredSubs = (() => {
        const subs = subCategories.filter(c => c.parent_id === parseInt(mainId))
        return subQuery.trim()
            ? subs.filter(c => c.name.toLowerCase().includes(subQuery.toLowerCase()))
            : subs
    })()

    const exactMainMatch = mainCategories.some(c => c.name.toLowerCase() === mainQuery.trim().toLowerCase())
    const exactSubMatch = filteredSubs.some(c => c.name.toLowerCase() === subQuery.trim().toLowerCase())
    const showCreateMain = mainQuery.trim() && !exactMainMatch
    const showCreateSub = mainId && subQuery.trim() && !exactSubMatch

    // pinned "⇄ Transfer" stays visible unless the search clearly isn't "transfer"
    const showTransferOption = transferEnabled && (!mainQuery.trim() || 'transfer'.includes(mainQuery.trim().toLowerCase()))
    const filteredAccts = acctQuery.trim()
        ? transferAccounts.filter(a => `${a.name} ${a.number || ''}`.toLowerCase().includes(acctQuery.toLowerCase()))
        : transferAccounts
    function selectAccount(a) {
        onTransferChange?.(a.id)
        setAcctQuery(a.name + (a.number ? ` (${a.number})` : ''))
        setAcctOpen(false)
    }

    function selectMain(cat) {
        setMainId(String(cat.id))
        setMainQuery(cat.name)
        setMainOpen(false)
        setSubId('')
        setSubQuery('')
        // If no subs, this is the final value
        const hasSubs = subCategories.some(c => c.parent_id === cat.id)
        if (!hasSubs) onChange(cat.id)
        else onChange('')
    }

    function selectSub(cat) {
        setSubId(String(cat.id))
        setSubQuery(cat.name)
        setSubOpen(false)
        onChange(cat.id)
    }

    async function handleCreateMain() {
        const name = mainQuery.trim()
        if (!name) return
        setCreatingMain(true)
        try {
            const res = await api.post('/categories/', { name, parent_id: null })
            onCreated?.(res)
            selectMain(res)
            showToast(`Created category '${name}'`, 'success')
        } catch (e) {
            showToast(e.message, 'error')
        } finally {
            setCreatingMain(false)
        }
    }

    async function handleCreateSub() {
        const name = subQuery.trim()
        if (!name || !mainId) return
        setCreatingSub(true)
        try {
            const res = await api.post('/categories/', { name, parent_id: parseInt(mainId) })
            onCreated?.(res)
            selectSub(res)
            showToast(`Created subcategory '${name}'`, 'success')
        } catch (e) {
            showToast(e.message, 'error')
        } finally {
            setCreatingSub(false)
        }
    }

    const hasSubs = mainId && subCategories.some(c => c.parent_id === parseInt(mainId))

    // Transfer mode: this field IS an account picker (auto-opened on entry).
    if (isTransfer) {
        return (
            <div className="creatable-category-wrap">
                <div className="creatable-wrap" ref={acctRef}>
                    <div className="creatable-input-row">
                        <input
                            className="input"
                            type="text"
                            autoFocus
                            autoComplete="off"
                            placeholder="⇄ Transfer to / from account…"
                            value={acctQuery}
                            onChange={e => { setAcctQuery(e.target.value); setAcctOpen(true) }}
                            onFocus={() => setAcctOpen(true)}
                        />
                        <button type="button" className="creatable-clear" onClick={() => onExitTransfer?.()} tabIndex={-1}>✕</button>
                    </div>
                    {acctOpen && (
                        <div className="creatable-dropdown">
                            {filteredAccts.slice(0, 30).map(a => (
                                <div
                                    key={a.id}
                                    className={`creatable-option ${String(a.id) === String(transferAccountId) ? 'creatable-option--selected' : ''}`}
                                    onMouseDown={() => selectAccount(a)}
                                >
                                    {a.name}{a.number ? ` (${a.number})` : ''}
                                </div>
                            ))}
                            {filteredAccts.length === 0 && <div className="creatable-empty">No other accounts</div>}
                        </div>
                    )}
                </div>
            </div>
        )
    }

    return (
        <div className="creatable-category-wrap">
            {/* Main category */}
            <div className="creatable-wrap" ref={mainRef}>
                <div className="creatable-input-row">
                    <input
                        className="input"
                        type="text"
                        placeholder="Category…"
                        value={mainQuery}
                        onChange={e => { setMainQuery(e.target.value); setMainOpen(true); if (!e.target.value) { setMainId(''); setSubId(''); onChange('') } }}
                        onFocus={() => setMainOpen(true)}
                        autoComplete="off"
                    />
                    {mainId && (
                        <button type="button" className="creatable-clear" onClick={() => { setMainId(''); setMainQuery(''); setSubId(''); setSubQuery(''); onChange('') }} tabIndex={-1}>✕</button>
                    )}
                </div>
                {mainOpen && (
                    <div className="creatable-dropdown">
                        {showTransferOption && (
                            <div className="creatable-option creatable-option--transfer" onMouseDown={() => onEnterTransfer?.()}>
                                ⇄ Transfer
                            </div>
                        )}
                        {filteredMain.slice(0, 20).map(c => (
                            <div
                                key={c.id}
                                className={`creatable-option ${String(c.id) === mainId ? 'creatable-option--selected' : ''}`}
                                onMouseDown={() => selectMain(c)}
                            >
                                {c.name}
                            </div>
                        ))}
                        {filteredMain.length === 0 && !showCreateMain && (
                            <div className="creatable-empty">No categories found</div>
                        )}
                        {showCreateMain && (
                            <div className="creatable-option creatable-option--create" onMouseDown={handleCreateMain}>
                                {creatingMain ? 'Creating…' : `+ Create "${mainQuery.trim()}"`}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Sub category — only shown when main is selected and has/can have subs */}
            {mainId && (
                <div className="creatable-wrap" ref={subRef}>
                    <div className="creatable-input-row">
                        <input
                            className="input"
                            type="text"
                            placeholder="Subcategory…"
                            value={subQuery}
                            onChange={e => { setSubQuery(e.target.value); setSubOpen(true); if (!e.target.value) { setSubId(''); if (!hasSubs) onChange(parseInt(mainId)) } }}
                            onFocus={() => setSubOpen(true)}
                            autoComplete="off"
                        />
                        {subId && (
                            <button type="button" className="creatable-clear" onClick={() => { setSubId(''); setSubQuery(''); onChange(parseInt(mainId)) }} tabIndex={-1}>✕</button>
                        )}
                    </div>
                    {subOpen && (
                        <div className="creatable-dropdown">
                            {filteredSubs.slice(0, 20).map(c => (
                                <div
                                    key={c.id}
                                    className={`creatable-option ${String(c.id) === subId ? 'creatable-option--selected' : ''}`}
                                    onMouseDown={() => selectSub(c)}
                                >
                                    {c.name}
                                </div>
                            ))}
                            {filteredSubs.length === 0 && !showCreateSub && (
                                <div className="creatable-empty">No subcategories — type to create</div>
                            )}
                            {showCreateSub && (
                                <div className="creatable-option creatable-option--create" onMouseDown={handleCreateSub}>
                                    {creatingSub ? 'Creating…' : `+ Create "${subQuery.trim()}"`}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}