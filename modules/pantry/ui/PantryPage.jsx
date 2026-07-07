// =============================================================================
// PantryPage — what's on hand (/pantry). Touch-first: add an item to the fridge,
// freezer, or pantry; bump its quantity with ± steppers; see a use-by badge that
// warns when something's expiring or expired. When the Groceries module is
// active, each row gets a 🛒 to drop that item onto the shopping list.
// =============================================================================
import { useState, useEffect } from 'react'
import { api } from '@trunk/api'
import SuggestInput from './SuggestInput'

const ACCENT = '#14b8a6'
const LOCS = [
  { id: 'fridge',  label: 'Fridge',  icon: '🧊' },
  { id: 'freezer', label: 'Freezer', icon: '❄️' },
  { id: 'pantry',  label: 'Pantry',  icon: '🥫' },
]
const locMeta = (id) => LOCS.find(l => l.id === id) || LOCS[2]

const wrap = { maxWidth: 680, margin: '0 auto', padding: '2rem 1.25rem', height: '100vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }
const inp  = { fontFamily: 'inherit', fontSize: 15, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 8, color: 'inherit', padding: '11px 12px', outline: 'none' }
const chip = { background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 11px', cursor: 'pointer' }
const step = { width: 30, height: 30, flexShrink: 0, borderRadius: 7, border: '1px solid var(--border-color,#444)', background: 'var(--bg-tertiary,#222)', color: 'var(--text-primary,#e8e6e0)', fontSize: 18, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }

// expires_on is a bare date; parse as LOCAL midnight so day-diff is timezone-sane
const parseDay = (s) => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return (y && m && d) ? new Date(y, m - 1, d) : null }
const daysLeft = (s) => { const d = parseDay(s); if (!d) return null; const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((d - t) / 86400000) }
const expiryLabel = (n) => n == null ? '' : n < 0 ? `${-n}d ago` : n === 0 ? 'today' : n === 1 ? 'tomorrow' : `${n}d`
const fmtQty = (q) => Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100)

function ExpiryBadge({ s }) {
  const n = daysLeft(s)
  if (n == null) return null
  const color = n < 0 ? 'var(--color-danger,#ef4444)' : n <= 3 ? '#f59e0b' : 'var(--text-tertiary,#666)'
  return <span style={{ fontSize: 11, color, border: `1px solid ${color}`, borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap' }}>⌛ {expiryLabel(n)}</span>
}

function Row({ it, onQty, onRename, onExpiry, onLoc, onCart, onDel }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 4px', borderBottom: '1px solid var(--border-color,#1f1f1f)' }}>
      <button onClick={() => onLoc(it)} title="move" style={{ background: 'none', border: 'none', fontSize: 17, cursor: 'pointer', flexShrink: 0 }}>{locMeta(it.location).icon}</button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <button onClick={() => onRename(it)} title="rename" style={{ background: 'none', border: 'none', color: 'var(--text-primary,#e8e6e0)', fontSize: 15, cursor: 'pointer', padding: 0, textAlign: 'left', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 3 }}>
          <button onClick={() => onExpiry(it)} title="set use-by" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            {it.expires_on ? <ExpiryBadge s={it.expires_on} /> : <span style={{ fontSize: 11, color: 'var(--text-tertiary,#555)' }}>+ use-by</span>}
          </button>
        </div>
      </div>
      <button style={step} onClick={() => onQty(it, -1)} title="less">−</button>
      <span style={{ minWidth: 42, textAlign: 'center', fontSize: 14, color: 'var(--text-secondary,#aaa)' }}>{fmtQty(it.qty)}{it.unit ? ` ${it.unit}` : ''}</span>
      <button style={step} onClick={() => onQty(it, 1)} title="more">+</button>
      {onCart && <button onClick={() => onCart(it)} title="add to groceries" style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', padding: '4px 4px' }}>🛒</button>}
      <button onClick={() => onDel(it)} title="remove" style={{ background: 'none', border: 'none', color: 'var(--text-tertiary,#666)', fontSize: 17, cursor: 'pointer', padding: '4px 6px' }}>✕</button>
    </div>
  )
}

export default function PantryPage() {
  const [items, setItems] = useState([])
  const [name, setName]   = useState('')
  const [loc, setLoc]     = useState('fridge')
  const [filter, setFilter] = useState('all')
  const [groceries, setGroceries] = useState(false)  // groceries module active?
  const [flash, setFlash] = useState(null)

  const load = () => api.get('/pantry').then(setItems).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => {
    // feature-detect the Groceries module (optional companion) — same pattern as vehicles→mpg
    api.get('/modules').then(ms => setGroceries(Array.isArray(ms) && ms.some(m => m.id === 'groceries' && m.installed && m.enabled))).catch(() => {})
  }, [])

  const add = async () => { const n = name.trim(); if (!n) return; try { await api.post('/pantry', { name: n, location: loc }); setName(''); load() } catch {} }
  const qty = async (it, d) => { const next = Math.max(0, (it.qty || 0) + d); try { await api.patch(`/pantry/${it.id}`, { qty: next }); load() } catch {} }
  const rename = async (it) => { const n = prompt('Rename item', it.name); if (n == null) return; try { await api.patch(`/pantry/${it.id}`, { name: n }); load() } catch {} }
  const expiry = async (it) => { const v = prompt('Use-by date (YYYY-MM-DD, blank to clear)', it.expires_on || ''); if (v == null) return; try { await api.patch(`/pantry/${it.id}`, { expires_on: v.trim() }); load() } catch {} }
  const move = async (it) => { const order = ['fridge', 'freezer', 'pantry']; const next = order[(order.indexOf(it.location) + 1) % 3]; try { await api.patch(`/pantry/${it.id}`, { location: next }); load() } catch {} }
  const del = async (it) => { try { await api.del(`/pantry/${it.id}`); load() } catch {} }
  const cart = async (it) => { try { await api.post('/groceries', { name: it.name }); setFlash(it.id); setTimeout(() => setFlash(null), 1200) } catch {} }
  const addProduct = async (p) => { try { await api.post('/pantry', { name: p.name, location: loc }); load() } catch {} }

  const shown = filter === 'all' ? items : items.filter(i => i.location === filter)
  const groups = filter === 'all'
    ? LOCS.map(l => ({ ...l, rows: items.filter(i => i.location === l.id) })).filter(g => g.rows.length)
    : [{ ...locMeta(filter), rows: shown }]

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 24, fontWeight: 700, letterSpacing: '0.05em' }}>🥫 Pantry</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['all', ...LOCS.map(l => l.id)].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              style={filter === f ? { ...chip, color: ACCENT, borderColor: ACCENT } : chip}>
              {f === 'all' ? 'All' : locMeta(f).icon}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <SuggestInput wrapStyle={{ flex: '2 1 180px' }} style={inp} accent={ACCENT} enabled={groceries}
          placeholder={groceries ? 'Add an item… (or scan / search)' : 'Add an item…'}
          value={name} onChange={setName} onEnter={add} onPick={addProduct} />
        <select style={{ ...inp, flex: '1 1 110px' }} value={loc} onChange={e => setLoc(e.target.value)}>
          {LOCS.map(l => <option key={l.id} value={l.id}>{l.icon} {l.label}</option>)}
        </select>
        <button style={{ width: 52, flexShrink: 0, fontSize: 24, background: ACCENT, border: 'none', borderRadius: 8, color: '#0f0f0f', fontWeight: 700, cursor: 'pointer' }} onClick={add}>+</button>
      </div>

      <div className="pantry-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <style>{`.pantry-scroll::-webkit-scrollbar{display:none}.pantry-scroll{scrollbar-width:none}`}</style>
        {items.length === 0 && <div style={{ color: 'var(--text-tertiary,#666)', fontSize: 14, textAlign: 'center', marginTop: 48 }}>Nothing stocked yet 🧺</div>}
        {groups.map(g => (
          <div key={g.id}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#555)', margin: '18px 0 4px' }}>{g.icon} {g.label}</div>
            {g.rows.map(it => (
              <div key={it.id} style={{ position: 'relative' }}>
                <Row it={it} onQty={qty} onRename={rename} onExpiry={expiry} onLoc={move}
                  onCart={groceries ? cart : null} onDel={del} />
                {flash === it.id && <span style={{ position: 'absolute', right: 40, top: 12, fontSize: 11, color: ACCENT }}>→ list ✓</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
