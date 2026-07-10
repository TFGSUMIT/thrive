// =============================================================================
// SideLists — a calendar-side panel surfacing the To-Do + Groceries modules on
// the wall. Feature-detected (the calendar only renders a panel when that module
// is active), interactive (tap a row to check it off, quick-add at the top), and
// light-polls so it stays fresh when items are changed on the modules' own pages.
// Cross-module by feature-detection, never a hard dependency.
// =============================================================================
import { useState, useEffect } from 'react'
import { api } from '@trunk/api'

function Panel({ endpoint, title, icon, accent, field, doneKey }) {
  const [items, setItems] = useState([])
  const [text, setText]   = useState('')

  const load = () => api.get(endpoint).then(setItems).catch(() => setItems([]))
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id) }, [])  // eslint-disable-line

  const add = async () => { const v = text.trim(); if (!v) return; try { await api.post(endpoint, { [field]: v }); setText(''); load() } catch {} }
  const toggle = async (it) => { try { await api.patch(`${endpoint}/${it.id}`, { [doneKey]: !it[doneKey] }); load() } catch {} }

  const open = items.filter(i => !i[doneKey])
  const doneCount = items.length - open.length

  return (
    <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid var(--border-color,#1f1f1f)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 15 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: accent }}>{title}</span>
        {doneCount > 0 && <span style={{ fontSize: 10, color: 'var(--text-tertiary,#666)' }}>· {doneCount} done</span>}
      </div>
      <input value={text} placeholder="add…" autoComplete="off"
        onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
        style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 13, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '8px 10px', outline: 'none', marginBottom: 6 }} />
      {open.map(it => (
        <div key={it.id} onClick={() => toggle(it)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 2px', cursor: 'pointer' }}>
          <span style={{ width: 18, height: 18, flexShrink: 0, borderRadius: 5, border: `2px solid ${accent}88` }} />
          <span style={{ fontSize: 13, color: 'var(--text-primary,#e8e6e0)' }}>{it[field]}</span>
        </div>
      ))}
      {open.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-tertiary,#555)', padding: '4px 2px' }}>all clear</div>}
    </div>
  )
}

const PALETTE = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#eab308', '#14b8a6', '#ec4899']

// calendars list: visibility toggles + per-calendar options (rename / recolor /
// delete for local calendars; external ones just toggle)
function CalendarsPanel({ cals, onToggle, onChanged }) {
  const [editing, setEditing] = useState(null)   // calendar id with options open
  const [name, setName]       = useState('')
  const [adding, setAdding]   = useState(false)
  const [newName, setNewName] = useState('')

  const patch = async (id, body) => { try { await api.patch(`/calendar/calendars/${id}`, body); onChanged() } catch {} }
  const del = async (c) => {
    if (!confirm(`Delete "${c.name}"${c.kind === 'local' ? ' and all its events' : ' from the view'}?`)) return
    try { await api.del(`/calendar/calendars/${c.id}`); setEditing(null); onChanged() } catch {}
  }
  const add = async () => {
    const v = newName.trim(); if (!v) return
    try { await api.post('/calendar/calendars', { name: v }); setNewName(''); setAdding(false); onChanged() } catch {}
  }

  return (
    <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid var(--border-color,#1f1f1f)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 15 }}>📅</span>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-secondary,#aaa)' }}>Calendars</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => { setAdding(a => !a); setEditing(null) }} title="new calendar"
          style={{ background: 'none', border: 'none', color: 'var(--text-tertiary,#666)', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}>＋</button>
      </div>
      {adding && (
        <input value={newName} placeholder="calendar name…" autoFocus autoComplete="off"
          onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false) }}
          style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 13, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '8px 10px', outline: 'none', marginBottom: 6 }} />
      )}
      {cals.map(c => (
        <div key={c.id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 2px' }}>
            <span onClick={() => onToggle(c)} title={c.visible ? 'hide' : 'show'}
              style={{ width: 12, height: 12, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
                       background: c.visible ? c.color : 'transparent', border: `2px solid ${c.visible ? c.color : 'var(--text-tertiary,#555)'}` }} />
            <span onClick={() => onToggle(c)} title={c.account_label ? `${c.account_label} (${c.kind})` : 'thrive calendar'}
              style={{ flex: 1, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                       color: c.visible ? 'var(--text-primary,#e8e6e0)' : 'var(--text-tertiary,#666)' }}>
              {c.name}{!c.writable && ' 🔒'}
            </span>
            <button onClick={() => { setEditing(editing === c.id ? null : c.id); setName(c.name); setAdding(false) }} title="options"
              style={{ background: 'none', border: 'none', color: editing === c.id ? 'var(--text-primary,#e8e6e0)' : 'var(--text-tertiary,#555)', fontSize: 14, cursor: 'pointer', padding: '0 2px' }}>⋯</button>
          </div>
          {editing === c.id && (
            <div style={{ margin: '2px 0 8px 22px', padding: '8px 10px', background: 'var(--bg-tertiary,#1c1c1c)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 6 }}>
              {c.kind === 'local' ? (
                <input value={name} autoComplete="off"
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && name.trim()) { patch(c.id, { name: name.trim() }); setEditing(null) } }}
                  onBlur={() => { if (name.trim() && name.trim() !== c.name) patch(c.id, { name: name.trim() }) }}
                  style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 12, background: 'var(--bg-primary,#0f0f0f)', border: '1px solid var(--border-color,#333)', borderRadius: 5, color: 'inherit', padding: '6px 8px', outline: 'none', marginBottom: 8 }} />
              ) : (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary,#666)', marginBottom: 8 }}>{c.account_label} · {c.kind}</div>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {PALETTE.map(col => (
                  <span key={col} onClick={() => patch(c.id, { color: col })}
                    style={{ width: 16, height: 16, borderRadius: '50%', background: col, cursor: 'pointer',
                             outline: c.color === col ? '2px solid var(--text-primary,#e8e6e0)' : 'none', outlineOffset: 1 }} />
                ))}
              </div>
              <button onClick={() => del(c)}
                style={{ background: 'none', border: '1px solid var(--color-danger,#ef4444)', color: 'var(--color-danger,#ef4444)', borderRadius: 5, fontSize: 11, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
                {c.kind === 'local' ? 'Delete calendar' : 'Remove from view'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function SideLists({ hasTodo, hasGroceries, side = 'right', onCollapse, cals = [], onToggleCal, onCalsChanged }) {
  const edge = side === 'left'
    ? { borderRight: '1px solid var(--border-color,#2a2a2a)' }
    : { borderLeft: '1px solid var(--border-color,#2a2a2a)' }
  return (
    <div className="side-scroll" style={{ width: 300, flexShrink: 0, ...edge, overflowY: 'auto', minHeight: 0 }}>
      <style>{`.side-scroll::-webkit-scrollbar{display:none}.side-scroll{scrollbar-width:none}`}</style>
      {onCollapse && (
        <div style={{ display: 'flex', justifyContent: side === 'left' ? 'flex-start' : 'flex-end', padding: '6px 8px 0' }}>
          <button onClick={onCollapse} title="hide panel"
            style={{ background: 'none', border: 'none', color: 'var(--text-tertiary,#666)', fontSize: 20, lineHeight: 1, cursor: 'pointer', padding: '2px 8px' }}>
            {side === 'left' ? '‹' : '›'}
          </button>
        </div>
      )}
      <CalendarsPanel cals={cals} onToggle={onToggleCal} onChanged={onCalsChanged} />
      {hasTodo      && <Panel endpoint="/todo"      title="To-Do"    icon="✅" accent="#22c55e" field="title" doneKey="done" />}
      {hasGroceries && <Panel endpoint="/groceries" title="Groceries" icon="🛒" accent="#f59e0b" field="name"  doneKey="got"  />}
    </div>
  )
}
