// =============================================================================
// context/VaultContext.jsx — Vault token state shared across the app
// thrive UI
// =============================================================================
import { createContext, useContext, useState, useCallback } from 'react'

const VAULT_TOKEN_KEY = 'thrive.vaultToken'
const VaultContext    = createContext(null)

export const useVault = () => useContext(VaultContext)

export function VaultProvider({ children }) {
  const [vaultToken, setVaultTokenState] = useState(
    () => localStorage.getItem(VAULT_TOKEN_KEY) ?? null
  )

  const setVaultToken = useCallback((token) => {
    if (token) { localStorage.setItem(VAULT_TOKEN_KEY, token) }
    else        { localStorage.removeItem(VAULT_TOKEN_KEY)    }
    setVaultTokenState(token)
  }, [])

  // Authenticated call into the proxied Vaultwarden API (path is relative to
  // /vault/api). Vaultwarden access tokens are short-lived and we don't refresh
  // them, so a 401 means the session expired: CLEAR the token here. That way the
  // whole app — the Settings → Vault badge, budget's account→vault linking, and
  // the /vault page — reflects "disconnected" and prompts a reconnect, instead
  // of every consumer silently erroring while Settings still says "Connected".
  const vaultFetch = useCallback(async (path, opts = {}) => {
    const token = localStorage.getItem(VAULT_TOKEN_KEY)
    const res = await fetch(`/vault/api${path}`, {
      ...opts,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...opts.headers,
      },
    })
    if (res.status === 401) {
      setVaultToken(null)
      throw new Error('Vault session expired — reconnect in Settings → Vault')
    }
    if (!res.ok) {
      let msg = `Vault ${res.status}`
      try { const d = await res.json(); msg = d.message || d.ErrorModel?.Message || msg } catch {}
      throw new Error(msg)
    }
    return res.status === 204 ? null : res.json()
  }, [setVaultToken])

  return (
    <VaultContext.Provider value={{ vaultToken, setVaultToken, vaultFetch }}>
      {children}
    </VaultContext.Provider>
  )
}
