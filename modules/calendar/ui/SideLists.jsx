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

export default function SideLists({ hasTodo, hasGroceries, side = 'right', onCollapse }) {
  if (!hasTodo && !hasGroceries) return null
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
      {hasTodo      && <Panel endpoint="/todo"      title="To-Do"    icon="✅" accent="#22c55e" field="title" doneKey="done" />}
      {hasGroceries && <Panel endpoint="/groceries" title="Groceries" icon="🛒" accent="#f59e0b" field="name"  doneKey="got"  />}
    </div>
  )
}
