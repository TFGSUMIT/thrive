const API_BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  if (res.status === 401) {
    if (typeof window !== 'undefined')
      window.dispatchEvent(new CustomEvent('thrive:unauthorized'))
  }
  if (!res.ok) {
    let detail = res.statusText
    try { const b = await res.json(); detail = b.detail || detail } catch {}
    throw new Error(detail)
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  get:   (path)       => request(path),
  post:  (path, body) => request(path, { method: 'POST',  body: JSON.stringify(body ?? {}) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put:   (path, body) => request(path, { method: 'PUT',   body: JSON.stringify(body) }),
  del:   (path)       => request(path, { method: 'DELETE' }),
}