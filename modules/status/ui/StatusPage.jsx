// =============================================================================
// StatusPage — up/down monitor (/status). Add HTTP or TCP checks for your
// services and equipment; the page probes them live and auto-refreshes. A green
// dot = reachable (with latency), red = down (with the reason).
// =============================================================================
import { useState, useEffect, useRef } from 'react'
import { api } from '@trunk/api'

const UP = '#22c55e', DOWN = '#ef4444', ACCENT = '#10b981'
const REFRESH_MS = 15000

const wrap = { maxWidth: 720, margin: '0 auto', padding: '2rem 1.25rem', height: '100vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }
const inp  = { fontFamily: 'inherit', fontSize: 15, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 8, color: 'inherit', padding: '11px 12px', outline: 'none' }
const chip = { background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 11px', cursor: 'pointer' }

function CheckRow({ c, onDel }) {
  const up = c.up === true
  const color = c.up == null ? 'var(--text-tertiary,#666)' : up ? UP : DOWN
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 6px', borderBottom: '1px solid var(--border-color,#1f1f1f)' }}>
      <span style={{ width: 11, height: 11, flexShrink: 0, borderRadius: '50%', background: color, boxShadow: c.up != null ? `0 0 8px ${color}` : 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, color: 'var(--text-primary,#e8e6e0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary,#666)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>{c.kind}</span> · {c.target}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 13, color, fontFamily: 'monospace' }}>{c.up == null ? '…' : up ? 'UP' : 'DOWN'}</div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary,#666)' }}>{c.latency_ms != null ? `${c.latency_ms} ms` : (c.detail || '')}</div>
      </div>
      <button onClick={() => onDel(c)} title="remove" style={{ background: 'none', border: 'none', color: 'var(--text-tertiary,#666)', fontSize: 17, cursor: 'pointer', padding: '4px 6px' }}>✕</button>
    </div>
  )
}

export default function StatusPage() {
  const [checks, setChecks] = useState([])
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('http')
  const [target, setTarget] = useState('')
  const timer = useRef(null)

  const load = async () => { setBusy(true); try { setChecks(await api.get('/status')) } catch {} finally { setBusy(false) } }
  useEffect(() => {
    load()
    timer.current = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer.current)
  }, [])

  const add = async () => {
    const n = name.trim(), t = target.trim(); if (!n || !t) return
    try { await api.post('/status', { name: n, kind, target: t }); setName(''); setTarget(''); load() } catch {}
  }
  const del = async (c) => { try { await api.del(`/status/${c.id}`); load() } catch {} }

  const upN = checks.filter(c => c.up === true).length
  const downN = checks.filter(c => c.up === false).length

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 24, fontWeight: 700, letterSpacing: '0.05em' }}>📡 Status</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {checks.length > 0 && <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-secondary,#aaa)' }}>
            <span style={{ color: UP }}>{upN} up</span>{downN > 0 && <> · <span style={{ color: DOWN }}>{downN} down</span></>}
          </span>}
          <button onClick={load} style={busy ? { ...chip, color: ACCENT, borderColor: ACCENT } : chip}>{busy ? '…' : 'Refresh'}</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input style={{ ...inp, flex: '2 1 140px' }} value={name} placeholder="Name (e.g. NAS)" autoComplete="off"
          onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <select style={{ ...inp, flex: '0 1 90px' }} value={kind} onChange={e => setKind(e.target.value)}>
          <option value="http">HTTP</option>
          <option value="tcp">TCP</option>
        </select>
        <input style={{ ...inp, flex: '3 1 180px' }} value={target} autoComplete="off"
          placeholder={kind === 'tcp' ? 'host:port (e.g. 192.168.8.191:445)' : 'URL (e.g. nas.local or https://…)'}
          onChange={e => setTarget(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <button style={{ width: 52, flexShrink: 0, fontSize: 24, background: ACCENT, border: 'none', borderRadius: 8, color: '#0f0f0f', fontWeight: 700, cursor: 'pointer' }} onClick={add}>+</button>
      </div>

      <div className="status-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <style>{`.status-scroll::-webkit-scrollbar{display:none}.status-scroll{scrollbar-width:none}`}</style>
        {checks.length === 0 && <div style={{ color: 'var(--text-tertiary,#666)', fontSize: 14, textAlign: 'center', marginTop: 48 }}>No checks yet — add a service or device above 📡</div>}
        {checks.map(c => <CheckRow key={c.id} c={c} onDel={del} />)}
      </div>
    </div>
  )
}
