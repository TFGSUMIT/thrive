// =============================================================================
// GroceriesPage — the shared household shopping list (/groceries). Touch-first:
// big add box, big tap targets. Tap to mark "got", ✕ to remove, "Clear got" to
// sweep checked items after a shop. The add box suggests products from Open Food
// Facts as you type (pick one to add), and resolves a scanned barcode on Enter.
// =============================================================================
import { useState, useEffect } from 'react'
import { api } from '@trunk/api'
import SuggestInput from './SuggestInput'

const ACCENT = '#f59e0b'
const wrap   = { maxWidth: 640, margin: '0 auto', padding: '2rem 1.25rem', height: '100vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }
const inp    = { minWidth: 0, fontFamily: 'inherit', fontSize: 16, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 8, color: 'inherit', padding: '12px 14px', outline: 'none' }
const addBtn = { width: 52, flexShrink: 0, fontSize: 24, background: ACCENT, border: 'none', borderRadius: 8, color: '#0f0f0f', fontWeight: 700, cursor: 'pointer' }

function Row({ it, onToggle, onDel }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 6px', borderBottom: '1px solid var(--border-color,#1f1f1f)' }}>
      <button onClick={() => onToggle(it)} title="got it"
        style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 7, border: `2px solid ${it.got ? ACCENT : 'var(--border-color,#555)'}`, background: it.got ? ACCENT : 'none', color: '#0f0f0f', cursor: 'pointer', fontSize: 17, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {it.got ? '✓' : ''}
      </button>
      <span style={{ flex: 1, fontSize: 16, color: it.got ? 'var(--text-tertiary,#666)' : 'var(--text-primary,#e8e6e0)', textDecoration: it.got ? 'line-through' : 'none' }}>{it.name}</span>
      <button onClick={() => onDel(it)} title="remove" style={{ background: 'none', border: 'none', color: 'var(--text-tertiary,#666)', fontSize: 18, cursor: 'pointer', padding: '4px 8px' }}>✕</button>
    </div>
  )
}

export default function GroceriesPage() {
  const [items, setItems] = useState([])
  const [text, setText]   = useState('')

  const load = () => api.get('/groceries').then(setItems).catch(() => {})
  useEffect(() => { load() }, [])

  const addName = async (name) => { const n = (name || '').trim(); if (!n) return; try { await api.post('/groceries', { name: n }); setText(''); load() } catch {} }
  const add = () => addName(text)
  const addProduct = (p) => addName(p.name)
  const toggle = async (it) => { try { await api.patch(`/groceries/${it.id}`, { got: !it.got }); load() } catch {} }
  const del    = async (it) => { try { await api.del(`/groceries/${it.id}`); load() } catch {} }
  const clearGot = async () => { try { await api.post('/groceries/clear-got'); load() } catch {} }

  const need = items.filter(i => !i.got)
  const got  = items.filter(i => i.got)

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 24, fontWeight: 700, letterSpacing: '0.05em' }}>🛒 Groceries</div>
        {got.length > 0 && <button onClick={clearGot} style={{ background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '6px 12px', cursor: 'pointer' }}>Clear got ({got.length})</button>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <SuggestInput wrapStyle={{ flex: 1 }} style={inp} accent={ACCENT} placeholder="Add an item… (or scan / search)"
          value={text} onChange={setText} onEnter={add} onPick={addProduct} />
        <button style={addBtn} onClick={add}>+</button>
      </div>

      <div className="groc-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <style>{`.groc-scroll::-webkit-scrollbar{display:none}.groc-scroll{scrollbar-width:none}`}</style>
        {items.length === 0 && <div style={{ color: 'var(--text-tertiary,#666)', fontSize: 14, textAlign: 'center', marginTop: 48 }}>List's empty 🧺</div>}
        {need.map(it => <Row key={it.id} it={it} onToggle={toggle} onDel={del} />)}
        {got.length > 0 && <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#555)', margin: '20px 0 6px' }}>Got</div>}
        {got.map(it => <Row key={it.id} it={it} onToggle={toggle} onDel={del} />)}
      </div>
    </div>
  )
}
