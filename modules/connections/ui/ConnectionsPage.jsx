// =============================================================================
// ConnectionsPage — manage YOUR external-service logins (Steam, GOG, streaming…).
// Moved out of core Settings into the opt-in Connections module. Secrets are
// stored encrypted server-side; consumer modules read them via crypto.get_secret().
// Only meaningful for a profile-bound login; the shared/kiosk Household identity
// has no personal connections.
// =============================================================================
import { useState, useEffect } from 'react'
import { api } from '@trunk/api'
import { useAuth } from '@trunk/context/AuthContext'

// catalog: maps a provider to the secret fields it needs (3rd item = password input)
const PROVIDERS = {
  steam:     { name: 'Steam',     fields: [['api_key', 'API key'], ['steam_id', 'Steam ID']] },
  gog:       { name: 'GOG',       fields: [['username', 'Username'], ['password', 'Password', true]] },
  google:    { name: 'Google',    fields: [['token', 'OAuth token', true]] },
  microsoft: { name: 'Microsoft', fields: [['token', 'OAuth token', true]] },
  plaid:     { name: 'Plaid',     fields: [['access_token', 'Access token', true]] },
  other:     { name: 'Other',     fields: [['value', 'Secret', true]] },
}

const inp  = { fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '8px 10px', outline: 'none', width: '100%', boxSizing: 'border-box' }
const lbl  = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary,#666)', display: 'block', marginBottom: 4 }
const btnP = { padding: '10px 16px', fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.08em', background: 'var(--text-primary,#e8e6e0)', border: 'none', borderRadius: 6, color: 'var(--bg-primary,#0f0f0f)', fontWeight: 600, cursor: 'pointer' }
const btnS = { padding: '6px 12px', fontFamily: 'monospace', fontSize: 11, background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer' }
const card = { background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 12, padding: 22 }

function Manager() {
  const [conns, setConns]       = useState([])
  const [provider, setProvider] = useState('steam')
  const [label, setLabel]       = useState('')
  const [secret, setSecret]     = useState({})
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState(null)
  const [shared, setShared]     = useState(false)

  const load = () => api.get('/connections/').then(setConns).catch(() => {})
  useEffect(() => { load() }, [])

  const fields = (PROVIDERS[provider] || PROVIDERS.other).fields
  const add = async () => {
    setBusy(true); setErr(null)
    try {
      await api.post('/connections/', { provider, label: label || null, secret, shared })
      setLabel(''); setSecret({}); setShared(false); load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const del = async (id) => { try { await api.del(`/connections/${id}`); load() } catch (e) { setErr(e.message) } }

  return (
    <div style={card}>
      {conns.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary,#666)', marginBottom: 16, lineHeight: 1.5 }}>
          No connections yet. Link an external login below — it's stored encrypted, and only you can see or use it.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {conns.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 6 }}>
              <span style={{ fontSize: 12 }}>
                <b>{(PROVIDERS[c.provider] || {}).name || c.provider}</b>
                {c.label && <span style={{ color: 'var(--text-secondary,#aaa)', marginLeft: 8 }}>{c.label}</span>}
                <span style={{ marginLeft: 8, fontSize: 10, color: c.shared ? '#3b82f6' : 'var(--text-tertiary,#888)' }}>
                  {c.shared ? '🏠 household' : '🔒 personal'}
                </span>
                <span style={{ color: 'var(--color-success,#22c55e)', marginLeft: 6, fontSize: 10 }}>encrypted</span>
              </span>
              <button style={{ ...btnS, padding: '3px 9px', borderColor: 'var(--color-danger,#ef4444)', color: 'var(--color-danger,#ef4444)' }} onClick={() => del(c.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 10px' }}>
        <div>
          <label style={lbl}>Service</label>
          <select style={inp} value={provider} onChange={e => { setProvider(e.target.value); setSecret({}) }}>
            {Object.entries(PROVIDERS).map(([id, p]) => <option key={id} value={id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Label (optional)</label>
          <input style={inp} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. my account" />
        </div>
        {fields.map(([key, flabel, isSecret]) => (
          <div key={key}>
            <label style={lbl}>{flabel}</label>
            <input style={inp} type={isSecret ? 'password' : 'text'} value={secret[key] || ''}
              onChange={e => setSecret(s => ({ ...s, [key]: e.target.value }))} />
          </div>
        ))}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 12, cursor: 'pointer', color: 'var(--text-secondary,#aaa)' }}>
        <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} />
        🏠 Shared with the household
        <span style={{ fontSize: 10, color: 'var(--text-tertiary,#666)' }}>(everyone can see + use it — e.g. a streaming login)</span>
      </label>
      {err && <div style={{ fontSize: 11, color: 'var(--color-danger,#ef4444)', marginTop: 8 }}>{err}</div>}
      <div style={{ marginTop: 14 }}>
        <button style={{ ...btnP, opacity: busy ? 0.5 : 1 }} onClick={add} disabled={busy}>{busy ? 'Saving…' : '+ Add connection'}</button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary,#555)', marginTop: 12, lineHeight: 1.5 }}>
        Encrypted at rest with a key kept off the database. Personal to this profile.
      </div>
    </div>
  )
}

export default function ConnectionsPage() {
  const { user } = useAuth()
  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '2.5rem 1.5rem' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 24, fontWeight: 700, letterSpacing: '0.05em' }}>🔗 Connections</div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary,#666)', marginTop: 6 }}>Your external service logins — encrypted, only you can use them.</div>
      </div>
      {user?.profile ? (
        <Manager />
      ) : (
        <div style={{ ...card, color: 'var(--text-tertiary,#888)', fontSize: 13, lineHeight: 1.6 }}>
          Sign in as a person (not the shared Household) to manage your connections.
        </div>
      )}
    </div>
  )
}
