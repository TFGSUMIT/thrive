const API_BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  // A 401 on a NORMAL request means the session expired → fire the global
  // "logged out" so the app re-auths. But a 401 from an /auth/* call IS the auth
  // attempt itself (e.g. a wrong password on login) — let the caller surface it,
  // don't blow away the current session and bounce back to the picker.
  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (typeof window !== 'undefined')
      window.dispatchEvent(new CustomEvent('thrive:unauthorized'))
  }
  if (!res.ok) {
    // HTTP/2 (e.g. behind Cloudflare) has no reason phrase, so res.statusText is ''.
    // Fall back to the status code so errors never surface as a blank message.
    let detail = res.statusText || `Request failed (${res.status})`
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