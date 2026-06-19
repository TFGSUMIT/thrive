// =============================================================================
// context/VaultContext.jsx — Vault token state shared across the app
// thrive UI
// =============================================================================
import { createContext, useContext, useState } from 'react'

const VAULT_TOKEN_KEY = 'thrive.vaultToken'
const VaultContext    = createContext(null)

export const useVault = () => useContext(VaultContext)

export function VaultProvider({ children }) {
  const [vaultToken, setVaultTokenState] = useState(
    () => localStorage.getItem(VAULT_TOKEN_KEY) ?? null
  )

  const setVaultToken = (token) => {
    if (token) { localStorage.setItem(VAULT_TOKEN_KEY, token) }
    else        { localStorage.removeItem(VAULT_TOKEN_KEY)    }
    setVaultTokenState(token)
  }

  return (
    <VaultContext.Provider value={{ vaultToken, setVaultToken }}>
      {children}
    </VaultContext.Provider>
  )
}