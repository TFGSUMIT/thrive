// =============================================================================
// VaultPage.jsx — vault login items (add / edit / delete)
// thrive UI
//
// Connection/auth lives in Settings → Vault (VaultPanel). This page is the item
// manager; if there's no session yet it points you to Settings to connect.
// =============================================================================
import { useNavigate } from 'react-router-dom'
import { useVault } from '@trunk/context/VaultContext'
import VaultItems from '@trunk/components/VaultItems'

const card       = { background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10 }
const btnSecondary = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '7px 16px' }

export default function VaultPage() {
  const { vaultToken } = useVault()
  const navigate = useNavigate()
  const connected = !!vaultToken

  return (
    <div style={{ padding: '1.5rem 1.5rem 3rem', maxWidth: 600, margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 14, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>Vault</h1>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary,#888)', marginTop: 4 }}>Self-hosted Vaultwarden login items</p>
      </div>

      {connected ? (
        <VaultItems vaultToken={vaultToken} />
      ) : (
        <div style={{ ...card, padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary,#aaa)', marginTop: 0, marginBottom: 16 }}>
            No vault session. Connect your Vaultwarden account to manage items here.
          </p>
          <button style={btnSecondary} onClick={() => navigate('/settings')}>Go to Settings → Vault</button>
        </div>
      )}
    </div>
  )
}
