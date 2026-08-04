import { useState } from 'react'

import { api } from '../api'
import { describeDevice, formatDateTime, timeAgo } from '../format'
import CookieInspector from './CookieInspector'
import DecryptText from './DecryptText'
import ThemeToggle from './ThemeToggle'

function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  )
}

export default function Dashboard({ user, prefs, sessions, onLogout, onThemeChange, onRefresh }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const initials = user.name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  // Right after logging in the server tells us the previous login time. After a
  // page refresh we fall back to what the cookie remembered.
  const previousVisit = user.previousLoginAt ?? prefs?.previousVisitAt
  const otherSessions = sessions.filter((s) => !s.current)

  async function revokeOthers() {
    setBusy(true)
    try {
      const { revoked } = await api.revokeOtherSessions()
      await onRefresh()
      setNotice(
        revoked > 0
          ? `Signed out ${revoked} other device${revoked === 1 ? '' : 's'}.`
          : 'No other devices were signed in.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dash">
      <header className="dash-header panel">
        <div className="identity">
          <div className="avatar">{initials}</div>
          <div>
            <h1>Welcome back, {user.name.split(' ')[0]}</h1>
            <p className="muted small">{user.email}</p>
          </div>
        </div>

        <div className="header-actions">
          <ThemeToggle theme={prefs?.theme} onChange={onThemeChange} />
          <button className="ghost-button" onClick={onLogout} type="button">
            Sign out
          </button>
        </div>
      </header>

      {previousVisit ? (
        <div className="panel highlight">
          <span className="callout-icon">👋</span>
          <div>
            <strong>You were last here {timeAgo(previousVisit)}</strong>
            <p className="muted small">
              {formatDateTime(previousVisit)} — none of this was typed in, it came
              back from your browser cookie and our database.
            </p>
          </div>
        </div>
      ) : (
        <div className="panel highlight">
          <span className="callout-icon">🎉</span>
          <div>
            <strong>This is your first visit</strong>
            <p className="muted small">
              Sign out and sign back in — the page will greet you with your
              history instead.
            </p>
          </div>
        </div>
      )}

      <section className="panel">
        <div className="section-head">
          <h2>Restored from your cookie</h2>
          <span className="badge">🔒 AES-256-GCM encrypted</span>
        </div>
        <p className="muted small section-sub">
          Stored in the browser only — the server keeps no copy of any of this.
        </p>

        <div className="stat-grid">
          <Stat
            label="Logins from this browser"
            value={prefs?.visits ?? 0}
            hint="Counter lives inside the cookie"
          />
          <Stat
            label="Previous visit"
            value={timeAgo(prefs?.previousVisitAt)}
            hint={formatDateTime(prefs?.previousVisitAt)}
          />
          <Stat
            label="Remembered email"
            value={
              <DecryptText
                className="decrypt"
                text={prefs?.lastEmail ?? '—'}
                delay={260}
              />
            }
            hint="Pre-fills the sign-in form"
          />
          <Stat
            label="Theme preference"
            value={prefs?.theme ?? 'dark'}
            hint="Survives sign-out"
          />
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h2>From the database</h2>
          <span className="badge alt">🗄️ SQLite</span>
        </div>
        <p className="muted small section-sub">
          Facts the cookie is not allowed to decide — a user could edit a cookie,
          but not the server&apos;s database.
        </p>

        <div className="stat-grid">
          <Stat
            label="Member since"
            value={formatDateTime(user.createdAt)}
            hint={timeAgo(user.createdAt)}
          />
          <Stat label="Total logins" value={user.loginCount} hint="All devices" />
          <Stat
            label="This session started"
            value={timeAgo(user.lastLoginAt)}
            hint={formatDateTime(user.lastLoginAt)}
          />
          <Stat
            label="Active devices"
            value={sessions.length}
            hint={`${otherSessions.length} other than this one`}
          />
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h2>Active sessions</h2>
          <button
            className="ghost-button"
            onClick={revokeOthers}
            disabled={busy || otherSessions.length === 0}
            type="button"
          >
            Sign out other devices
          </button>
        </div>
        {notice && <p className="notice small">{notice}</p>}

        <ul className="session-list">
          {sessions.map((session) => (
            <li key={session.id} className="session-row">
              <div>
                <strong>
                  {describeDevice(session.user_agent)}
                  {session.current && <span className="pill">this device</span>}
                </strong>
                <p className="muted small">
                  Signed in {timeAgo(session.created_at)} · active{' '}
                  {timeAgo(session.last_seen)} · expires{' '}
                  {formatDateTime(session.expires_at)}
                </p>
              </div>
              <code className="small muted">{session.ip}</code>
            </li>
          ))}
        </ul>
      </section>

      <CookieInspector />
    </div>
  )
}
