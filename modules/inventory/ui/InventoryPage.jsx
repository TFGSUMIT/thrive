// =============================================================================
// InventoryPage — a home inventory of possessions (/inventory). Quick-add by
// name, then expand a row to fill in room, category, value, serial, purchase &
// warranty dates, and notes. Grouped by room; header shows item count + total
// value; a warranty badge warns when cover is near or past expiry.
// =============================================================================
import { useState, useEffect } from 'react'
import { api } from '@trunk/api'

const ACCENT = '#a855f7'
const wrap = { maxWidth: 760, margin: '0 auto', padding: '2rem 1.25rem', height: '100vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }
const inp  = { fontFamily: 'inherit', fontSize: 15, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 8, color: 'inherit', padding: '10px 12px', outline: 'none', boxSizing: 'border-box' }
const lbl  = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary,#666)', marginBottom: 4, display: 'block' }

const money = (c) => c == null ? '' : '$' + (c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const parseDay = (s) => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return (y && m && d) ? new Date(y, m - 1, d) : null }
const daysLeft = (s) => { const d = parseDay(s); if (!d) return null; const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((d - t) / 86400000) }

function Warranty({ s }) {
  const n = daysLeft(s)
  if (n == null) return null
  const color = n < 0 ? 'var(--color-danger,#ef4444)' : n <= 30 ? '#f59e0b' : 'var(--text-tertiary,#666)'
  const label = n < 0 ? 'warranty expired' : n === 0 ? 'warranty ends today' : `warranty ${n}d`
  return <span style={{ fontSize: 11, color, border: `1px solid ${color}`, borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap' }}>🛡 {label}</span>
}

function Editor({ it, onSave, onDel }) {
  const [f, setF] = useState({
    category: it.category || '', location: it.location || '', serial: it.serial || '',
    purchase_date: it.purchase_date || '', warranty_until: it.warranty_until || '', notes: it.notes || '',
    price: it.price_cents != null ? (it.price_cents / 100).toString() : '',
  })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = () => {
    const patch = {
      category: f.category, location: f.location, serial: f.serial,
      purchase_date: f.purchase_date, warranty_until: f.warranty_until, notes: f.notes,
    }
    const p = f.price.trim()
    if (p !== '') { const c = Math.round(parseFloat(p) * 100); if (!isNaN(c)) patch.price_cents = c }
    onSave(patch)
  }
  const Field = ({ k, label, ph, w }) => (
    <div style={{ flex: w || '1 1 140px' }}>
      <label style={lbl}>{label}</label>
      <input style={{ ...inp, width: '100%' }} value={f[k]} placeholder={ph} onChange={set(k)} autoComplete="off" />
    </div>
  )
  return (
    <div style={{ padding: '12px 6px 16px', borderBottom: '1px solid var(--border-color,#1f1f1f)', background: 'var(--bg-secondary,#141414)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <Field k="location" label="Room" ph="Living room" />
        <Field k="category" label="Category" ph="Electronics" />
        <div style={{ flex: '0 1 120px' }}>
          <label style={lbl}>Value ($)</label>
          <input style={{ ...inp, width: '100%' }} value={f.price} placeholder="0.00" inputMode="decimal" onChange={set('price')} autoComplete="off" />
        </div>
        <Field k="serial" label="Serial #" ph="SN-…" />
        <div style={{ flex: '1 1 130px' }}>
          <label style={lbl}>Purchased</label>
          <input style={{ ...inp, width: '100%' }} type="date" value={f.purchase_date} onChange={set('purchase_date')} />
        </div>
        <div style={{ flex: '1 1 130px' }}>
          <label style={lbl}>Warranty until</label>
          <input style={{ ...inp, width: '100%' }} type="date" value={f.warranty_until} onChange={set('warranty_until')} />
        </div>
        <div style={{ flex: '1 1 100%' }}>
          <label style={lbl}>Notes</label>
          <input style={{ ...inp, width: '100%' }} value={f.notes} placeholder="Anything worth remembering…" onChange={set('notes')} autoComplete="off" />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        <button onClick={onDel} style={{ background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--color-danger,#ef4444)', fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '7px 12px', cursor: 'pointer' }}>Delete</button>
        <button onClick={save} style={{ background: ACCENT, border: 'none', borderRadius: 6, color: '#0f0f0f', fontWeight: 700, fontFamily: 'monospace', fontSize: 12, padding: '7px 16px', cursor: 'pointer' }}>Save</button>
      </div>
    </div>
  )
}

function Row({ it, open, onToggle, onSave, onDel }) {
  return (
    <div>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 6px', borderBottom: open ? 'none' : '1px solid var(--border-color,#1f1f1f)', cursor: 'pointer' }}>
        <span style={{ color: 'var(--text-tertiary,#666)', fontSize: 12, width: 12, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, color: 'var(--text-primary,#e8e6e0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
          {it.category && <div style={{ fontSize: 11, color: 'var(--text-tertiary,#666)' }}>{it.category}</div>}
        </div>
        {it.warranty_until && <Warranty s={it.warranty_until} />}
        {it.price_cents != null && <span style={{ fontSize: 14, color: 'var(--text-secondary,#aaa)', fontFamily: 'monospace', flexShrink: 0 }}>{money(it.price_cents)}</span>}
      </div>
      {open && <Editor it={it} onSave={onSave} onDel={onDel} />}
    </div>
  )
}

export default function InventoryPage() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [name, setName]   = useState('')
  const [openId, setOpenId] = useState(null)

  const load = () => api.get('/inventory').then(d => { setItems(d.items || []); setTotal(d.total_cents || 0) }).catch(() => {})
  useEffect(() => { load() }, [])

  const add = async () => { const n = name.trim(); if (!n) return; try { const it = await api.post('/inventory', { name: n }); setName(''); await load(); setOpenId(it.id) } catch {} }
  const save = async (id, patch) => { try { await api.patch(`/inventory/${id}`, patch); setOpenId(null); load() } catch {} }
  const del  = async (id) => { try { await api.del(`/inventory/${id}`); setOpenId(null); load() } catch {} }

  // group by room (location); null → Unsorted, kept last
  const groups = []
  for (const it of items) {
    const room = it.location || 'Unsorted'
    const g = groups.length && groups[groups.length - 1].room === room ? groups[groups.length - 1] : (groups.push({ room, rows: [] }), groups[groups.length - 1])
    g.rows.push(it)
  }

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 24, fontWeight: 700, letterSpacing: '0.05em' }}>📦 Inventory</div>
        {items.length > 0 && <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-secondary,#aaa)' }}>{items.length} item{items.length !== 1 ? 's' : ''} · <span style={{ color: ACCENT }}>{money(total)}</span></span>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input style={{ ...inp, flex: 1, fontSize: 16, padding: '12px 14px' }} value={name} placeholder="Add an item…" autoComplete="off"
          onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <button style={{ width: 52, flexShrink: 0, fontSize: 24, background: ACCENT, border: 'none', borderRadius: 8, color: '#0f0f0f', fontWeight: 700, cursor: 'pointer' }} onClick={add}>+</button>
      </div>

      <div className="inv-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <style>{`.inv-scroll::-webkit-scrollbar{display:none}.inv-scroll{scrollbar-width:none}`}</style>
        {items.length === 0 && <div style={{ color: 'var(--text-tertiary,#666)', fontSize: 14, textAlign: 'center', marginTop: 48 }}>Nothing catalogued yet 📦</div>}
        {groups.map(g => (
          <div key={g.room}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#555)', margin: '18px 0 4px' }}>{g.room}</div>
            {g.rows.map(it => (
              <Row key={it.id} it={it} open={openId === it.id}
                onToggle={() => setOpenId(openId === it.id ? null : it.id)}
                onSave={(patch) => save(it.id, patch)} onDel={() => del(it.id)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
