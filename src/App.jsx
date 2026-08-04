import { useCallback, useEffect, useState } from 'react'

import { api } from './api'
import AuthPage from './components/AuthPage'
import Dashboard from './components/Dashboard'
import './App.css'

export default function App() {
  const [status, setStatus] = useState('loading')
  const [user, setUser] = useState(null)
  const [prefs, setPrefs] = useState(null)
  const [sessions, setSessions] = useState([])
  const [fatal, setFatal] = useState(null)

  // Runs once on page load. The browser automatically attaches our cookies to
  // this request, so the server can tell us who we are with no login form.
  const loadSession = useCallback(async () => {
    const data = await api.session()
    setUser(data.user)
    setPrefs(data.prefs)
    setSessions(data.sessions)
    return data
  }, [])

  useEffect(() => {
    loadSession()
      .catch((err) => setFatal(err.message))
      .finally(() => setStatus('ready'))
  }, [loadSession])

  // The theme lives in the encrypted cookie, so it survives logout and restarts.
  useEffect(() => {
    document.documentElement.dataset.theme = prefs?.theme ?? 'dark'
  }, [prefs?.theme])

  // Called after a successful login or registration.
  async function handleAuthenticated(result) {
    setUser(result.user) // keeps previousLoginAt, which /session doesn't return
    const data = await api.session()
    setPrefs(data.prefs)
    setSessions(data.sessions)
  }

  async function handleLogout() {
    await api.logout()
    await loadSession() // prefs survive logout; user becomes null
  }

  async function handleThemeChange(theme) {
    setPrefs((p) => ({ ...p, theme })) // update the UI instantly...
    const { prefs: saved } = await api.savePrefs({ theme }) // ...then persist
    setPrefs(saved)
  }

  if (status === 'loading') {
    return (
      <div className="app-loading">
        <div className="spinner" />
      </div>
    )
  }

  if (fatal) {
    return (
      <div className="app-loading">
        <div className="panel error-panel">
          <h2>Can&apos;t reach the API</h2>
          <p className="muted">{fatal}</p>
          <p className="muted">
            Make sure both servers are running: <code>npm run dev</code>
          </p>
        </div>
      </div>
    )
  }

  return user ? (
    <Dashboard
      user={user}
      prefs={prefs}
      sessions={sessions}
      onLogout={handleLogout}
      onThemeChange={handleThemeChange}
      onRefresh={loadSession}
    />
  ) : (
    <AuthPage
      prefs={prefs}
      onAuthenticated={handleAuthenticated}
      onThemeChange={handleThemeChange}
    />
  )
}
