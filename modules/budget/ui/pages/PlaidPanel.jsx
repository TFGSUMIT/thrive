// =============================================================================
// PlaidPanel.jsx — Budget module: Plaid connection manager
// thrive UI — /budget/plaid
//
// Manual access-token flow (ported from the monolith Settings panel): paste a
// Plaid access_token + label → Fetch lists that item's accounts → map each to a
// thrive (budget) account → Save registers connections. Sync/import then happens
// per-account on the Accounts/Transactions pages.
//
// Requires PLAID_CLIENT_ID / PLAID_SECRET on the api (the backend calls Plaid
// with those + your access_token). Getting the access_token itself is external
// (Plaid Link / Quickstart) — this panel consumes an existing one.
// =============================================================================
import { useState, useEffect } from 'react'
import { api } from '@trunk/api'
import '../components/Settings.css'

export default function PlaidPanel() {
  const [connections,   setConnections]   = useState([])
  const [nbAccounts,    setNbAccounts]     = useState([])
  const [showAdd,       setShowAdd]        = useState(false)
  const [tokenInput,    setTokenInput]     = useState('')
  const [tokenLabel,    setTokenLabel]     = useState('')
  const [plaidAccounts, setPlaidAccounts]  = useState([])
  const [mappings,      setMappings]       = useState({})
  const [fetchingAccts, setFetchingAccts]  = useState(false)
  const [saving,        setSaving]         = useState(false)
  const [error,         setError]          = useState(null)

  // ── API credentials (DB-backed; set right here, no file editing) ──
  const [cid,        setCid]        = useState('')
  const [secret,     setSecret]     = useState('')
  const [url,        setUrl]        = useState('https://production.plaid.com')
  const [secretSet,  setSecretSet]  = useState(false)
  const [configured, setConfigured] = useState(false)
  const [cfgSaving,  setCfgSaving]  = useState(false)
  const [cfgMsg,     setCfgMsg]     = useState(null)

  const loadConnections = async () => {
    try { setConnections(await api.get('/plaid/connections')) }
    catch { setError('Failed to load connections') }
  }
  const loadNbAccounts = async () => {
    try { setNbAccounts(await api.get('/budget/accounts/')) } catch {}
  }
  const loadConfig = async () => {
    try {
      const c = await api.get('/plaid/config')
      setCid(c.client_id || '')
      setUrl(c.url || 'https://production.plaid.com')
      setSecretSet(!!c.secret_set); setConfigured(!!c.configured)
    } catch {}
  }
  useEffect(() => { loadConnections(); loadNbAccounts(); loadConfig() }, [])

  const saveConfig = async () => {
    setCfgSaving(true); setCfgMsg(null)
    try {
      const body = { client_id: cid.trim(), url: url.trim() }
      if (secret.trim()) body.secret = secret.trim()
      const c = await api.post('/plaid/config', body)
      setSecret(''); setSecretSet(!!c.secret_set); setConfigured(!!c.configured)
      setCfgMsg('Saved ✓')
    } catch (e) { setCfgMsg(e.message || 'Failed to save') }
    finally { setCfgSaving(false) }
  }

  const handleFetchAccounts = async () => {
    if (!tokenInput.trim()) return
    setFetchingAccts(true); setError(null); setPlaidAccounts([]); setMappings({})
    try {
      setPlaidAccounts(await api.post('/plaid/fetch-accounts', { access_token: tokenInput.trim() }))
    } catch (e) { setError(e.message || 'Failed to fetch accounts') }
    finally { setFetchingAccts(false) }
  }

  const handleSave = async () => {
    const pairs = Object.entries(mappings).filter(([, nbId]) => nbId)
    if (!pairs.length)        { setError('Map at least one account'); return }
    if (!tokenLabel.trim())   { setError('Enter a label for this connection'); return }
    setSaving(true); setError(null)
    try {
      for (const [plaidAccountId, nbAccountId] of pairs) {
        await api.post('/plaid/connections', {
          account_id:       parseInt(nbAccountId),
          access_token:     tokenInput.trim(),
          plaid_account_id: plaidAccountId,
          institution_name: tokenLabel.trim(),
        })
      }
      setShowAdd(false); setTokenInput(''); setTokenLabel('')
      setPlaidAccounts([]); setMappings({})
      await loadConnections()
    } catch (e) { setError(e.message || 'Failed to save') }
    finally { setSaving(false) }
  }

  const handleDelete = async (id) => {
    try { await api.del(`/plaid/connections/${id}`); setConnections(prev => prev.filter(c => c.id !== id)) }
    catch { setError('Failed to delete connection') }
  }
  const handleDeleteToken = async (accessToken) => {
    const toDelete = connections.filter(c => c.access_token === accessToken)
    try {
      for (const c of toDelete) await api.del(`/plaid/connections/${c.id}`)
      setConnections(prev => prev.filter(c => c.access_token !== accessToken))
    } catch { setError('Failed to delete connection group') }
  }

  const groups = connections.reduce((acc, c) => {
    const key = c.access_token
    if (!acc[key]) acc[key] = { label: c.institution_name, token: key, accounts: [] }
    acc[key].accounts.push(c)
    return acc
  }, {})

  return (
    <>
      {/* API credentials — get these from dashboard.plaid.com → Developers → Keys */}
      <div className="conn-block" style={{ marginBottom: 12 }}>
        <div className="conn-block-header">
          <span className="conn-block-title">🔧 Plaid API credentials</span>
          {configured && <span className="conn-status connected">Configured</span>}
        </div>
        <div className="plaid-add-form">
          <div className="plaid-field">
            <label className="plaid-field-label">Client ID</label>
            <input className="plaid-input" type="text" placeholder="dashboard.plaid.com → Developers → Keys"
              value={cid} onChange={e => setCid(e.target.value)} />
          </div>
          <div className="plaid-field">
            <label className="plaid-field-label">Secret{secretSet ? ' (set — leave blank to keep)' : ''}</label>
            <input className="plaid-input" type="password" placeholder={secretSet ? '••••••••' : 'plaid secret'}
              value={secret} onChange={e => setSecret(e.target.value)} />
          </div>
          <div className="plaid-field">
            <label className="plaid-field-label">Environment URL</label>
            <input className="plaid-input" type="text" placeholder="https://production.plaid.com"
              value={url} onChange={e => setUrl(e.target.value)} />
          </div>
          <button className="plaid-save-btn" onClick={saveConfig} disabled={cfgSaving}>
            {cfgSaving ? 'Saving…' : 'Save credentials'}
          </button>
          {cfgMsg && <div className="plaid-empty" style={{ marginTop: 6 }}>{cfgMsg}</div>}
        </div>
      </div>

      <div className="conn-block">
        <div className="conn-block-header">
          <span className="conn-block-title">🏦 Plaid</span>
          <button className="plaid-add-btn" onClick={() => { setShowAdd(s => !s); setError(null) }}>
            {showAdd ? '✕' : '+ Add'}
          </button>
        </div>

        {error && <div className="plaid-error">{error}</div>}

        {Object.values(groups).length > 0 && (
          <div className="plaid-groups">
            {Object.values(groups).map(group => (
              <div key={group.token} className="plaid-group">
                <div className="plaid-group-header">
                  <span className="plaid-group-label">{group.label}</span>
                  <button className="plaid-delete-token-btn" onClick={() => handleDeleteToken(group.token)}>Remove</button>
                </div>
                {group.accounts.map(c => (
                  <div key={c.id} className="plaid-connection-row">
                    <span className="plaid-account-name">{c.account_name}</span>
                    <button className="plaid-delete-btn" onClick={() => handleDelete(c.id)}>✕</button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {connections.length === 0 && !showAdd && <div className="plaid-empty">No connections yet</div>}

        {showAdd && (
          <div className="plaid-add-form">
            <div className="plaid-field">
              <label className="plaid-field-label">Label</label>
              <input className="plaid-input" type="text" placeholder="e.g. Jeff — SoFi"
                value={tokenLabel} onChange={e => setTokenLabel(e.target.value)} />
            </div>
            <div className="plaid-field">
              <label className="plaid-field-label">Access Token</label>
              <div className="plaid-token-row">
                <input className="plaid-input" type="password" placeholder="access-production-…"
                  value={tokenInput}
                  onChange={e => { setTokenInput(e.target.value); setPlaidAccounts([]); setMappings({}) }} />
                <button className="plaid-fetch-btn" onClick={handleFetchAccounts} disabled={fetchingAccts || !tokenInput.trim()}>
                  {fetchingAccts ? '…' : 'Fetch'}
                </button>
              </div>
            </div>
            {plaidAccounts.length > 0 && (
              <div className="plaid-mapping">
                <label className="plaid-field-label">Map to thrive accounts</label>
                {plaidAccounts.map(a => (
                  <div key={a.plaid_account_id} className="plaid-mapping-row">
                    <div className="plaid-mapping-plaid">
                      <span className="plaid-mapping-name">{a.name}</span>
                      <span className="plaid-mapping-meta">{a.subtype} ···{a.mask}</span>
                    </div>
                    <select className="plaid-mapping-select"
                      value={mappings[a.plaid_account_id] || ''}
                      onChange={e => setMappings(prev => ({ ...prev, [a.plaid_account_id]: e.target.value }))}>
                      <option value="">— skip —</option>
                      {nbAccounts.map(nb => (
                        <option key={nb.id} value={nb.id}>{nb.name}{nb.number ? ` (${nb.number})` : ''}</option>
                      ))}
                    </select>
                  </div>
                ))}
                <button className="plaid-save-btn" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Connections'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
