// =============================================================================
// ProductLookup — an Open Food Facts lookup panel, reused by Groceries & Pantry.
// Backed by the groceries module's /groceries/search + /groceries/lookup (shared
// cache). Name search runs LIVE as you type (debounced); a barcode — e.g. a USB
// scanner that types the digits + Enter — fires on Enter. onPick(product) is
// called when a result's Add is tapped; the panel tracks what's been picked.
// =============================================================================
import { useState, useEffect, useRef } from 'react'
import { api } from '@trunk/api'

const inp = { flex: 1, minWidth: 0, fontFamily: 'inherit', fontSize: 16, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 8, color: 'inherit', padding: '12px 14px', outline: 'none' }

const isBarcode = (s) => { const d = s.replace(/\D/g, ''); return !/[a-z]/i.test(s) && d.length >= 8 && d.length <= 14 }

function ResultCard({ p, added, accent, onAdd }) {
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
        style={{ flexShrink: 0, background: added ? 'none' : accent, border: added ? '1px solid var(--border-color,#333)' : 'none', borderRadius: 7, color: added ? 'var(--text-tertiary,#666)' : '#0f0f0f', fontWeight: 700, fontFamily: 'monospace', fontSize: 12, padding: '7px 12px', cursor: added ? 'default' : 'pointer' }}>
        {added ? 'added ✓' : '+ Add'}
      </button>
    </div>
  )
}

export default function ProductLookup({ accent = '#f59e0b', onPick, autoFocus = true }) {
  const [q, setQ]       = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [picked, setPicked]   = useState(() => new Set())
  const ref   = useRef(null)
  const timer = useRef(null)
  const seq   = useRef(0)   // guards against out-of-order live-search responses

  useEffect(() => { if (autoFocus && ref.current) ref.current.focus() }, [autoFocus])

  const run = async (term, kind) => {
    const my = ++seq.current
    setBusy(true); setNote('')
    try {
      if (kind === 'barcode') {
        const r = await api.get(`/groceries/lookup/${term.replace(/\D/g, '')}`)
        if (my !== seq.current) return
        if (r.found) setResults([r]); else { setResults([]); setNote('No product for that barcode.') }
      } else {
        const r = await api.get(`/groceries/search?q=${encodeURIComponent(term)}`)
        if (my !== seq.current) return
        setResults(r.results || [])
        setNote(r.results?.length ? '' : 'No matches.')
      }
    } catch (e) {
      if (my !== seq.current) return
      setResults([])
      setNote(/unreachable/i.test(String(e?.message || e)) ? 'Open Food Facts is unreachable right now.' : 'Lookup failed.')
    } finally { if (my === seq.current) setBusy(false) }
  }

  // live, debounced name search as you type; barcodes wait for Enter (scanner)
  useEffect(() => {
    clearTimeout(timer.current)
    const term = q.trim()
    if (term.length < 2 || isBarcode(term)) { seq.current++; setResults([]); setNote(''); setBusy(false); return }
    timer.current = setTimeout(() => run(term, 'name'), 350)
    return () => clearTimeout(timer.current)
  }, [q])

  const onEnter = () => {
    const term = q.trim(); if (!term) return
    clearTimeout(timer.current)
    run(term, isBarcode(term) ? 'barcode' : 'name')
  }
  const pick = (p) => { onPick(p); setPicked(s => new Set(s).add(p.name || p.barcode)) }

  return (
    <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input ref={ref} style={inp} value={q} placeholder="Scan a barcode or type a product name…" autoComplete="off"
          onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && onEnter()} />
        {busy && <span style={{ fontSize: 16, color: 'var(--text-tertiary,#666)', width: 20, textAlign: 'center' }}>…</span>}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary,#555)', margin: '8px 2px 0', letterSpacing: '0.04em' }}>
        {q.trim() && (isBarcode(q.trim()) ? 'barcode — press Enter' : 'name search') } · via Open Food Facts
      </div>
      {note && <div style={{ fontSize: 13, color: 'var(--text-secondary,#aaa)', marginTop: 10 }}>{note}</div>}
      {results.length > 0 && (
        <div style={{ marginTop: 12, maxHeight: 300, overflowY: 'auto' }}>
          {results.map((p, i) => <ResultCard key={p.barcode || i} p={p} accent={accent} added={picked.has(p.name || p.barcode)} onAdd={pick} />)}
        </div>
      )}
    </div>
  )
}
