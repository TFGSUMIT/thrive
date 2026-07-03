// ChatPage.jsx — simple thrive-native chat with a model switcher. Streams tokens
// from LM Studio via the module's /chat/completions proxy (SSE). Conversation +
// chosen model persist per-device in localStorage. No history sidebar, no RAG —
// that's what brain.nerfarrow.com (open-webui) is for; this is the light one.
import { useState, useEffect, useRef } from 'react'

const MODEL_KEY = 'thrive:chat:model'
const CONV_KEY  = 'thrive:chat:conv'

export default function ChatPage() {
  const [models, setModels]   = useState([])
  const [model, setModel]     = useState(() => localStorage.getItem(MODEL_KEY) || '')
  const [messages, setMessages] = useState(() => {
    try { const c = JSON.parse(localStorage.getItem(CONV_KEY)); return Array.isArray(c) ? c : [] } catch { return [] }
  })
  const [input, setInput]     = useState('')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')
  const scrollRef = useRef(null)
  const abortRef  = useRef(null)

  // load model list
  useEffect(() => {
    fetch('/api/chat/models', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const ms = d.models || []
        setModels(ms)
        if (d.error) setError('Model host unreachable — is LM Studio running?')
        setModel(prev => (prev && ms.includes(prev)) ? prev : (ms[0] || ''))
      })
      .catch(() => setError('Could not reach the model host.'))
  }, [])

  useEffect(() => { if (model) localStorage.setItem(MODEL_KEY, model) }, [model])
  useEffect(() => {
    try { localStorage.setItem(CONV_KEY, JSON.stringify(messages)) } catch {}
    const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || busy || !model) return
    setError('')
    const convo = [...messages, { role: 'user', content: text }]
    setMessages([...convo, { role: 'assistant', content: '' }])
    setInput('')
    setBusy(true)

    try {
      const ctrl = new AbortController(); abortRef.current = ctrl
      const res = await fetch('/api/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ model, messages: convo }), signal: ctrl.signal,
      })
      if (!res.ok || !res.body) { setError(`Chat failed (${res.status}).`); setBusy(false); return }

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = '', acc = ''
      const bump = (t) => setMessages(m => { const n = m.slice(); n[n.length - 1] = { role: 'assistant', content: t }; return n })

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') continue
          try {
            const j = JSON.parse(data)
            if (j.error) { setError(j.error); continue }
            const delta = j.choices?.[0]?.delta?.content
            if (delta) { acc += delta; bump(acc) }
          } catch {}
        }
      }
      if (!acc) setError(prev => prev || 'No response from the model.')
    } catch (e) {
      if (e.name !== 'AbortError') setError('Chat stream interrupted.')
    } finally {
      setBusy(false); abortRef.current = null
    }
  }

  const stop = () => abortRef.current?.abort()
  const newChat = () => { if (busy) return; setMessages([]); setError('') }

  // ── styles ──
  const wrap = { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)', maxWidth: 860, margin: '0 auto', width: '100%' }
  const bar  = { display: 'flex', gap: 10, alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border-color,#2a2a2a)' }
  const sel  = { fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 8, color: 'inherit', padding: '7px 10px', maxWidth: 320 }
  const btnS = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '6px 12px' }

  return (
    <div style={wrap}>
      <div style={bar}>
        <span style={{ fontSize: 18 }}>💬</span>
        <select style={sel} value={model} onChange={e => setModel(e.target.value)} disabled={busy}>
          {models.length === 0 && <option value="">— no models —</option>}
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button style={btnS} onClick={newChat} disabled={busy}>New chat</button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '20px 16px' }}>
        {messages.length === 0 && !error && (
          <div style={{ textAlign: 'center', color: 'var(--text-tertiary,#666)', marginTop: '18vh', fontFamily: 'Space Mono, monospace' }}>
            Ask anything — running locally on {model || 'your model host'}.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 14 }}>
            <div style={{
              maxWidth: '82%', padding: '10px 14px', borderRadius: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              lineHeight: 1.55, fontSize: 15,
              background: m.role === 'user' ? 'var(--accent, #10b981)' : 'var(--bg-secondary,#181818)',
              color: m.role === 'user' ? '#fff' : 'var(--text-primary,#e8e6e0)',
              border: m.role === 'user' ? 'none' : '1px solid var(--border-color,#2a2a2a)',
            }}>
              {m.content || (busy && i === messages.length - 1 ? <span style={{ opacity: 0.5 }}>…</span> : '')}
            </div>
          </div>
        ))}
        {error && <div style={{ color: 'var(--color-danger,#ef4444)', fontSize: 13, textAlign: 'center', marginTop: 10 }}>{error}</div>}
      </div>

      <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderTop: '1px solid var(--border-color,#2a2a2a)', alignItems: 'flex-end' }}>
        <textarea
          value={input} onChange={e => setInput(e.target.value)} rows={1} placeholder="Message…"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          style={{ flex: 1, resize: 'none', fontFamily: 'DM Sans, sans-serif', fontSize: 15, background: 'var(--bg-secondary,#181818)',
            border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, color: 'var(--text-primary,#e8e6e0)',
            padding: '12px 14px', outline: 'none', maxHeight: 160, minHeight: 44, boxSizing: 'border-box' }} />
        {busy
          ? <button style={{ ...btnS, borderColor: 'var(--color-danger,#ef4444)', color: 'var(--color-danger,#ef4444)', padding: '12px 18px' }} onClick={stop}>Stop</button>
          : <button style={{ ...btnS, background: 'var(--accent,#10b981)', color: '#fff', border: 'none', padding: '12px 20px', fontWeight: 600 }} onClick={send} disabled={!model}>Send</button>}
      </div>
    </div>
  )
}
