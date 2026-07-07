// =============================================================================
// SuggestInput — the add box, but it suggests products from Open Food Facts as
// you type (debounced dropdown). Reused by Groceries & Pantry. No separate panel:
// type a name → pick a suggestion, or hit Enter to add exactly what you typed.
// A barcode (a USB scanner types the digits + Enter) resolves to the product.
// Backed by the shared /groceries/search + /groceries/lookup endpoints.
// =============================================================================
import { useState, useEffect, useRef } from 'react'
import { api } from '@trunk/api'

const isBarcode = (s) => { const d = s.replace(/\D/g, ''); return !/[a-z]/i.test(s) && d.length >= 8 && d.length <= 14 }

export default function SuggestInput({ value, onChange, onEnter, onPick, style, wrapStyle, placeholder, accent = '#f59e0b', enabled = true }) {
  const [sug, setSug]   = useState([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const box   = useRef(null)
  const timer = useRef(null)
  const seq   = useRef(0)

  // live, debounced suggestions as you type; barcodes wait for Enter (scanner)
  useEffect(() => {
    clearTimeout(timer.current)
    const term = (value || '').trim()
    if (!enabled || term.length < 2 || isBarcode(term)) { seq.current++; setSug([]); setBusy(false); return }
    setBusy(true)
    timer.current = setTimeout(async () => {
      const my = ++seq.current
      try {
        const r = await api.get(`/groceries/search?q=${encodeURIComponent(term)}`)
        if (my !== seq.current) return
        setSug(r.results || []); setOpen(true)
      } catch { if (my === seq.current) setSug([]) }
      finally { if (my === seq.current) setBusy(false) }
    }, 300)
    return () => clearTimeout(timer.current)
  }, [value, enabled])

  // close the dropdown on an outside click
  useEffect(() => {
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const pick = (p) => { onPick(p); setSug([]); setOpen(false) }

  const onKey = async (e) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key !== 'Enter') return
    const term = (value || '').trim(); if (!term) return
    clearTimeout(timer.current); setOpen(false)
    if (enabled && isBarcode(term)) {
      try { const r = await api.get(`/groceries/lookup/${term.replace(/\D/g, '')}`); r.found ? pick(r) : onEnter() }
      catch { onEnter() }
    } else { onEnter() }
  }

  return (
    <div ref={box} style={{ position: 'relative', ...wrapStyle }}>
      <input style={{ ...style, width: '100%', boxSizing: 'border-box' }} value={value} placeholder={placeholder} autoComplete="off"
        onChange={e => onChange(e.target.value)} onKeyDown={onKey}
        onFocus={() => sug.length && setOpen(true)} />
      {busy && <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--text-tertiary,#666)' }}>…</span>}
      {open && sug.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 60, maxHeight: 280, overflowY: 'auto', background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          {sug.map((p, i) => <Suggestion key={p.barcode || i} p={p} accent={accent} onClick={() => pick(p)} />)}
        </div>
      )}
    </div>
  )
}

function Suggestion({ p, accent, onClick }) {
  const [imgOk, setImgOk] = useState(true)
  const [hov, setHov] = useState(false)
  return (
    <div onMouseDown={e => { e.preventDefault(); onClick() }} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px', cursor: 'pointer', background: hov ? 'var(--bg-tertiary,#222)' : 'transparent', borderBottom: '1px solid var(--border-color,#222)' }}>
      <div style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 7, background: 'var(--bg-primary,#0f0f0f)', border: '1px solid var(--border-color,#2a2a2a)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', fontSize: 15 }}>
        {p.image && imgOk ? <img src={p.image} alt="" onError={() => setImgOk(false)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🛒'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: 'var(--text-primary,#e8e6e0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
        {(p.brand || p.category) && <div style={{ fontSize: 11, color: 'var(--text-tertiary,#666)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[p.brand, p.category].filter(Boolean).join(' · ')}</div>}
      </div>
      <span style={{ flexShrink: 0, color: accent, fontSize: 16 }}>+</span>
    </div>
  )
}
