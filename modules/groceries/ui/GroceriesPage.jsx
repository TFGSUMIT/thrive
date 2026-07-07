// =============================================================================
// GroceriesPage — the shared household shopping list (/groceries). Touch-first:
// big add box, big tap targets. Tap to mark "got", ✕ to remove, "Clear got" to
// sweep checked items after a shop. The 🔍 panel looks products up on Open Food
// Facts — a USB scanner just types the barcode + Enter (auto-detected), or type
// a name to search — and one tap adds the match to the list.
// =============================================================================
import { useState, useEffect, useRef } from 'react'
import { api } from '@trunk/api'

const ACCENT = '#f59e0b'
const wrap   = { maxWidth: 640, margin: '0 auto', padding: '2rem 1.25rem', height: '100vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }
const inp    = { flex: 1, minWidth: 0, fontFamily: 'inherit', fontSize: 16, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 8, color: 'inherit', padding: '12px 14px', outline: 'none' }
const addBtn = { width: 52, flexShrink: 0, fontSize: 24, background: ACCENT, border: 'none', borderRadius: 8, color: '#0f0f0f', fontWeight: 700, cursor: 'pointer' }
const iconBtn = { width: 52, flexShrink: 0, fontSize: 20, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 8, color: 'inherit', cursor: 'pointer' }

const isBarcode = (s) => { const d = s.replace(/\D/g, ''); return !/[a-z]/i.test(s) && d.length >= 8 && d.length <= 14 }

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

function ResultCard({ p, added, onAdd }) {
  const [imgOk, setImgOk] = useState(true)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, borderRadius: 10, background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', marginBottom: 8 }}>
      <div style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 8, background: 'var(--bg-primary,#0f0f0f)', border: '1px solid var(--border-color,#2a2a2a)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', fontSize: 18 }}>
        {p.image && imgOk ? <img src={p.image} alt="" onError={() => setImgOk(false)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🛒'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary,#e8e6e0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary,#666)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[p.brand, p.category].filter(Boolean).join(' · ')}</div>
      </div>
      <button onClick={() => onAdd(p)} disabled={added}
        style={{ flexShrink: 0, background: added ? 'none' : ACCENT, border: added ? '1px solid var(--border-color,#333)' : 'none', borderRadius: 7, color: added ? 'var(--text-tertiary,#666)' : '#0f0f0f', fontWeight: 700, fontFamily: 'monospace', fontSize: 12, padding: '7px 12px', cursor: added ? 'default' : 'pointer' }}>
        {added ? 'added ✓' : '+ Add'}
      </button>
    </div>
  )
}

export default function GroceriesPage() {
  const [items, setItems] = useState([])
  const [text, setText]   = useState('')
  // lookup panel
  const [lookOpen, setLookOpen] = useState(false)
  const [lookText, setLookText] = useState('')
  const [results, setResults]   = useState([])
  const [busy, setBusy]  = useState(false)
  const [note, setNote]  = useState('')
  const [added, setAdded] = useState(() => new Set())
  const lookRef = useRef(null)

  const load = () => api.get('/groceries').then(setItems).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => { if (lookOpen && lookRef.current) lookRef.current.focus() }, [lookOpen])

  const add = async () => { const n = text.trim(); if (!n) return; try { await api.post('/groceries', { name: n }); setText(''); load() } catch {} }
  const toggle = async (it) => { try { await api.patch(`/groceries/${it.id}`, { got: !it.got }); load() } catch {} }
  const del    = async (it) => { try { await api.del(`/groceries/${it.id}`); load() } catch {} }
  const clearGot = async () => { try { await api.post('/groceries/clear-got'); load() } catch {} }

  const doLookup = async () => {
    const q = lookText.trim(); if (!q) return
    setBusy(true); setNote(''); setResults([]); setAdded(new Set())
    try {
      if (isBarcode(q)) {
        const r = await api.get(`/groceries/lookup/${q.replace(/\D/g, '')}`)
        if (r.found) setResults([r]); else setNote('No product for that barcode.')
      } else {
        const r = await api.get(`/groceries/search?q=${encodeURIComponent(q)}`)
        setResults(r.results || [])
        if (!r.results?.length) setNote('No matches.')
      }
    } catch (e) {
      setNote(/unreachable/i.test(String(e?.message || e)) ? 'Open Food Facts is unreachable right now.' : 'Lookup failed.')
    } finally { setBusy(false) }
  }

  const addResult = async (p) => {
    try { await api.post('/groceries', { name: p.name }); setAdded(s => new Set(s).add(p.name || p.barcode)); load() } catch {}
  }

  const need = items.filter(i => !i.got)
  const got  = items.filter(i => i.got)

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 24, fontWeight: 700, letterSpacing: '0.05em' }}>🛒 Groceries</div>
        {got.length > 0 && <button onClick={clearGot} style={{ background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '6px 12px', cursor: 'pointer' }}>Clear got ({got.length})</button>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: lookOpen ? 10 : 14 }}>
        <input style={inp} value={text} placeholder="Add an item…" autoComplete="off"
          onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <button style={lookOpen ? { ...iconBtn, borderColor: ACCENT, color: ACCENT } : iconBtn} title="look up a product" onClick={() => setLookOpen(o => !o)}>🔍</button>
        <button style={addBtn} onClick={add}>+</button>
      </div>

      {lookOpen && (
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input ref={lookRef} style={inp} value={lookText} placeholder="Scan a barcode or type a product name…" autoComplete="off"
              onChange={e => setLookText(e.target.value)} onKeyDown={e => e.key === 'Enter' && doLookup()} />
            <button style={{ ...addBtn, background: busy ? 'var(--bg-tertiary,#222)' : ACCENT, color: busy ? 'var(--text-tertiary,#666)' : '#0f0f0f' }} onClick={doLookup} disabled={busy}>{busy ? '…' : '→'}</button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary,#555)', margin: '8px 2px 0', letterSpacing: '0.04em' }}>
            {lookText && (isBarcode(lookText) ? 'barcode lookup' : 'name search')} · via Open Food Facts
          </div>
          {note && <div style={{ fontSize: 13, color: 'var(--text-secondary,#aaa)', marginTop: 10 }}>{note}</div>}
          {results.length > 0 && (
            <div style={{ marginTop: 12, maxHeight: 260, overflowY: 'auto' }}>
              {results.map((p, i) => <ResultCard key={p.barcode || i} p={p} added={added.has(p.name || p.barcode)} onAdd={addResult} />)}
            </div>
          )}
        </div>
      )}

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
