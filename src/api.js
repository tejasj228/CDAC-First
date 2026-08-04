// One small wrapper around fetch so every call handles cookies and errors the
// same way. Vite proxies /api to the Express server on port 4000.
async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    // Send and accept cookies. Same-origin thanks to the Vite proxy.
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export const api = {
  session: () => request('/session'),
  register: (body) => request('/register', { method: 'POST', body }),
  login: (body) => request('/login', { method: 'POST', body }),
  logout: () => request('/logout', { method: 'POST' }),
  savePrefs: (body) => request('/prefs', { method: 'PATCH', body }),
  revokeOtherSessions: () => request('/sessions/revoke-others', { method: 'POST' }),
  inspectCookies: () => request('/cookie-inspector'),
}
