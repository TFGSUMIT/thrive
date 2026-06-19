// =============================================================================
// UsersPage.jsx — Users module page (household profiles)
// thrive UI — reached via the 👥 icon in the top bar
//
// A "user" is a person/profile (name + avatar), not a login. Login accounts
// live in Settings → Accounts; an account may link to one profile here.
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@trunk/context/AuthContext'
import { api } from '@trunk/api'
import EmojiPicker from '@trunk/components/EmojiPicker'

const card = { background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#2a2a2a)', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }
const head = { padding: '12px 16px', borderBottom: '1px solid var(--border-color,#2a2a2a)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary,#666)' }
const inp  = { fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '7px 10px', outline: 'none', width: '100%', boxSizing: 'border-box' }
const btnP = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', background: 'var(--text-primary,#e8e6e0)', border: 'none', borderRadius: 6, color: 'var(--bg-primary,#0f0f0f)', fontWeight: 500, cursor: 'pointer', padding: '8px 16px' }
const btnS = { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)', cursor: 'pointer', padding: '6px 12px' }
const lbl  = { fontSize: 10, color: 'var(--text-tertiary,#666)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }

const SWATCHES = ['#a855f7', '#3b82f6', '#22c55e', '#ef4444', '#f59e0b', '#ec4899', '#14b8a6', '#64748b']
const EMPTY = { name: '', avatar: '🙂', color: SWATCHES[0] }

function Avatar({ p, size = 34 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.55, background: (p.color || '#333') + '22',
      border: `1px solid ${(p.color || '#333')}66` }}>
      {p.avatar || '🙂'}
    </div>
  )
}

function ProfileForm({ value, setValue, onSave, onCancel, saving, submitLabel }) {
  return (
    <div style={{ padding: 16, borderBottom: '1px solid var(--border-color,#2a2a2a)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <div>
          <div style={lbl}>Avatar</div>
          <EmojiPicker value={value.avatar} color={value.color}
            onChange={em => setValue(p => ({ ...p, avatar: em }))} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={lbl}>Name</div>
          <input style={inp} value={value.name} autoComplete="off"
            onChange={e => setValue(p => ({ ...p, name: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && onSave()} autoFocus />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={lbl}>Color</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {SWATCHES.map(c => (
            <button key={c} onClick={() => setValue(p => ({ ...p, color: c }))}
              style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer',
                border: value.color === c ? '2px solid var(--text-primary,#e8e6e0)' : '2px solid transparent' }} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button style={btnS} onClick={onCancel}>Cancel</button>
        <button style={{ ...btnP, opacity: saving ? 0.5 : 1 }} onClick={onSave} disabled={saving}>{saving ? 'Saving…' : submitLabel}</button>
      </div>
    </div>
  )
}

export default function UsersPage() {
  const { user }            = useAuth()
  const isAdmin             = user?.role === 'admin'
  const [profiles, setProfiles] = useState([])
  const [adding,   setAdding]   = useState(false)
  const [draft,    setDraft]    = useState(EMPTY)
  const [editId,   setEditId]   = useState(null)
  const [editVal,  setEditVal]  = useState(EMPTY)
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState(null)

  const load = useCallback(async () => {
    try { setProfiles(await api.get('/users')) } catch (e) { setErr(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const add = async () => {
    if (!draft.name.trim()) { setErr('Name required'); return }
    setSaving(true); setErr(null)
    try { await api.post('/users', draft); setDraft(EMPTY); setAdding(false); load() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }
  const saveEdit = async () => {
    if (!editVal.name.trim()) { setErr('Name required'); return }
    setSaving(true); setErr(null)
    try { await api.patch(`/users/${editId}`, editVal); setEditId(null); load() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }
  const remove = async (id) => { try { await api.del(`/users/${id}`); load() } catch (e) { setErr(e.message) } }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '1.5rem 1.5rem 3rem' }}>
      <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>👥</span>
        <h1 style={{ fontSize: 14, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase' }}>Users</h1>
      </div>

      <div style={card}>
        <div style={{ ...head, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Profiles</span>
          {isAdmin && !adding && <button style={{ ...btnP, padding: '4px 12px', fontSize: 10 }} onClick={() => { setAdding(true); setDraft(EMPTY); setErr(null) }}>+ Add</button>}
        </div>
        {err && <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--color-danger,#ef4444)' }}>{err}</div>}

        {adding && <ProfileForm value={draft} setValue={setDraft} onSave={add} onCancel={() => { setAdding(false); setErr(null) }} saving={saving} submitLabel="✦ Create" />}

        {profiles.length === 0 && !adding && (
          <div style={{ padding: 24, fontSize: 12, color: 'var(--text-tertiary,#888)' }}>No profiles yet.</div>
        )}

        {profiles.map((p, i) => (
          editId === p.id ? (
            <ProfileForm key={p.id} value={editVal} setValue={setEditVal} onSave={saveEdit} onCancel={() => setEditId(null)} saving={saving} submitLabel="Save" />
          ) : (
            <div key={p.id} style={{ padding: '12px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--border-color,#2a2a2a)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar p={p} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary,#888)', marginTop: 2, fontFamily: 'monospace' }}>
                  {p.account ? `🔑 ${p.account}` : 'no account'}
                </div>
              </div>
              {isAdmin && (
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button style={{ ...btnS, padding: '3px 9px', fontSize: 10 }} onClick={() => { setEditId(p.id); setEditVal({ name: p.name, avatar: p.avatar || '🙂', color: p.color || SWATCHES[0] }); setErr(null) }}>Edit</button>
                  <button style={{ ...btnS, padding: '3px 9px', fontSize: 10, color: 'var(--color-danger,#ef4444)', borderColor: 'transparent' }} onClick={() => remove(p.id)}>Delete</button>
                </div>
              )}
            </div>
          )
        ))}
      </div>

      <div style={{ fontSize: 10, color: 'var(--text-tertiary,#555)', lineHeight: 1.7, padding: '0 4px' }}>
        Profiles are the people in your home. Give one a login in <strong>Settings → Accounts</strong> by linking an account to it.
      </div>
    </div>
  )
}
