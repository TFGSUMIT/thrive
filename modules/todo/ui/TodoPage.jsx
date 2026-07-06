// =============================================================================
// TodoPage — the shared household task list (/todo). Touch-first: big add box +
// big tap targets for a wall. Tap the box to check off, ✕ to remove. "Clear done"
// sweeps completed tasks into History (kept, not deleted); a History view lists
// them by day and can restore one back to the list.
// =============================================================================
import { useState, useEffect } from 'react'
import { api } from '@trunk/api'

const ACCENT = '#22c55e'
const wrap   = { maxWidth: 640, margin: '0 auto', padding: '2rem 1.25rem', height: '100vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }
const inp    = { flex: 1, minWidth: 0, fontFamily: 'inherit', fontSize: 16, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 8, color: 'inherit', padding: '12px 14px', outline: 'none' }
const addBtn = { width: 52, flexShrink: 0, fontSize: 24, background: ACCENT, border: 'none', borderRadius: 8, color: '#0f0f0f', fontWeight: 700, cursor: 'pointer' }
const chip   = { background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '6px 12px', cursor: 'pointer' }

// stored timestamps are UTC "YYYY-MM-DD HH:MM:SS" — parse as UTC for local display
const asDate = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z') : null)
const dayKey = (s) => { const d = asDate(s); return d ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '—' }
const clock  = (s) => { const d = asDate(s); return d ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '' }

function Row({ it, onToggle, onDel }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 6px', borderBottom: '1px solid var(--border-color,#1f1f1f)' }}>
      <button onClick={() => onToggle(it)} title="toggle"
        style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 7, border: `2px solid ${it.done ? ACCENT : 'var(--border-color,#555)'}`, background: it.done ? ACCENT : 'none', color: '#0f0f0f', cursor: 'pointer', fontSize: 17, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {it.done ? '✓' : ''}
      </button>
      <span style={{ flex: 1, fontSize: 16, color: it.done ? 'var(--text-tertiary,#666)' : 'var(--text-primary,#e8e6e0)', textDecoration: it.done ? 'line-through' : 'none' }}>{it.title}</span>
      <button onClick={() => onDel(it)} title="remove" style={{ background: 'none', border: 'none', color: 'var(--text-tertiary,#666)', fontSize: 18, cursor: 'pointer', padding: '4px 8px' }}>✕</button>
    </div>
  )
}

function HistoryRow({ it, onRestore, onDel }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 6px', borderBottom: '1px solid var(--border-color,#1f1f1f)' }}>
      <span style={{ color: ACCENT, fontSize: 15, flexShrink: 0 }}>✓</span>
      <span style={{ flex: 1, fontSize: 15, color: 'var(--text-secondary,#aaa)' }}>{it.title}</span>
      <span style={{ fontSize: 12, color: 'var(--text-tertiary,#666)', flexShrink: 0 }}>{clock(it.done_at || it.archived_at)}</span>
      <button onClick={() => onRestore(it)} title="restore to list" style={{ background: 'none', border: 'none', color: 'var(--text-tertiary,#666)', fontSize: 16, cursor: 'pointer', padding: '4px 6px' }}>↩</button>
      <button onClick={() => onDel(it)} title="delete forever" style={{ background: 'none', border: 'none', color: 'var(--text-tertiary,#666)', fontSize: 16, cursor: 'pointer', padding: '4px 6px' }}>✕</button>
    </div>
  )
}

export default function TodoPage() {
  const [items, setItems] = useState([])
  const [hist, setHist]   = useState([])
  const [text, setText]   = useState('')
  const [view, setView]   = useState('list')   // 'list' | 'history'

  const load     = () => api.get('/todo').then(setItems).catch(() => {})
  const loadHist = () => api.get('/todo/history').then(setHist).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => { if (view === 'history') loadHist() }, [view])

  const add    = async () => { const t = text.trim(); if (!t) return; try { await api.post('/todo', { title: t }); setText(''); load() } catch {} }
  const toggle = async (it) => { try { await api.patch(`/todo/${it.id}`, { done: !it.done }); load() } catch {} }
  const del    = async (it) => { try { await api.del(`/todo/${it.id}`); load() } catch {} }
  const clearDone = async () => { try { await api.post('/todo/archive-done'); load() } catch {} }
  const restore   = async (it) => { try { await api.post(`/todo/${it.id}/restore`); loadHist(); load() } catch {} }
  const delHist   = async (it) => { try { await api.del(`/todo/${it.id}`); loadHist() } catch {} }

  const open = items.filter(i => !i.done)
  const done = items.filter(i => i.done)

  // group history rows by day heading
  const groups = []
  for (const it of hist) {
    const k = dayKey(it.archived_at || it.done_at)
    const g = groups.length && groups[groups.length - 1].k === k ? groups[groups.length - 1] : (groups.push({ k, rows: [] }), groups[groups.length - 1])
    g.rows.push(it)
  }

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 24, fontWeight: 700, letterSpacing: '0.05em' }}>✅ To-Do</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {view === 'list' && done.length > 0 && <button onClick={clearDone} style={chip}>Clear done ({done.length})</button>}
          <button onClick={() => setView(v => v === 'list' ? 'history' : 'list')}
            style={view === 'history' ? { ...chip, color: ACCENT, borderColor: ACCENT } : chip}>
            {view === 'history' ? '← List' : 'History'}
          </button>
        </div>
      </div>

      {view === 'list' ? (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input style={inp} value={text} placeholder="Add a task…" autoComplete="off"
              onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
            <button style={addBtn} onClick={add}>+</button>
          </div>
          <div className="todo-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <style>{`.todo-scroll::-webkit-scrollbar{display:none}.todo-scroll{scrollbar-width:none}`}</style>
            {items.length === 0 && <div style={{ color: 'var(--text-tertiary,#666)', fontSize: 14, textAlign: 'center', marginTop: 48 }}>Nothing to do 🎉</div>}
            {open.map(it => <Row key={it.id} it={it} onToggle={toggle} onDel={del} />)}
            {done.length > 0 && <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#555)', margin: '20px 0 6px' }}>Done</div>}
            {done.map(it => <Row key={it.id} it={it} onToggle={toggle} onDel={del} />)}
          </div>
        </>
      ) : (
        <div className="todo-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <style>{`.todo-scroll::-webkit-scrollbar{display:none}.todo-scroll{scrollbar-width:none}`}</style>
          {hist.length === 0 && <div style={{ color: 'var(--text-tertiary,#666)', fontSize: 14, textAlign: 'center', marginTop: 48 }}>No history yet — clear some done tasks 📜</div>}
          {groups.map(g => (
            <div key={g.k}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#555)', margin: '18px 0 4px' }}>{g.k}</div>
              {g.rows.map(it => <HistoryRow key={it.id} it={it} onRestore={restore} onDel={delHist} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
