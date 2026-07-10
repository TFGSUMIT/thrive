// PhotosPage.jsx — review queue over the dedup manifests.
//  • tabs per tier (exact dups / metadata twins / resizes / near-similar / errors)
//  • each moved file side-by-side with the file kept in its place, off the
//    manifest join; verdicts: Restore (back to its library path) or Trash
//    (to trash/ — nothing is ever deleted)
//  • near-similar pairs (both still in the library): trash one side, or dismiss
//  • verdicts drop items out of the queue; "show reviewed" brings them back
import { useState, useEffect, useCallback } from 'react'
import { api } from '@trunk/api'

const TABS = [
  { id: 'library', label: '🖼 Library' },
  { id: 'tier1', label: 'Exact dups' },
  { id: 'tier2', label: 'Metadata twins' },
  { id: 'tier3', label: 'Resizes' },
  { id: 'similar', label: 'Near-similar' },
  { id: 'errors', label: 'Unreadable' },
]

const fmtBytes = (n) => {
  if (n == null) return null
  if (n > 1e9) return (n / 1e9).toFixed(2) + ' GB'
  if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB'
  if (n > 1e3) return (n / 1e3).toFixed(0) + ' KB'
  return n + ' B'
}
const fmtPx = (n) => (n == null ? null : (n / 1e6).toFixed(1) + ' MP')
const base = (p) => (p || '').split('/').pop()

function Thumb({ path, height = 190 }) {
  const [dead, setDead] = useState(false)
  useEffect(() => setDead(false), [path])
  if (dead) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'column', gap: 6, background: 'var(--bg-primary)',
                  color: 'var(--text-tertiary)', fontSize: 12 }}>
      <span style={{ fontSize: 28 }}>🎬</span>
      <span>no preview</span>
    </div>
  )
  return (
    <a href={`/api/photos/img?p=${encodeURIComponent(path)}`} target="_blank" rel="noreferrer"
       style={{ display: 'block', height, background: 'var(--bg-primary)' }}>
      <img src={`/api/photos/img?p=${encodeURIComponent(path)}&thumb=1`} alt={base(path)}
           loading="lazy" onError={() => setDead(true)}
           style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    </a>
  )
}

function Pane({ tag, tagColor, path, meta }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: tagColor }}>{tag}</span>
        {meta && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{meta}</span>}
      </div>
      <Thumb path={path} />
      <div title={path} style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4,
                                 whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {base(path)}
      </div>
    </div>
  )
}

const btn = (danger) => ({
  padding: '6px 14px', fontSize: 12, cursor: 'pointer', borderRadius: 4,
  border: '1px solid ' + (danger ? 'var(--color-danger)' : 'var(--border-color)'),
  background: 'transparent', color: danger ? 'var(--color-danger)' : 'var(--text-primary)',
})

const badge = (text, color) => (
  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color,
                 border: `1px solid ${color}`, borderRadius: 3, padding: '2px 8px' }}>{text}</span>
)

// ── library browser (the dedupped/ tree itself) ──────────────────────────────
function Library({ onError }) {
  const [path, setPath] = useState('')
  const [data, setData] = useState(null)

  const fetchDir = useCallback((p, offset) => {
    api.get(`/photos/browse?path=${encodeURIComponent(p)}&offset=${offset}&limit=60`)
      .then(r => setData(cur => (offset && cur && cur.path === r.path)
        ? { ...r, files: [...cur.files, ...r.files] } : r))
      .catch(e => onError(e.message))
  }, [onError])

  useEffect(() => { setData(null); fetchDir(path, 0) }, [path, fetchDir])

  const crumbs = path ? path.split('/') : []
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, marginBottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <a onClick={() => setPath('')} style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>Library</a>
        {crumbs.map((c, i) => (
          <span key={i} style={{ color: 'var(--text-tertiary)' }}>
            {' / '}
            <a onClick={() => setPath(crumbs.slice(0, i + 1).join('/'))}
               style={{ cursor: 'pointer', color: i === crumbs.length - 1 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{c}</a>
          </span>
        ))}
      </div>

      {!data ? <p style={{ color: 'var(--text-tertiary)' }}>loading…</p> : <>
        {data.dirs.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {data.dirs.map(d => (
              <button key={d} onClick={() => setPath(path ? `${path}/${d}` : d)}
                style={{ ...btn(false), display: 'flex', gap: 6, alignItems: 'center' }}>
                <span>📁</span>{d}
              </button>
            ))}
          </div>
        )}
        {data.files.length > 0 && (
          <div style={{ display: 'grid', gap: 10,
                        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            {data.files.map(f => (
              <div key={f.path} style={{ background: 'var(--bg-secondary)', borderRadius: 6,
                                         border: '1px solid var(--border-color)', padding: 6 }}>
                <Thumb path={f.path} height={130} />
                <div title={f.name} style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4,
                                             whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {f.video ? '🎬 ' : ''}{f.name}
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '14px 0' }}>
          {data.total_media.toLocaleString()} photos/videos
          {data.other_files ? ` · ${data.other_files} other files (hidden)` : ''}
          {!data.dirs.length && !data.total_media && !data.other_files && ' — empty folder'}
        </div>
        {data.files.length < data.total_media && (
          <div style={{ textAlign: 'center', margin: 16 }}>
            <button style={btn(false)} onClick={() => fetchDir(path, data.files.length)}>Load more</button>
          </div>
        )}
      </>}
    </div>
  )
}

export default function PhotosPage() {
  const [summary, setSummary] = useState(null)
  const [tab, setTab] = useState('library')
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [showReviewed, setShowReviewed] = useState(false)
  const [busy, setBusy] = useState(null)   // key being acted on
  const [error, setError] = useState(null)

  const refreshSummary = useCallback(() => api.get('/photos/summary').then(setSummary).catch(e => setError(e.message)), [])
  useEffect(() => { refreshSummary() }, [refreshSummary])

  const load = useCallback((reset) => {
    if (tab === 'library') return
    const off = reset ? 0 : items.length
    const q = `?offset=${off}&limit=24&all=${showReviewed ? 1 : 0}`
    const path = tab === 'similar' ? `/photos/similar${q}`
               : tab === 'errors' ? '/photos/errors'
               : `/photos/tier/${tab}${q}`
    api.get(path).then(r => {
      setItems(reset ? (r.items || []) : [...items, ...(r.items || [])])
      setTotal(r.total ?? (r.items || []).length)
    }).catch(e => setError(e.message))
  }, [tab, showReviewed, items])

  useEffect(() => { setItems([]); setTotal(0); load(true) }, [tab, showReviewed])  // eslint-disable-line

  const verdict = async (key, body, path) => {
    setBusy(key); setError(null)
    try {
      await api.post(path, body)
      setItems(cur => cur.filter(i => i.key !== key))
      setTotal(t => t - 1)
      refreshSummary()
    } catch (e) { setError(e.message) }
    setBusy(null)
  }

  if (summary && !summary.mounted) return (
    <div style={{ padding: 40, color: 'var(--text-secondary)' }}>
      <h2 style={{ color: 'var(--text-primary)' }}>📷 Photos</h2>
      <p>The photo archive isn't mounted on this host — expected <code>dedupped/</code> and{' '}
      <code>manifests/</code> under the archive bind (<code>/photos</code> in the API container).</p>
    </div>
  )

  const counts = (id) => {
    if (!summary || id === 'library') return ''
    if (id === 'errors') return summary.errors ? ` ${summary.errors}` : ''
    const t = id === 'similar' ? summary.similar : summary.tiers?.[id]
    if (!t) return ''
    const left = t.total - t.reviewed
    return ` ${left.toLocaleString()}`
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>📷 Photos</h2>
        {tab !== 'library' && (
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            every verdict is a move — nothing is deleted
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '18px 0 6px', flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ ...btn(false), borderColor: tab === t.id ? 'var(--text-primary)' : 'var(--border-color)',
                     background: tab === t.id ? 'var(--bg-tertiary)' : 'transparent' }}>
            {t.label}{counts(t.id)}
          </button>
        ))}
        {tab !== 'library' && tab !== 'errors' && (
          <label style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)',
                          display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={showReviewed} onChange={e => setShowReviewed(e.target.checked)} />
            show reviewed
          </label>
        )}
      </div>

      {error && <div style={{ color: 'var(--color-danger)', fontSize: 13, margin: '8px 0' }}>{error}</div>}

      {tab === 'library' ? (
        <Library onError={setError} />
      ) : tab === 'errors' ? (
        <div style={{ marginTop: 12 }}>
          {items.map((e, i) => (
            <div key={i} style={{ padding: '10px 14px', background: 'var(--bg-secondary)',
                                  border: '1px solid var(--border-color)', borderRadius: 6, marginBottom: 8 }}>
              <div style={{ fontSize: 13 }}>{e.file}</div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{e.stage} — {e.error}</div>
            </div>
          ))}
          {!items.length && <p style={{ color: 'var(--text-tertiary)' }}>No unreadable files. 🎉</p>}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '4px 0 12px' }}>
            {total.toLocaleString()} {showReviewed ? 'total' : 'awaiting review'}
          </div>
          <div style={{ display: 'grid', gap: 14,
                        gridTemplateColumns: 'repeat(auto-fill, minmax(430px, 1fr))' }}>
            {items.map(it => (
              <div key={it.key} style={{ background: 'var(--bg-secondary)', borderRadius: 8,
                                         border: '1px solid var(--border-color)', padding: 12,
                                         opacity: busy === it.key ? 0.5 : 1 }}>
                {tab === 'similar' ? (
                  <>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <Pane tag="A" tagColor="var(--text-secondary)" path={it.a} />
                      <Pane tag="B" tagColor="var(--text-secondary)" path={it.b} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                      {badge(`distance ${it.distance}`, 'var(--text-tertiary)')}
                      <span style={{ flex: 1 }} />
                      {it.review ? badge(it.review.action, 'var(--text-tertiary)') : <>
                        <button style={btn(true)} disabled={busy}
                          onClick={() => verdict(it.key, { key: it.key, action: 'trash_a' }, '/photos/similar/action')}>🗑 A</button>
                        <button style={btn(true)} disabled={busy}
                          onClick={() => verdict(it.key, { key: it.key, action: 'trash_b' }, '/photos/similar/action')}>🗑 B</button>
                        <button style={btn(false)} disabled={busy}
                          onClick={() => verdict(it.key, { key: it.key, action: 'dismiss' }, '/photos/similar/action')}>Both fine</button>
                      </>}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <Pane tag="KEPT" tagColor="var(--color-success)" path={it.kept}
                            meta={[it.kept_exif != null && `${it.kept_exif} exif`, fmtPx(it.kept_px)].filter(Boolean).join(' · ')} />
                      <Pane tag="MOVED" tagColor="var(--color-danger)" path={it.moved}
                            meta={[fmtBytes(it.size), it.moved_exif != null && `${it.moved_exif} exif`, fmtPx(it.moved_px)].filter(Boolean).join(' · ')} />
                    </div>
                    <div title={it.moved_from}
                         style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6,
                                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      was: {it.moved_from}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                      {it.review ? badge(`${it.review.action} → ${it.review.detail || ''}`, 'var(--text-tertiary)') : !it.exists ? badge('missing', 'var(--color-danger)') : <>
                        <button style={btn(false)} disabled={busy}
                          onClick={() => verdict(it.key, { tier: tab, key: it.key, action: 'restore' }, '/photos/action')}>↩ Restore</button>
                        <button style={btn(true)} disabled={busy}
                          onClick={() => verdict(it.key, { tier: tab, key: it.key, action: 'trash' }, '/photos/action')}>🗑 Trash</button>
                      </>}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          {items.length < total && (
            <div style={{ textAlign: 'center', margin: 20 }}>
              <button style={btn(false)} onClick={() => load(false)}>Load more</button>
            </div>
          )}
          {!items.length && <p style={{ color: 'var(--text-tertiary)', marginTop: 20 }}>
            {showReviewed ? 'Nothing here.' : 'Queue clear. 🎉'}</p>}
        </>
      )}
    </div>
  )
}
