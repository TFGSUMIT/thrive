import { useEffect, useState } from 'react'
import { api } from '@trunk/api'
import { useToast } from '@trunk/context/ToastContext'
import { useConfirm } from '@trunk/context/ConfirmModal'
import './Page.css'

export default function CategoriesPage() {
  const { showToast } = useToast()
  const { confirm } = useConfirm()
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)

  const [newName, setNewName] = useState('')
  const [newParentId, setNewParentId] = useState('')

  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')

  async function load() {
    setLoading(true)
    try {
      const data = await api.get('/categories/')
      setCategories(data)
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
      await api.post('/categories/', {
        name: newName.trim(),
        parent_id: newParentId ? parseInt(newParentId) : null,
      })
      showToast(`Added '${newName.trim()}'`, 'success')
      setNewName('')
      setNewParentId('')
      load()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  async function handleSaveEdit(id) {
    if (!editName.trim()) return
    try {
      await api.patch(`/categories/${id}`, { name: editName.trim() })
      showToast('Saved', 'success')
      setEditingId(null)
      load()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  async function handleDelete(id, name) {
    const ok = await confirm(`Delete category '${name}'?`, { danger: true })
    if (!ok) return
    try {
      await api.del(`/categories/${id}`)
      showToast(`Deleted '${name}'`, 'success')
      load()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const parents = categories.filter(c => !c.parent_id)
  const subs = categories.filter(c => c.parent_id)
  const childrenOf = (pid) => categories.filter(c => c.parent_id === pid)
  const aggregate = (parent) => {
    const kids = childrenOf(parent.id)
    return {
      scheduled: (parent.scheduled_count || 0) + kids.reduce((s, c) => s + (c.scheduled_count || 0), 0),
      transactions: (parent.transactions_count || 0) + kids.reduce((s, c) => s + (c.transactions_count || 0), 0),
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Categories</h1>
        <span className="muted">
          {parents.length} parent{parents.length !== 1 ? 's' : ''} · {subs.length} sub{subs.length !== 1 ? 's' : ''} · {categories.length} total
        </span>
      </div>

      <form className="add-form" onSubmit={handleAdd}>
        <input
          type="text"
          className="input"
          placeholder="Category name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
        />
        <select
          className="input"
          value={newParentId}
          onChange={e => setNewParentId(e.target.value)}
        >
          <option value="">— top-level —</option>
          {parents.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary">Add</button>
      </form>

      {loading ? (
        <div className="muted">Loading…</div>
      ) : (
        <div className="cat-tree">
          {parents.map(parent => {
            const counts = aggregate(parent)
            return (
              <div key={parent.id} className="cat-group">
                <CategoryRow
                  cat={parent}
                  isParent
                  scheduledCount={counts.scheduled}
                  transactionsCount={counts.transactions}
                  editingId={editingId}
                  editName={editName}
                  setEditingId={setEditingId}
                  setEditName={setEditName}
                  onSave={handleSaveEdit}
                  onDelete={handleDelete}
                />
                {childrenOf(parent.id).map(child => (
                  <CategoryRow
                    key={child.id}
                    cat={child}
                    scheduledCount={child.scheduled_count}
                    transactionsCount={child.transactions_count}
                    editingId={editingId}
                    editName={editName}
                    setEditingId={setEditingId}
                    setEditName={setEditName}
                    onSave={handleSaveEdit}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CategoryRow({ cat, isParent, scheduledCount, transactionsCount, editingId, editName, setEditingId, setEditName, onSave, onDelete }) {
  const isEditing = editingId === cat.id

  return (
    <div className={`cat-row ${isParent ? 'cat-parent' : 'cat-child'}`}>
      <span className="cat-id">{cat.id}</span>
      {isEditing ? (
        <input
          className="input input-inline"
          value={editName}
          onChange={e => setEditName(e.target.value)}
          autoFocus
          onKeyDown={e => {
            if (e.key === 'Enter') onSave(cat.id)
            if (e.key === 'Escape') setEditingId(null)
          }}
        />
      ) : (
        <span className="cat-name">{cat.name}</span>
      )}
      <div className="cat-badges">
        {scheduledCount > 0 && (
          <span className="badge" title={`${scheduledCount} scheduled`}>
            S:{scheduledCount}
          </span>
        )}
        {transactionsCount > 0 && (
          <span className="badge" title={`${transactionsCount} transactions`}>
            T:{transactionsCount}
          </span>
        )}
      </div>
      <div className="row-actions">
        {isEditing ? (
          <>
            <button className="btn btn-ghost" onClick={() => onSave(cat.id)}>Save</button>
            <button className="btn btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={() => { setEditingId(cat.id); setEditName(cat.name) }}>Edit</button>
            <button className="btn btn-ghost btn-danger" onClick={() => onDelete(cat.id, cat.name)}>Delete</button>
          </>
        )}
      </div>
    </div>
  )
}