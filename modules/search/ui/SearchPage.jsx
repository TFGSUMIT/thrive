// SearchPage.jsx — private metasearch, rendered natively in thrive's aesthetic.
// Talks to SearXNG's JSON API through nginx (/search/search?format=json), which
// is gated behind login (nginx auth_request). No iframe — results are our own DOM.
import { useState, useRef } from 'react'

const CATEGORIES = [
  { id: 'general', label: 'Web' },
  { id: 'news',    label: 'News' },
  { id: 'science', label: 'Science' },
  { id: 'it',      label: 'Tech' },
]

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

export default function SearchPage() {
  const [q, setQ]           = useState('')
  const [cat, setCat]       = useState('general')
  const [results, setResults] = useState(null)   // null = nothing searched yet
  const [suggest, setSuggest] = useState([])
  const [loading, setLoading] = useState(false)
  const [more, setMore]     = useState(false)
  const [error, setError]   = useState('')
  const pageRef = useRef(1)
  const lastRef = useRef({ q: '', cat: 'general' })

  const run = async (query, category, pageno, append) => {
    setError('')
    append ? setMore(true) : setLoading(true)
    try {
      const params = new URLSearchParams({ q: query, format: 'json', pageno: String(pageno), categories: category })
      const res = await fetch(`/search/search?${params.toString()}`, { credentials: 'include' })
      if (res.status === 401) { setError('Your session expired — sign in again.'); return }
      if (!res.ok) throw new Error(`search failed (${res.status})`)
      const data = await res.json()
      setResults(prev => append && prev ? [...prev, ...(data.results || [])] : (data.results || []))
      setSuggest(data.suggestions || [])
    } catch (e) {
      if (!append) setResults([])
      setError('Search is unavailable right now. Is the search service running?')
    } finally {
      setLoading(false); setMore(false)
    }
  }

  const search = (query = q, category = cat) => {
    const term = query.trim()
    if (!term) return
    pageRef.current = 1
    lastRef.current = { q: term, cat: category }
    run(term, category, 1, false)
  }
  const loadMore = () => { pageRef.current += 1; run(lastRef.current.q, lastRef.current.cat, pageRef.current, true) }
  const pickCat = (id) => { setCat(id); if (results !== null) search(q, id) }

  const hero = results === null && !loading
  const box = {
    display: 'flex', gap: 8, width: '100%', maxWidth: 640,
  }
  const input = {
    flex: 1, fontFamily: 'DM Sans, sans-serif', fontSize: 16, background: 'var(--bg-secondary,#181818)',
    border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, color: 'var(--text-primary,#e8e6e0)',
    padding: '12px 16px', outline: 'none', boxSizing: 'border-box',
  }
  const goBtn = {
    fontFamily: 'monospace', fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase',
    background: 'var(--accent, #8b5cf6)', border: 'none', borderRadius: 10, color: '#fff',
    padding: '0 20px', cursor: 'pointer', fontWeight: 600,
  }
  const catChip = (on) => ({
    fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
    background: 'none', border: `1px solid ${on ? 'var(--accent,#8b5cf6)' : 'var(--border-color,#333)'}`,
    borderRadius: 20, color: on ? 'var(--accent,#8b5cf6)' : 'var(--text-secondary,#aaa)',
    padding: '5px 14px', cursor: 'pointer',
  })

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 20px 60px', minHeight: '80vh',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: hero ? 'center' : 'flex-start', paddingTop: hero ? 0 : 40 }}>

      {hero && (
        <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 22, letterSpacing: '0.04em',
          color: 'var(--text-secondary,#aaa)', marginBottom: 22 }}>
          🔍 search
        </div>
      )}

      <div style={box}>
        <input style={input} value={q} autoFocus placeholder="Search the web…"
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') search() }} />
        <button style={goBtn} onClick={() => search()}>Go</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
        {CATEGORIES.map(c => (
          <button key={c.id} style={catChip(cat === c.id)} onClick={() => pickCat(c.id)}>{c.label}</button>
        ))}
      </div>

      {error && <div style={{ marginTop: 24, color: 'var(--color-danger,#ef4444)', fontSize: 14 }}>{error}</div>}
      {loading && <div style={{ marginTop: 40, color: 'var(--text-tertiary,#666)', fontFamily: 'monospace' }}>searching…</div>}

      {results !== null && !loading && (
        <div style={{ width: '100%', marginTop: 28 }}>
          {results.length === 0 && !error && (
            <div style={{ color: 'var(--text-tertiary,#666)', textAlign: 'center', marginTop: 20 }}>No results.</div>
          )}

          {suggest.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary,#666)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Try:</span>
              {suggest.slice(0, 6).map(s => (
                <button key={s} onClick={() => { setQ(s); search(s) }}
                  style={{ background: 'none', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 6,
                    color: 'var(--text-secondary,#aaa)', padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}>{s}</button>
              ))}
            </div>
          )}

          {results.map((r, i) => (
            <div key={`${r.url}-${i}`} style={{ marginBottom: 22, paddingBottom: 20, borderBottom: '1px solid var(--border-color,#1e1e1e)' }}>
              <div style={{ fontSize: 12, color: 'var(--color-success,#22c55e)', fontFamily: 'monospace', marginBottom: 3 }}>
                {hostOf(r.url)}
              </div>
              <a href={r.url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 18, color: 'var(--text-primary,#e8e6e0)', textDecoration: 'none', fontFamily: 'DM Sans, sans-serif', lineHeight: 1.3 }}
                onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                {r.title}
              </a>
              {r.content && (
                <div style={{ fontSize: 14, color: 'var(--text-secondary,#aaa)', marginTop: 5, lineHeight: 1.5 }}>{r.content}</div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
                {(r.engines || [r.engine]).filter(Boolean).slice(0, 4).map(e => (
                  <span key={e} style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em',
                    color: 'var(--text-tertiary,#666)', border: '1px solid var(--border-color,#222)', borderRadius: 4, padding: '1px 6px' }}>{e}</span>
                ))}
              </div>
            </div>
          ))}

          {results.length > 0 && (
            <div style={{ textAlign: 'center', marginTop: 10 }}>
              <button onClick={loadMore} disabled={more}
                style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase',
                  background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 8,
                  color: 'var(--text-secondary,#aaa)', padding: '10px 22px', cursor: more ? 'default' : 'pointer', opacity: more ? 0.5 : 1 }}>
                {more ? 'loading…' : 'More results'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
