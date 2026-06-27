// =============================================================================
// AccountsPage.jsx — Account list with inline Plaid sync per account
// thrive UI
// =============================================================================

import { useEffect, useState } from 'react'
import { api } from '@trunk/api'
import { useToast } from '@trunk/context/ToastContext'
import { useConfirm } from '@trunk/context/ConfirmModal'
import { useAuth } from '@trunk/context/AuthContext'
import { useVault } from '@trunk/context/VaultContext'
import { decryptEncString, loadVaultSymKey } from '@trunk/utils/vault'
import ScopeToggle from '@trunk/components/ScopeToggle'
import './Page.css'

const fmtMoney = (n) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const SYNC_OPTIONS = [
    { label: 'Last 7 days', days: 7, start_date: null },
    { label: 'Last 14 days', days: 14, start_date: null },
    { label: 'Last 30 days', days: 30, start_date: null },
    { label: 'Last 60 days', days: 60, start_date: null },
    { label: 'Last 90 days', days: 90, start_date: null },
    { label: 'Year to date', days: null, start_date: `${new Date().getFullYear()}-01-01` },
]

export default function AccountsPage({ onNav, vaultToken }) {
    const { showToast } = useToast()
    const { confirm } = useConfirm()
    const { user } = useAuth()
    const { vaultFetch } = useVault()   // clears the token on 401 → no stale "Connected"

    const [accounts, setAccounts] = useState([])
    const [loading, setLoading] = useState(true)
    const [scope, setScope] = useState('all')   // all | household | mine (personal-data platform)
    const [sortBy, setSortBy] = useState('default')
    const [expandedId, setExpandedId] = useState(null)
    const [dragId, setDragId] = useState(null)
    const [overId, setOverId] = useState(null)
    const [plaidAcctIds, setPlaidAcctIds] = useState(new Set())
    const [syncingId, setSyncingId] = useState(null)
    const [syncOption, setSyncOption] = useState(SYNC_OPTIONS[2])

    // vault ciphers
    const [ciphers, setCiphers] = useState([])
    const [ciphersLoading, setCiphersLoading] = useState(false)
    const [linkingId, setLinkingId] = useState(null)

    // add form
    const [newName, setNewName] = useState('')
    const [newInstitution, setNewInstitution] = useState('')
    const [newNumber, setNewNumber] = useState('')
    const [newOnBudget, setNewOnBudget] = useState(true)
    const [newPersonal, setNewPersonal] = useState(false)

    // edit
    const [editingId, setEditingId] = useState(null)
    const [editName, setEditName] = useState('')
    const [editInst, setEditInst] = useState('')
    const [editNumber, setEditNumber] = useState('')
    const [editOnBudget, setEditOnBudget] = useState(true)
    const [editPersonal, setEditPersonal] = useState(false)

    async function load() {
        setLoading(true)
        try {
            const [acctData, connData] = await Promise.all([
                api.get(`/budget/accounts/?scope=${scope}`),
                api.get('/plaid/connections'),
            ])
            setAccounts(acctData)
            setPlaidAcctIds(new Set(connData.map(c => c.account_id)))
            window.dispatchEvent(new Event('thrive:accounts-changed'))
        } catch (e) {
            showToast(e.message, 'error')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { load() }, [scope])   // eslint-disable-line react-hooks/exhaustive-deps

    // Fetch Vaultwarden ciphers and decrypt their names client-side.
    // Cipher names are E2E encrypted; we decrypt using the user's symmetric key
    // stored in localStorage by Settings on connect.
    useEffect(() => {
        if (!vaultToken) { setCiphers([]); return }
        setCiphersLoading(true)
        // vaultFetch clears the token on 401, so an expired session flips the
        // whole app to "disconnected" (and this effect re-runs → empties ciphers)
        // instead of erroring while Settings still shows "Connected".
        vaultFetch('/ciphers')
            .then(async data => {
                const list = Array.isArray(data) ? data : (data.data ?? [])
                const symKey = loadVaultSymKey()
                if (symKey) {
                    const decrypted = await Promise.all(
                        list.map(async c => ({
                            ...c,
                            _name: (await decryptEncString(c.name, symKey)) ?? c.id,
                        }))
                    )
                    setCiphers(decrypted.sort((a, b) => a._name.localeCompare(b._name)))
                } else {
                    setCiphers(list.map(c => ({ ...c, _name: c.id })))
                }
            })
            .catch(e => showToast(e.message, 'error'))
            .finally(() => setCiphersLoading(false))
    }, [vaultToken, vaultFetch])

    async function handleLinkVault(accountId, cipherId) {
        setLinkingId(accountId)
        try {
            await api.patch(`/budget/accounts/${accountId}`, {
                vault_item_id: cipherId || null,
            })
            showToast(cipherId ? 'Vault item linked' : 'Vault link removed', 'success')
            load()
        } catch (e) {
            showToast(e.message, 'error')
        } finally {
            setLinkingId(null)
        }
    }

    async function handleAdd(e) {
        e.preventDefault()
        if (!newName.trim()) return
        try {
            await api.post('/budget/accounts/', {
                name: newName.trim(),
                institution: newInstitution.trim() || null,
                number: newNumber.trim() || null,
                on_budget: newOnBudget,
                personal: newPersonal,
            })
            showToast(`Added '${newName.trim()}'`, 'success')
            setNewName('')
            setNewInstitution('')
            setNewNumber('')
            setNewOnBudget(true)
            setNewPersonal(false)
            load()
        } catch (e) {
            showToast(e.message, 'error')
        }
    }

    function startEdit(acct) {
        setEditingId(acct.id)
        setEditName(acct.name)
        setEditInst(acct.institution || '')
        setEditNumber(acct.number || '')
        setEditOnBudget(acct.on_budget !== false)
        setEditPersonal(acct.personal === true)
    }

    async function handleSaveEdit(id) {
        if (!editName.trim()) return
        try {
            await api.patch(`/budget/accounts/${id}`, {
                name: editName.trim(),
                institution: editInst.trim() || null,
                number: editNumber.trim() || null,
                on_budget: editOnBudget,
                personal: editPersonal,
            })
            showToast('Saved', 'success')
            setEditingId(null)
            load()
        } catch (e) {
            showToast(e.message, 'error')
        }
    }

    async function handleDelete(id, name) {
        const ok = await confirm(`Delete account '${name}'?`, { danger: true })
        if (!ok) return
        try {
            await api.del(`/budget/accounts/${id}`)
            showToast(`Deleted '${name}'`, 'success')
            load()
        } catch (e) {
            showToast(e.message, 'error')
        }
    }

    async function handleSync(accountId) {
        setSyncingId(accountId)
        try {
            const body = { account_id: accountId }
            if (syncOption.start_date) {
                body.start_date = syncOption.start_date
            } else {
                body.days = syncOption.days
            }
            const result = await api.post('/plaid/sync', body)
            if (!result.rows || result.rows.length === 0) {
                showToast(`Up to date — ${result.skipped} already imported`, 'info')
                return
            }
            // Navigate to transactions page with Plaid rows preloaded
            onNav('transactions', {
                accountId,
                plaidRows: result.rows,
                _plaidKey: Date.now(),
            })
        } catch (e) {
            showToast(e.message || 'Sync failed', 'error')
        } finally {
            setSyncingId(null)
        }
    }

    // total reflects on-budget accounts only — off-budget balances are excluded entirely
    const totalBalance = accounts.filter(a => a.on_budget !== false).reduce((s, a) => s + (a.balance || 0), 0)

    // 'default' = the manual order persisted server-side (drag to reorder); every
    // other option is a computed sort where dragging is disabled.
    const canDrag = sortBy === 'default'
    const sorted = sortBy === 'default'
        ? accounts
        : [...accounts].sort((a, b) => {
            switch (sortBy) {
                case 'name_az': return a.name.localeCompare(b.name)
                case 'name_za': return b.name.localeCompare(a.name)
                case 'id': return a.id - b.id
                case 'balance_high': return (b.balance || 0) - (a.balance || 0)
                case 'balance_low': return (a.balance || 0) - (b.balance || 0)
                case 'institution': return (a.institution || '').localeCompare(b.institution || '')
                default: return 0
            }
        })

    async function handleDrop(targetId) {
        if (dragId && dragId !== targetId) {
            const ids = sorted.map(a => a.id)
            ids.splice(ids.indexOf(dragId), 1)            // pull the dragged id out
            ids.splice(ids.indexOf(targetId), 0, dragId)  // drop it in front of the target
            const byId = new Map(accounts.map(a => [a.id, a]))
            setAccounts(ids.map(id => byId.get(id)))      // optimistic
            try {
                await api.put('/budget/accounts/reorder', { order: ids })
                window.dispatchEvent(new Event('thrive:accounts-changed'))
            } catch (e) {
                showToast(e.message || 'Reorder failed', 'error')
                load()
            }
        }
        setDragId(null); setOverId(null)
    }

    return (
        <div className="page">
            <div className="page-header">
                <h1 className="page-title">Accounts</h1>
                <span className="muted">
                    {accounts.length} accounts · {fmtMoney(totalBalance)} total
                </span>
            </div>

            <form className="add-form add-form-stacked" onSubmit={handleAdd}>
                <div className="add-form-inputs">
                    <input
                        type="text"
                        className="input"
                        placeholder="Account name"
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                    />
                    <input
                        type="text"
                        className="input"
                        placeholder="Institution"
                        value={newInstitution}
                        onChange={e => setNewInstitution(e.target.value)}
                    />
                    <input
                        type="text"
                        className="input"
                        placeholder="Number"
                        value={newNumber}
                        onChange={e => setNewNumber(e.target.value)}
                    />
                </div>
                <div className="add-form-footer">
                    <label className="budget-toggle">
                        <span>On budget</span>
                        <input
                            type="checkbox"
                            checked={newOnBudget}
                            onChange={e => setNewOnBudget(e.target.checked)}
                        />
                    </label>
                    {user?.profile && (
                        <label className="budget-toggle" title="Personal — visible only to you">
                            <span>🔒 Personal</span>
                            <input
                                type="checkbox"
                                checked={newPersonal}
                                onChange={e => setNewPersonal(e.target.checked)}
                            />
                        </label>
                    )}
                    <button type="submit" className="btn btn-primary">Add</button>
                </div>
            </form>

            <div className="sched-toolbar">
                <span className="muted">{accounts.length} accounts</span>
                <ScopeToggle value={scope} onChange={setScope} />
                <select
                    className="input sort-select"
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value)}
                >
                    <option value="default">Manual (drag to reorder)</option>
                    <option value="name_az">Name A-Z</option>
                    <option value="name_za">Name Z-A</option>
                    <option value="balance_high">Balance high → low</option>
                    <option value="balance_low">Balance low → high</option>
                    <option value="institution">Institution</option>
                    <option value="id">ID</option>
                </select>
            </div>

            {loading ? (
                <div className="muted">Loading…</div>
            ) : (
                <div className="acct-list">
                    {sorted.length === 0 ? (
                        <div className="cat-row"><span className="muted">No accounts yet</span></div>
                    ) : (
                        sorted.map(a =>
                            editingId === a.id ? (
                                <AccountEditForm
                                    key={a.id}
                                    editName={editName}
                                    editInst={editInst}
                                    editNumber={editNumber}
                                    editOnBudget={editOnBudget}
                                    editPersonal={editPersonal}
                                    canPersonal={!!user?.profile}
                                    setEditName={setEditName}
                                    setEditInst={setEditInst}
                                    setEditNumber={setEditNumber}
                                    setEditOnBudget={setEditOnBudget}
                                    setEditPersonal={setEditPersonal}
                                    onSave={() => handleSaveEdit(a.id)}
                                    onCancel={() => setEditingId(null)}
                                />
                            ) : (
                                <AccountRow
                                    key={a.id}
                                    acct={a}
                                    canDrag={canDrag}
                                    dragging={dragId === a.id}
                                    isOver={overId === a.id && dragId && dragId !== a.id}
                                    onDragStart={() => setDragId(a.id)}
                                    onDragEnter={() => setOverId(a.id)}
                                    onDrop={() => handleDrop(a.id)}
                                    onDragEnd={() => { setDragId(null); setOverId(null) }}
                                    expanded={expandedId === a.id}
                                    onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)}
                                    onEdit={() => { startEdit(a); setExpandedId(null) }}
                                    onDelete={() => handleDelete(a.id, a.name)}
                                    hasPlaid={plaidAcctIds.has(a.id)}
                                    syncing={syncingId === a.id}
                                    syncOption={syncOption}
                                    onSyncOptionChange={setSyncOption}
                                    onSync={() => handleSync(a.id)}
                                    vaultToken={vaultToken}
                                    ciphers={ciphers}
                                    ciphersLoading={ciphersLoading}
                                    linking={linkingId === a.id}
                                    onLinkVault={(cipherId) => handleLinkVault(a.id, cipherId)}
                                />
                            )
                        )
                    )}
                </div>
            )}
        </div>
    )
}

function AccountRow({
    acct, expanded, onToggle, onEdit, onDelete,
    hasPlaid, syncing, syncOption, onSyncOptionChange, onSync,
    vaultToken, ciphers, ciphersLoading, linking, onLinkVault,
    canDrag, dragging, isOver, onDragStart, onDragEnter, onDrop, onDragEnd,
}) {
    const offBudget = acct.on_budget === false
    const balanceClass = acct.balance < 0 ? 'sched-amount expense' : 'sched-amount income'
    const meta = [acct.institution, acct.number].filter(Boolean).join(' · ')

    // Find the currently linked cipher name for the badge tooltip
    const linkedCipher = acct.vault_item_id
        ? ciphers.find(c => c.id === acct.vault_item_id)
        : null

    return (
        <div
            className={`sched-row acct-clickable ${offBudget ? 'off-budget-row' : ''} ${expanded ? 'expanded' : ''}`}
            draggable={canDrag}
            onDragStart={canDrag ? (e => { onDragStart(); e.dataTransfer.effectAllowed = 'move' }) : undefined}
            onDragEnter={canDrag ? onDragEnter : undefined}
            onDragOver={canDrag ? (e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }) : undefined}
            onDrop={canDrag ? (e => { e.preventDefault(); onDrop() }) : undefined}
            onDragEnd={canDrag ? onDragEnd : undefined}
            style={{
                opacity: dragging ? 0.3 : undefined,
                boxShadow: isOver ? 'inset 0 2px 0 var(--text-primary,#e8e6e0)' : undefined,
            }}
        >
            <div className="sched-info" onClick={onToggle}>
                <div className="sched-name-row">
                    {canDrag && (
                        <span
                            className="acct-drag-handle"
                            title="Drag to reorder"
                            style={{ cursor: 'grab', color: 'var(--text-tertiary,#666)', marginRight: 2, fontSize: 13, lineHeight: 1 }}
                        >⠿</span>
                    )}
                    <span className="sched-id">{acct.id}</span>
                    <span className="sched-payee">{acct.name}</span>
                    {offBudget && <span className="off-budget-tag">off</span>}
                    {acct.personal && (
                        <span
                            className="off-budget-tag"
                            style={{ background: 'rgba(59,130,246,0.18)', color: '#3b82f6', borderColor: 'rgba(59,130,246,0.4)' }}
                            title="Personal — visible only to you"
                        >🔒 personal</span>
                    )}
                    {hasPlaid && <span className="plaid-badge">plaid</span>}
                    {acct.vault_item_id && (
                        <span
                            className="vault-badge"
                            title={linkedCipher ? linkedCipher._name : acct.vault_item_id}
                        >
                            vault
                        </span>
                    )}
                    <span className="sched-meta-inline">{meta}</span>
                </div>
            </div>
            <div className={balanceClass} onClick={onToggle}>{fmtMoney(acct.balance)}</div>

            {expanded && (
                <div className="row-expanded">
                    <div className="cat-badges">
                        {acct.scheduled_count > 0 && (
                            <span className="badge" title={`${acct.scheduled_count} scheduled`}>
                                S:{acct.scheduled_count}
                            </span>
                        )}
                        {acct.transactions_count > 0 && (
                            <span className="badge" title={`${acct.transactions_count} transactions`}>
                                T:{acct.transactions_count}
                            </span>
                        )}
                    </div>

                    {hasPlaid && (
                        <div className="acct-sync-row">
                            <select
                                className="input acct-sync-select"
                                value={SYNC_OPTIONS.indexOf(syncOption)}
                                onChange={e => onSyncOptionChange(SYNC_OPTIONS[parseInt(e.target.value)])}
                            >
                                {SYNC_OPTIONS.map((opt, i) => (
                                    <option key={i} value={i}>{opt.label}</option>
                                ))}
                            </select>
                            <button
                                className="btn btn-primary acct-sync-btn"
                                onClick={onSync}
                                disabled={syncing}
                            >
                                {syncing ? 'Syncing…' : '↻ Sync'}
                            </button>
                        </div>
                    )}

                    {/* Vault cipher linking — only rendered when a vault session is active */}
                    {vaultToken && (
                        <div className="acct-vault-row">
                            <select
                                className="input acct-vault-select"
                                value={acct.vault_item_id ?? ''}
                                disabled={ciphersLoading || linking}
                                onChange={e => onLinkVault(e.target.value || null)}
                            >
                                <option value="">
                                    {ciphersLoading ? 'Loading vault…' : '— No vault item —'}
                                </option>
                                {ciphers.map(c => (
                                    <option key={c.id} value={c.id}>
                                        {c._name}
                                    </option>
                                ))}
                            </select>
                            {acct.vault_item_id && (
                                <button
                                    className="btn btn-danger-solid acct-vault-unlink"
                                    onClick={() => onLinkVault(null)}
                                    disabled={linking}
                                    title="Remove vault link"
                                >
                                    {linking ? '…' : '✕'}
                                </button>
                            )}
                        </div>
                    )}

                    <div className="row-expanded-actions">
                        <button className="btn" onClick={onEdit}>Edit</button>
                        <button className="btn btn-danger-solid" onClick={onDelete}>Delete</button>
                    </div>
                </div>
            )}
        </div>
    )
}

function AccountEditForm({
    editName, editInst, editNumber, editOnBudget, editPersonal, canPersonal,
    setEditName, setEditInst, setEditNumber, setEditOnBudget, setEditPersonal,
    onSave, onCancel,
}) {
    return (
        <div className="sched-form">
            <div className="form-row">
                <label>Name</label>
                <input className="input" value={editName} onChange={e => setEditName(e.target.value)} autoFocus />
            </div>
            <div className="form-row">
                <label>Institution</label>
                <input className="input" value={editInst} onChange={e => setEditInst(e.target.value)} />
            </div>
            <div className="form-row">
                <label>Number</label>
                <input className="input" value={editNumber} onChange={e => setEditNumber(e.target.value)} />
            </div>
            <div className="form-row">
                <label>On Budget</label>
                <input
                    type="checkbox"
                    checked={editOnBudget}
                    onChange={e => setEditOnBudget(e.target.checked)}
                />
            </div>
            {canPersonal && (
                <div className="form-row">
                    <label title="Personal — visible only to you">🔒 Personal</label>
                    <input
                        type="checkbox"
                        checked={editPersonal}
                        onChange={e => setEditPersonal(e.target.checked)}
                    />
                </div>
            )}
            <div className="form-actions">
                <button type="button" className="btn btn-primary" onClick={onSave}>Save</button>
                <button type="button" className="btn" onClick={onCancel}>Cancel</button>
            </div>
        </div>
    )
}