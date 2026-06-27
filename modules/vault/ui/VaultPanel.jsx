// =============================================================================
// VaultPanel.jsx — Vaultwarden connection management (lives in Settings)
// thrive UI
//
// The connect/disconnect (auth) half of the vault, surfaced under Settings →
// Vault — same pattern as the LM Studio panel. Item management (add/edit/delete)
// lives on the /vault page once a session is active.
// =============================================================================
import { useState } from 'react'
import { useVault } from '@trunk/context/VaultContext'
import {
  deriveMasterKey, deriveMasterPasswordHash, stretchMasterKey,
  decryptEncStringToBytes, saveVaultSymKey,
} from '@trunk/utils/vault'
import PasswordInput from '@trunk/components/PasswordInput'

const VAULT_BASE = '/vault'

const labelStyle = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary,#666)', display: 'block', marginBottom: 4 }
const inputStyle = { fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '8px 12px', outline: 'none', width: '100%', boxSizing: 'border-box' }
const btnPrimary = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', background: 'var(--text-primary,#e8e6e0)', border: 'none', borderRadius: 6, color: 'var(--bg-primary,#0f0f0f)', fontWeight: 500, cursor: 'pointer', padding: '9px 20px' }
const btnSecondary = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '7px 16px' }

export default function VaultPanel() {
  const { vaultToken, setVaultToken } = useVault()
  const [email,      setEmail]      = useState('')
  const [password,   setPassword]   = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error,      setError]      = useState(null)

  const connected = !!vaultToken

  const connect = async () => {
    if (!email.trim() || !password.trim()) { setError('Email and master password required'); return }
    setConnecting(true); setError(null)
    try {
      const preRes = await fetch(`${VAULT_BASE}/identity/accounts/prelogin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const pre        = await preRes.json()
      const iterations = pre.kdfIterations || 600000
      const masterKey  = await deriveMasterKey(password, email.trim(), iterations)
      const passHash   = await deriveMasterPasswordHash(masterKey, password)
      const params     = new URLSearchParams({
        grant_type: 'password', username: email.trim(), password: passHash,
        scope: 'api offline_access', client_id: 'web',
        deviceType: '10', deviceIdentifier: 'thrive-web', deviceName: 'thrive',
      })
      const tokenRes = await fetch(`${VAULT_BASE}/identity/connect/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      })
      if (!tokenRes.ok) {
        const d = await tokenRes.json()
        throw new Error(d.error_description || d.detail || 'Invalid credentials')
      }
      const tokenData     = await tokenRes.json()
      const userKeyEncStr = tokenData.Key ?? tokenData.key
      if (userKeyEncStr) {
        const stretchedKey     = await stretchMasterKey(masterKey)
        const userSymKeyBytes  = await decryptEncStringToBytes(userKeyEncStr, stretchedKey)
        if (userSymKeyBytes) saveVaultSymKey(userSymKeyBytes)
      }
      setVaultToken(tokenData.access_token)
      setPassword('')
    } catch (e) { setError(e.message || 'Failed to connect') }
    finally { setConnecting(false) }
  }

  return (
    <div style={{ padding: 16 }}>
      {connected ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary,#aaa)' }}>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'var(--success-muted)', color: 'var(--color-success)', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 10 }}>Connected</span>
            Vault session active. Manage items at /vault.
          </span>
          <button style={btnSecondary} onClick={() => setVaultToken(null)}>Disconnect</button>
        </div>
      ) : (
        <div>
          {error && <div style={{ fontSize: 12, color: 'var(--color-danger,#ef4444)', marginBottom: 14, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 6 }}>{error}</div>}
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Email</label>
            <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" onKeyDown={e => e.key === 'Enter' && document.getElementById('vault-pw').focus()} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Master password</label>
            <PasswordInput id="vault-pw" style={inputStyle} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e => e.key === 'Enter' && connect()} />
          </div>
          <button style={{ ...btnPrimary, opacity: connecting ? 0.5 : 1 }} onClick={connect} disabled={connecting}>
            {connecting ? 'Connecting…' : '🔑 Connect Vault'}
          </button>
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-color,#2a2a2a)', fontSize: 12, color: 'var(--text-tertiary,#888)' }}>
            No vault account yet? This connects to your self-hosted Vaultwarden — create an account there first, then connect here with the same email + master password.
            <div style={{ marginTop: 10 }}>
              <button style={btnSecondary} onClick={() => window.open(`${VAULT_BASE}/`, '_blank')}>Open Vaultwarden ↗</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
