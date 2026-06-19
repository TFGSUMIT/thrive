import { useEffect, useState } from 'react'
import { api } from '@trunk/api'
import { useToast } from '@trunk/context/ToastContext'
import { useConfirm } from '@trunk/context/ConfirmModal'
import './Page.css'

export default function PayeesPage() {
  const { showToast } = useToast()
  const { confirm } = useConfirm()
  const [payees, setPayees] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')

  async function load() {
    setLoading(true)
    try {
      const data = await api.get('/payees/')
      setPayees(data)
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleAdd(e) {
    e.preventDefault()
    if (!newName.trim()) return
    try {
      await api.post('/payees/', { name: newName.trim() })
      showToast(`Added '${newName.trim()}'`, 'success')
      setNewName('')
      load()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  async function handleSaveEdit(id) {
    if (!editName.trim()) return
    try {
      await api.patch(`/payees/${id}`, { name: editName.trim() })
      showToast('Saved', 'success')
      setEditingId(null)
      load()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  async function handleDelete(id, name) {
    const ok = await confirm(`Delete payee '${name}'?`, { danger: true })
    if (!ok) return
    try {
      await api.del(`/payees/${id}`)
      showToast(`Deleted '${name}'`, 'success')
      load()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  async function handleMerge(sourceId, sourceName, targetId) {
    const target = payees.find(p => p.id === targetId)
    const ok = await confirm(
      `Merge '${sourceName}' into '${target?.name}'? All transactions and aliases will be moved. This cannot be undone.`,
      { danger: true }
    )
    if (!ok) return
    try {
      await api.post(`/payees/${sourceId}/merge`, { target_id: targetId })
      showToast(`Merged '${sourceName}' into '${target?.name}'`, 'success')
      if (editingId === sourceId) setEditingId(null)
      load()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const visible = filter
    ? payees.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()))
    : payees

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Payees</h1>
        <span className="muted">{payees.length} total</span>
      </div>

      <form className="add-form" onSubmit={handleAdd}>
        <input
          type="text"
          className="input"
          placeholder="Payee name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
        />
        <button type="submit" className="btn btn-primary">Add</button>
      </form>

      <input
        type="text"
        className="input filter-input"
        placeholder="Filter payees..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />

      {loading ? (
        <div className="muted">Loading…</div>
      ) : (
        <div className="cat-group">
          {visible.length === 0 ? (
            <div className="cat-row"><span className="muted">No matches</span></div>
          ) : (
            visible.map(p => (
              <PayeeRow
                key={p.id}
                payee={p}
                allPayees={payees}
                isEditing={editingId === p.id}
                editName={editName}
                setEditingId={setEditingId}
                setEditName={setEditName}
                onSave={handleSaveEdit}
                onDelete={handleDelete}
                onMerge={handleMerge}
                showToast={showToast}
                confirm={confirm}
                onAliasChange={load}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function PayeeRow({
  payee, allPayees, isEditing, editName,
  setEditingId, setEditName,
  onSave, onDelete, onMerge,
  showToast, confirm, onAliasChange,
}) {
  const [aliases, setAliases] = useState([])
  const [newAlias, setNewAlias] = useState('')
  const [loadingA, setLoadingA] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeTarget, setMergeTarget] = useState('')

  useEffect(() => {
    if (isEditing) loadAliases()
    else { setMergeOpen(false); setMergeTarget('') }
  }, [isEditing])

  async function loadAliases() {
    setLoadingA(true)
    try {
      const data = await api.get(`/payees/${payee.id}/aliases`)
      setAliases(data)
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setLoadingA(false)
    }
  }

  async function handleAddAlias(e) {
    e.preventDefault()
    if (!newAlias.trim()) return
    try {
      await api.post(`/payees/${payee.id}/aliases`, { raw_name: newAlias.trim() })
      setNewAlias('')
      loadAliases()
      onAliasChange()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  async function handleDeleteAlias(aliasId, rawText) {
    const ok = await confirm(`Remove alias '${rawText}'?`, { danger: true })
    if (!ok) return
    try {
      await api.del(`/payees/${payee.id}/aliases/${aliasId}`)
      loadAliases()
      onAliasChange()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  function handleMergeSubmit() {
    if (!mergeTarget) return
    setMergeOpen(false)
    onMerge(payee.id, payee.name, parseInt(mergeTarget))
  }

  const mergeOptions = allPayees.filter(p => p.id !== payee.id)

  return (
    <div className="cat-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span className="cat-id">{payee.id}</span>
        {isEditing ? (
          <input
            className="input input-inline"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') onSave(payee.id)
              if (e.key === 'Escape') setEditingId(null)
            }}
          />
        ) : (
          <span className="cat-name">{payee.name}</span>
        )}
        <div className="cat-badges">
          {payee.scheduled_count > 0 && (
            <span className="badge" title={`${payee.scheduled_count} scheduled`}>S:{payee.scheduled_count}</span>
          )}
          {payee.transactions_count > 0 && (
            <span className="badge" title={`${payee.transactions_count} transactions`}>T:{payee.transactions_count}</span>
          )}
          {payee.aliases_count > 0 && (
            <span className="badge" title={`${payee.aliases_count} aliases`}>A:{payee.aliases_count}</span>
          )}
        </div>
        <div className="row-actions">
          {isEditing ? (
            <>
              <button className="btn btn-ghost" onClick={() => onSave(payee.id)}>Save</button>
              <button className="btn btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => { setEditingId(payee.id); setEditName(payee.name) }}>Edit</button>
              <button className="btn btn-ghost btn-danger" onClick={() => onDelete(payee.id, payee.name)}>Delete</button>
            </>
          )}
        </div>
      </div>

      {isEditing && (
        <div className="payee-aliases">
          {/* ── Merge section ── */}
          <div className="payee-aliases-title">Merge into another payee</div>
          {mergeOpen ? (
            <div className="payee-merge-row">
              <select
                className="input"
                value={mergeTarget}
                onChange={e => setMergeTarget(e.target.value)}
                autoFocus
              >
                <option value="">Select target payee…</option>
                {mergeOptions.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                className="btn btn-danger"
                onClick={handleMergeSubmit}
                disabled={!mergeTarget}
              >
                Merge
              </button>
              <button className="btn btn-ghost" onClick={() => { setMergeOpen(false); setMergeTarget('') }}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn" onClick={() => setMergeOpen(true)}>
              ⇄ Merge this payee…
            </button>
          )}

          {/* ── Aliases section ── */}
          <div className="payee-aliases-title" style={{ marginTop: '12px' }}>Aliases</div>
          {loadingA ? (
            <span className="muted">Loading…</span>
          ) : (
            <>
              {aliases.length === 0 ? (
                <span className="muted" style={{ fontSize: '12px' }}>No aliases yet</span>
              ) : (
                <div className="payee-alias-list">
                  {aliases.map(a => (
                    <div key={a.id} className="payee-alias-row">
                      <span className="payee-alias-text">{a.raw_name}</span>
                      <button
                        className="btn btn-ghost btn-danger"
                        style={{ fontSize: '11px', padding: '2px 8px' }}
                        onClick={() => handleDeleteAlias(a.id, a.raw_name)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <form className="payee-alias-add" onSubmit={handleAddAlias}>
                <input
                  className="input"
                  placeholder="Add alias (raw bank text)…"
                  value={newAlias}
                  onChange={e => setNewAlias(e.target.value)}
                />
                <button type="submit" className="btn btn-primary" disabled={!newAlias.trim()}>Add</button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  )
}