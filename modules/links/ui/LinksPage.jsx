// =============================================================================
// LinksPage — native bookmarks / app-launcher dashboard (/links). A thrive
// replacement for flame: categorized link tiles, click to open. Toggle Edit to
// add/rename/remove categories and links inline. Self-contained (no external
// favicon fetches) — a tile shows its icon (emoji) or the title's first letter.
// =============================================================================
import { useState, useEffect } from 'react'
import { api } from '@trunk/api'

const ACCENT = '#38bdf8'
const UNCAT  = '__uncat__'

const wrap = { maxWidth: 1100, margin: '0 auto', padding: '2rem 1.5rem', boxSizing: 'border-box' }
const inp  = { fontFamily: 'inherit', fontSize: 14, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 8, color: 'inherit', padding: '9px 11px', outline: 'none' }
const ghost = { background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '6px 12px', cursor: 'pointer' }

const host = (url) => { try { return new URL(url).host.replace(/^www\./, '') } catch { return url } }
const badge = (it) => (it.icon && it.icon.trim()) || (it.title || '?').trim().charAt(0).toUpperCase()

// --- one clickable link tile -------------------------------------------------
function Tile({ it, editing, onEdit, onDel }) {
  const [hov, setHov] = useState(false)
  const inner = (
    <>
      <div style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 9, background: 'var(--bg-primary,#0f0f0f)', border: '1px solid var(--border-color,#2a2a2a)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: ACCENT }}>{badge(it)}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary,#e8e6e0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary,#666)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{host(it.url)}</div>
      </div>
    </>
  )
  const base = { display: 'flex', alignItems: 'center', gap: 11, padding: 11, borderRadius: 11, background: 'var(--bg-secondary,#181818)', border: `1px solid ${hov ? ACCENT : 'var(--border-color,#2a2a2a)'}`, textDecoration: 'none', transition: 'border-color .12s', position: 'relative' }
  if (editing) {
    return (
      <div style={base} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
        {inner}
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => onEdit(it)} title="edit" style={{ background: 'none', border: 'none', color: 'var(--text-secondary,#aaa)', cursor: 'pointer', fontSize: 13 }}>✎</button>
          <button onClick={() => onDel(it)} title="remove" style={{ background: 'none', border: 'none', color: 'var(--text-tertiary,#666)', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
      </div>
    )
  }
  return (
    <a href={it.url} target="_blank" rel="noreferrer" style={base}
       onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>{inner}</a>
  )
}

// --- add / edit form (shared) ------------------------------------------------
function LinkForm({ cats, initial, onSave, onCancel }) {
  const [title, setTitle] = useState(initial?.title || '')
  const [url, setUrl]     = useState(initial?.url || '')
  const [icon, setIcon]   = useState(initial?.icon || '')
  const [cat, setCat]     = useState(initial?.category_id ?? '')
  const save = () => {
    if (!title.trim() || !url.trim()) return
    onSave({ title: title.trim(), url: url.trim(), icon: icon.trim(),
             category_id: cat === '' ? null : Number(cat) })
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12, borderRadius: 11, background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', marginBottom: 14 }}>
      <input style={{ ...inp, flex: '2 1 160px' }} placeholder="Title" value={title} autoFocus
        onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} />
      <input style={{ ...inp, flex: '3 1 200px' }} placeholder="URL (example.com)" value={url}
        onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} />
      <input style={{ ...inp, width: 60, textAlign: 'center' }} placeholder="🔗" value={icon}
        onChange={e => setIcon(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} />
      <select style={{ ...inp, flex: '1 1 120px' }} value={cat} onChange={e => setCat(e.target.value)}>
        <option value="">Uncategorized</option>
        {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <button style={{ ...ghost, color: ACCENT, borderColor: ACCENT }} onClick={save}>{initial ? 'Save' : 'Add'}</button>
      <button style={ghost} onClick={onCancel}>Cancel</button>
    </div>
  )
}

export default function LinksPage() {
  const [cats, setCats]   = useState([])
  const [links, setLinks] = useState([])
  const [editing, setEditing] = useState(false)
  const [adding, setAdding]   = useState(false)   // add-link form open
  const [editLink, setEditLink] = useState(null)  // link being edited
  const [newCat, setNewCat]   = useState('')

  const load = () => api.get('/links').then(d => { setCats(d.categories || []); setLinks(d.links || []) }).catch(() => {})
  useEffect(() => { load() }, [])

  const addLink   = async (body) => { try { await api.post('/links', body); setAdding(false); load() } catch {} }
  const saveLink  = async (body) => { try { await api.patch(`/links/${editLink.id}`, body); setEditLink(null); load() } catch {} }
  const delLink   = async (it) => { try { await api.del(`/links/${it.id}`); load() } catch {} }
  const addCat    = async () => { const n = newCat.trim(); if (!n) return; try { await api.post('/links/categories', { name: n }); setNewCat(''); load() } catch {} }
  const renameCat = async (c) => { const n = prompt('Rename category', c.name); if (n == null) return; try { await api.patch(`/links/categories/${c.id}`, { name: n }); load() } catch {} }
  const delCat    = async (c) => { if (!confirm(`Delete "${c.name}"? Its links move to Uncategorized.`)) return; try { await api.del(`/links/categories/${c.id}`); load() } catch {} }

  // group links; uncategorized last
  const byCat = (id) => links.filter(l => (id === UNCAT ? l.category_id == null : l.category_id === id))
  const sections = [...cats.map(c => ({ ...c, key: c.id })), { key: UNCAT, name: 'Uncategorized', id: UNCAT }]
    .filter(s => s.key !== UNCAT || byCat(UNCAT).length > 0)

  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
        <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 24, fontWeight: 700, letterSpacing: '0.05em' }}>🔖 Links</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {editing && <button style={{ ...ghost, color: ACCENT, borderColor: ACCENT }} onClick={() => { setAdding(true); setEditLink(null) }}>+ Link</button>}
          <button style={editing ? { ...ghost, color: ACCENT, borderColor: ACCENT } : ghost} onClick={() => { setEditing(e => !e); setAdding(false); setEditLink(null) }}>{editing ? 'Done' : 'Edit'}</button>
        </div>
      </div>

      {editing && adding && !editLink && <LinkForm cats={cats} onSave={addLink} onCancel={() => setAdding(false)} />}
      {editing && editLink && <LinkForm cats={cats} initial={editLink} onSave={saveLink} onCancel={() => setEditLink(null)} />}

      {editing && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <input style={{ ...inp, flex: '0 1 240px' }} placeholder="New category…" value={newCat}
            onChange={e => setNewCat(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCat()} />
          <button style={ghost} onClick={addCat}>+ Category</button>
        </div>
      )}

      {links.length === 0 && cats.length === 0 && !editing && (
        <div style={{ color: 'var(--text-tertiary,#666)', fontSize: 14, textAlign: 'center', marginTop: 64 }}>
          No links yet — hit <span style={{ color: ACCENT }}>Edit</span> to add some 🔖
        </div>
      )}

      {sections.map(sec => {
        const items = byCat(sec.key)
        if (items.length === 0 && sec.key !== UNCAT && !editing) return null
        return (
          <section key={sec.key} style={{ marginBottom: 30 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 12px' }}>
              <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-secondary,#aaa)', margin: 0, fontWeight: 600 }}>{sec.name}</h2>
              {editing && sec.key !== UNCAT && (
                <span style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => renameCat(sec)} title="rename" style={{ background: 'none', border: 'none', color: 'var(--text-tertiary,#666)', cursor: 'pointer', fontSize: 12 }}>✎</button>
                  <button onClick={() => delCat(sec)} title="delete category" style={{ background: 'none', border: 'none', color: 'var(--text-tertiary,#666)', cursor: 'pointer', fontSize: 13 }}>✕</button>
                </span>
              )}
            </div>
            {items.length === 0
              ? <div style={{ fontSize: 12, color: 'var(--text-tertiary,#555)' }}>No links here yet.</div>
              : <div style={grid}>{items.map(it => <Tile key={it.id} it={it} editing={editing} onEdit={l => { setEditLink(l); setAdding(false) }} onDel={delLink} />)}</div>}
          </section>
        )
      })}
    </div>
  )
}
