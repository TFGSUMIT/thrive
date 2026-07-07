// =============================================================================
// SuggestInput — the add box, but it suggests products from Open Food Facts as
// you type (debounced dropdown), and — on a phone/webcam — scans a barcode with
// the camera (📷). Reused by Groceries & Pantry. No separate panel: type a name
// → pick a suggestion, Enter to add what you typed, or scan a barcode to add the
// product. Backed by the shared /groceries/search + /groceries/lookup endpoints.
// Camera scanning uses the native BarcodeDetector API (needs HTTPS + a supporting
// browser, e.g. Android Chrome); the 📷 only appears when it's available.
// =============================================================================
import { useState, useEffect, useRef } from 'react'
import { api } from '@trunk/api'

const isBarcode = (s) => { const d = s.replace(/\D/g, ''); return !/[a-z]/i.test(s) && d.length >= 8 && d.length <= 14 }
const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia

const scanBtn = { width: 46, flexShrink: 0, fontSize: 19, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 8, color: 'inherit', cursor: 'pointer' }

export default function SuggestInput({ value, onChange, onEnter, onPick, style, wrapStyle, placeholder, accent = '#f59e0b', enabled = true }) {
  const [sug, setSug]   = useState([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [note, setNote] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const box   = useRef(null)
  const timer = useRef(null)
  const seq   = useRef(0)

  const flash = (m) => { setNote(m); clearTimeout(flash._t); flash._t = setTimeout(() => setNote(''), 3500) }

  // live, debounced suggestions as you type; barcodes wait for Enter/scan
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

  useEffect(() => {
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const pick = (p) => { onPick(p); setPicked(s => new Set(s).add(p.name || p.barcode)); setSug([]); setOpen(false) }

  const lookupBarcode = async (code) => {
    try {
      const r = await api.get(`/groceries/lookup/${code.replace(/\D/g, '')}`)
      if (r.found) { pick(r); onChange(''); flash(`Added ${r.name}`) }
      else { onChange(code); flash(`No product for ${code}`) }
    } catch { onChange(code); flash('Lookup unavailable') }
  }

  const onKey = async (e) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key !== 'Enter') return
    const term = (value || '').trim(); if (!term) return
    clearTimeout(timer.current); setOpen(false)
    if (enabled && isBarcode(term)) lookupBarcode(term)
    else onEnter()
  }

  const onScan = (code) => { setScanning(false); lookupBarcode(code) }

  return (
    <div ref={box} style={{ position: 'relative', display: 'flex', gap: 6, ...wrapStyle }}>
      <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <input style={{ ...style, width: '100%', boxSizing: 'border-box' }} value={value} placeholder={placeholder} autoComplete="off"
          onChange={e => onChange(e.target.value)} onKeyDown={onKey}
          onFocus={() => sug.length && setOpen(true)} />
        {busy && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--text-tertiary,#666)' }}>…</span>}
      </div>
      {canScan && enabled && <button type="button" title="scan a barcode" onClick={() => setScanning(true)} style={scanBtn}>📷</button>}

      {note && <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, fontSize: 12, color: 'var(--text-secondary,#aaa)', zIndex: 55 }}>{note}</div>}
      {open && sug.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 60, maxHeight: 280, overflowY: 'auto', background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          {sug.map((p, i) => <Suggestion key={p.barcode || i} p={p} accent={accent} onClick={() => pick(p)} />)}
        </div>
      )}
      {scanning && <ScannerOverlay accent={accent} onDetect={onScan} onClose={() => setScanning(false)} />}
    </div>
  )
}

function Suggestion({ p, accent, onClick }) {
  const [imgOk, setImgOk] = useState(true)
  const [hov, setHov] = useState(false)
  const sub = [
    p.brand && p.brand.toLowerCase() !== (p.name || '').toLowerCase() ? p.brand : null,
    p.category, p.quantity,
  ].filter(Boolean).join(' · ')
  return (
    <div onMouseDown={e => { e.preventDefault(); onClick() }} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px', cursor: 'pointer', background: hov ? 'var(--bg-tertiary,#222)' : 'transparent', borderBottom: '1px solid var(--border-color,#222)' }}>
      <div style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 7, background: 'var(--bg-primary,#0f0f0f)', border: '1px solid var(--border-color,#2a2a2a)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', fontSize: 15 }}>
        {p.image && imgOk ? <img src={p.image} alt="" onError={() => setImgOk(false)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🛒'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: 'var(--text-primary,#e8e6e0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-tertiary,#666)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
      </div>
      <span style={{ flexShrink: 0, color: accent, fontSize: 16 }}>+</span>
    </div>
  )
}

// Full-screen live camera scanner using the native BarcodeDetector API.
function ScannerOverlay({ accent, onDetect, onClose }) {
  const videoRef = useRef(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let stream, raf, cancelled = false, fired = false
    const stop = () => { cancelled = true; if (raf) cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t => t.stop()) }
    ;(async () => {
      let detector
      try { detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] }) }
      catch { setErr('Scanning not supported on this browser.'); return }
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } }) }
      catch (e) { setErr(e?.name === 'NotAllowedError' ? 'Camera permission denied.' : 'Camera unavailable (needs HTTPS).'); return }
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
      const v = videoRef.current
      v.srcObject = stream; await v.play().catch(() => {})
      const tick = async () => {
        if (cancelled || fired) return
        try { const codes = await detector.detect(v); if (codes?.length) { fired = true; onDetect(codes[0].rawValue); return } }
        catch { /* frame not ready */ }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    })()
    return stop
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000' }}>
      <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div style={{ width: '72%', maxWidth: 340, aspectRatio: '1.6', border: `2px solid ${accent}`, borderRadius: 12, boxShadow: '0 0 0 100vmax rgba(0,0,0,0.45)' }} />
      </div>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span style={{ color: '#fff', fontFamily: 'monospace', fontSize: 13, textShadow: '0 1px 3px #000' }}>{err || 'Point at a barcode'}</span>
        <button onClick={onClose} style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid #fff', color: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: 14, cursor: 'pointer', flexShrink: 0 }}>Cancel</button>
      </div>
    </div>
  )
}
