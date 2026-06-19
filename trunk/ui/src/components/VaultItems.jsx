// =============================================================================
// VaultItems.jsx — native login-item manager for the connected vault
// thrive UI
//
// Lists the connected vault's LOGIN ciphers (type 1) and supports add / edit /
// delete, all end-to-end encrypted client-side with the user's symmetric key
// (the one VaultPage stashed on connect). Other item types live in the full
// Vaultwarden web app — this view is intentionally scoped to logins.
//
// Crypto: names/usernames/uris are decrypted for display; passwords are only
// decrypted on demand (reveal / edit). On save every field is encrypted to a
// type-2 EncString and POST/PUT'd to Vaultwarden; empty fields go as null.
// =============================================================================
import { useEffect, useState, useCallback } from 'react'
import { useToast } from '../context/ToastContext'
import { useConfirm } from '../context/ConfirmModal'
import { decryptEncString, encryptEncString, loadVaultSymKey } from '../utils/vault'

const CIPHER_LOGIN = 1

const card       = { background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10 }
const labelStyle = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary,#666)', display: 'block', marginBottom: 4 }
const inputStyle = { fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '8px 12px', outline: 'none', width: '100%', boxSizing: 'border-box' }
const btnPrimary = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', background: 'var(--text-primary,#e8e6e0)', border: 'none', borderRadius: 6, color: 'var(--bg-primary,#0f0f0f)', fontWeight: 500, cursor: 'pointer', padding: '9px 20px' }
const btnSecondary = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '7px 16px' }
const iconBtn    = { background: 'none', border: 'none', color: 'var(--text-tertiary,#888)', cursor: 'pointer', fontSize: 13, padding: '4px 6px' }

const EMPTY = { name: '', username: '', password: '', uri: '', notes: '', totp: '' }

export default function VaultItems({ vaultToken }) {
  const { showToast } = useToast()
  const { confirm }   = useConfirm()
  const [items,   setItems]   = useState([])      // decrypted-for-display logins (raw cipher kept on _raw)
  const [loading, setLoading] = useState(false)
  const [query,   setQuery]   = useState('')
  const [editing, setEditing] = useState(null)    // null | 'new' | cipher id
  const [form,    setForm]    = useState(EMPTY)
  const [showPw,  setShowPw]  = useState(false)
  const [busy,    setBusy]    = useState(false)

  // Authenticated call into the proxied Vaultwarden API. 401 → stale session.
  const vaultFetch = useCallback(async (path, opts = {}) => {
    const res = await fetch(`/vault/api${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${vaultToken}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
    })
    if (res.status === 401) throw new Error('Vault session expired — reconnect above')
    if (!res.ok) {
      let msg = `Vault ${res.status}`
      try { const d = await res.json(); msg = d.message || d.ErrorModel?.Message || msg } catch {}
      throw new Error(msg)
    }
    return res.status === 204 ? null : res.json()
  }, [vaultToken])

  const load = useCallback(async () => {
    if (!vaultToken) { setItems([]); return }
    const symKey = loadVaultSymKey()
    if (!symKey) { showToast('Vault key missing — reconnect', 'error'); return }
    setLoading(true)
    try {
      const data = await vaultFetch('/ciphers')
      const list = Array.isArray(data) ? data : (data.data ?? [])
      const logins = list.filter(c => c.type === CIPHER_LOGIN && !c.deletedDate)
      const decrypted = await Promise.all(logins.map(async c => ({
        _raw: c,
        id: c.id,
        name:     (await decryptEncString(c.name, symKey)) ?? '(unnamed)',
        username: c.login?.username ? (await decryptEncString(c.login.username, symKey)) ?? '' : '',
        uri:      c.login?.uris?.[0]?.uri ? (await decryptEncString(c.login.uris[0].uri, symKey)) ?? '' : '',
      })))
      setItems(decrypted.sort((a, b) => a.name.localeCompare(b.name)))
    } catch (e) { showToast(e.message, 'error') }
    finally { setLoading(false) }
  }, [vaultToken, vaultFetch, showToast])

  useEffect(() => { load() }, [load])

  // open the editor for a new item, or an existing one (decrypts its secrets now)
  const openNew = () => { setForm(EMPTY); setShowPw(true); setEditing('new') }
  const openEdit = async (item) => {
    const symKey = loadVaultSymKey()
    const c = item._raw
    setForm({
      name: item.name === '(unnamed)' ? '' : item.name,
      username: item.username,
      uri: item.uri,
      password: c.login?.password ? (await decryptEncString(c.login.password, symKey)) ?? '' : '',
      totp:     c.login?.totp     ? (await decryptEncString(c.login.totp, symKey))     ?? '' : '',
      notes:    c.notes           ? (await decryptEncString(c.notes, symKey))           ?? '' : '',
    })
    setShowPw(false)
    setEditing(item.id)
  }
  const cancel = () => { setEditing(null); setForm(EMPTY) }

  const save = async () => {
    if (!form.name.trim()) { showToast('Name is required', 'error'); return }
    const symKey = loadVaultSymKey()
    if (!symKey) { showToast('Vault key missing — reconnect', 'error'); return }
    setBusy(true)
    try {
      const enc = (v) => v && v.trim() ? encryptEncString(v.trim(), symKey) : Promise.resolve(null)
      const [name, username, password, uri, totp, notes] = await Promise.all([
        enc(form.name), enc(form.username), enc(form.password), enc(form.uri), enc(form.totp), enc(form.notes),
      ])
      const body = {
        type: CIPHER_LOGIN,
        name, notes,
        favorite: editing !== 'new' ? !!items.find(i => i.id === editing)?._raw.favorite : false,
        folderId: editing !== 'new' ? (items.find(i => i.id === editing)?._raw.folderId ?? null) : null,
        organizationId: null,
        login: { username, password, totp, uris: uri ? [{ uri, match: null }] : null },
        fields: editing !== 'new' ? (items.find(i => i.id === editing)?._raw.fields ?? null) : null,
        lastKnownRevisionDate: null,
      }
      if (editing === 'new') await vaultFetch('/ciphers', { method: 'POST', body: JSON.stringify(body) })
      else                   await vaultFetch(`/ciphers/${editing}`, { method: 'PUT', body: JSON.stringify(body) })
      showToast(editing === 'new' ? 'Item created' : 'Item updated', 'success')
      cancel()
      await load()
    } catch (e) { showToast(e.message, 'error') }
    finally { setBusy(false) }
  }

  const del = async (item) => {
    const ok = await confirm(`Permanently delete '${item.name}' from the vault?`, { danger: true })
    if (!ok) return
    setBusy(true)
    try {
      await vaultFetch(`/ciphers/${item.id}`, { method: 'DELETE' })
      showToast('Item deleted', 'success')
      await load()
    } catch (e) { showToast(e.message, 'error') }
    finally { setBusy(false) }
  }

  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); showToast(`${what} copied`, 'success') }
    catch { showToast('Copy failed', 'error') }
  }

  const filtered = items.filter(i =>
    !query.trim() || `${i.name} ${i.username} ${i.uri}`.toLowerCase().includes(query.toLowerCase().trim()))

  return (
    <div style={{ ...card, marginTop: 16 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color,#2a2a2a)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 500 }}>🗝️ Login items {items.length > 0 && <span style={{ color: 'var(--text-tertiary,#666)' }}>({items.length})</span>}</span>
        {!editing && <button style={btnPrimary} onClick={openNew}>+ New</button>}
      </div>

      <div style={{ padding: 16 }}>
        {editing ? (
          // ── editor ───────────────────────────────────────────────────────
          <div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Name *</label>
              <input style={inputStyle} value={form.name} autoFocus onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. GitHub" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Username</label>
              <input style={inputStyle} value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} autoComplete="off" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Password</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input style={{ ...inputStyle, flex: 1 }} type={showPw ? 'text' : 'password'} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} autoComplete="new-password" />
                <button style={btnSecondary} onClick={() => setShowPw(s => !s)} title={showPw ? 'Hide' : 'Show'}>{showPw ? '🙈' : '👁'}</button>
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>URL</label>
              <input style={inputStyle} value={form.uri} onChange={e => setForm(f => ({ ...f, uri: e.target.value }))} placeholder="https://…" autoComplete="off" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>TOTP secret <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
              <input style={inputStyle} value={form.totp} onChange={e => setForm(f => ({ ...f, totp: e.target.value }))} autoComplete="off" />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Notes</label>
              <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...btnPrimary, opacity: busy ? 0.5 : 1 }} onClick={save} disabled={busy}>{busy ? 'Saving…' : (editing === 'new' ? 'Create' : 'Save')}</button>
              <button style={btnSecondary} onClick={cancel} disabled={busy}>Cancel</button>
            </div>
          </div>
        ) : loading ? (
          <p style={{ fontSize: 13, color: 'var(--text-tertiary,#888)', margin: 0 }}>Loading items…</p>
        ) : (
          // ── list ─────────────────────────────────────────────────────────
          <div>
            <input style={{ ...inputStyle, marginBottom: 12 }} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search items…" />
            {filtered.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-tertiary,#888)', margin: 0 }}>{items.length === 0 ? 'No login items yet.' : 'No matches.'}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filtered.map(item => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg-tertiary,#222)', borderRadius: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                      {item.username && <div style={{ fontSize: 11, color: 'var(--text-tertiary,#888)', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.username}</div>}
                    </div>
                    {item.username && <button style={iconBtn} title="Copy username" onClick={() => copy(item.username, 'Username')}>👤</button>}
                    <button style={iconBtn} title="Copy password" onClick={async () => {
                      const symKey = loadVaultSymKey()
                      const pw = item._raw.login?.password ? await decryptEncString(item._raw.login.password, symKey) : ''
                      copy(pw || '', 'Password')
                    }}>🔑</button>
                    <button style={iconBtn} title="Edit" onClick={() => openEdit(item)}>✏️</button>
                    <button style={{ ...iconBtn, color: 'var(--color-danger,#ef4444)' }} title="Delete" onClick={() => del(item)} disabled={busy}>🗑</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
