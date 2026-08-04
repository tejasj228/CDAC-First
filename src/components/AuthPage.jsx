import { useEffect, useState } from 'react'

import { api } from '../api'
import ThemeToggle from './ThemeToggle'

// Rough password strength meter. Not security by itself -- it just nudges you
// towards something longer than "123456".
function scorePassword(password) {
  if (!password) return { score: 0, label: '' }

  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++

  return { score, label: ['very weak', 'weak', 'fair', 'good', 'strong', 'excellent'][score] }
}

// The preferences cookie is not httpOnly, so the page can read its own
// ciphertext straight out of the browser. This is real data, not a mock-up.
function readRawPrefsCookie() {
  const match = document.cookie.split('; ').find((c) => c.startsWith('prefs='))
  return match ? decodeURIComponent(match.slice('prefs='.length)) : null
}

// Exposed for the browser console during a demo: readRawPrefsCookie() shows the
// ciphertext the browser is holding.
if (typeof window !== 'undefined') window.readRawPrefsCookie = readRawPrefsCookie

export default function AuthPage({ prefs, onAuthenticated, onThemeChange }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [remember, setRemember] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const isRegister = mode === 'register'
  const strength = scorePassword(form.password)

  // The cookie doing its job before you have even signed in: the server
  // decrypted your last email and sent it back to pre-fill the form.
  const remembered = prefs?.lastEmail
  useEffect(() => {
    if (remembered) setForm((f) => ({ ...f, email: remembered }))
  }, [remembered])

  function update(field) {
    return (event) => setForm((f) => ({ ...f, [field]: event.target.value }))
  }

  function switchMode(next) {
    setMode(next)
    setError(null)
    setForm((f) => ({ ...f, password: '' }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setBusy(true)

    try {
      const result = isRegister
        ? await api.register(form)
        : await api.login({ email: form.email, password: form.password, remember })
      await onAuthenticated(result)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      {/* ---------------- left: the stage ---------------- */}
      <section className="stage">
        <div className="stage-top enter" style={{ '--i': 0 }}>
          <div className="wordmark">
            <svg className="dial" viewBox="0 0 32 32" aria-hidden="true">
              <circle className="dial-track" cx="16" cy="16" r="13" />
              <circle className="dial-teeth" cx="16" cy="16" r="13" />
              <circle className="dial-core" cx="16" cy="16" r="3.5" />
            </svg>
            SecureDesk
          </div>
        </div>

        <div className="stage-mid">
          <h1 className="display enter" style={{ '--i': 1 }}>
            Your session,
            <br />
            <span className="display-accent">sealed</span>.
          </h1>

          <p className="stage-sub enter" style={{ '--i': 2 }}>
            Passwords are hashed and never stored. The session cookie is
            invisible to scripts. Everything we remember about you rides along
            encrypted.
          </p>
        </div>
      </section>

      {/* ---------------- right: the form ---------------- */}
      <section className="form-side">
        <div className="form-top">
          <ThemeToggle theme={prefs?.theme} onChange={onThemeChange} />
        </div>

        <div className="form-card">
          <div className="switch" data-mode={mode}>
            <button
              type="button"
              className={!isRegister ? 'switch-btn on' : 'switch-btn'}
              onClick={() => switchMode('login')}
            >
              Sign in
            </button>
            <button
              type="button"
              className={isRegister ? 'switch-btn on' : 'switch-btn'}
              onClick={() => switchMode('register')}
            >
              Create account
            </button>
            <span className="switch-bar" />
          </div>

          <div className="form-head">
            <h2>
              {isRegister
                ? 'Create your account'
                : remembered
                  ? 'Welcome back'
                  : 'Sign in'}
            </h2>
            <p className="muted small">
              {isRegister
                ? 'Takes one form. Your password is hashed before it touches disk.'
                : remembered
                  ? 'We filled in your email from the cookie. Just the password.'
                  : 'Enter your details to start a session.'}
            </p>
          </div>

          {/* key={mode} replays the entrance animation when you switch tabs */}
          <form key={mode} onSubmit={handleSubmit} className="form">
            {isRegister && (
              <label className="field enter" style={{ '--i': 0 }}>
                <span className="label">Full name</span>
                <span className="input-wrap">
                  <input
                    value={form.name}
                    onChange={update('name')}
                    autoComplete="name"
                    placeholder="Tejas Jaiswal"
                    required
                  />
                  <i className="underline" />
                </span>
              </label>
            )}

            <label className="field enter" style={{ '--i': 1 }}>
              <span className="label">Email</span>
              <span className="input-wrap">
                <input
                  type="email"
                  value={form.email}
                  onChange={update('email')}
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                />
                <i className="underline" />
              </span>
            </label>

            <label className="field enter" style={{ '--i': 2 }}>
              <span className="label">Password</span>
              <span className="input-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={update('password')}
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  placeholder={isRegister ? 'At least 8 characters' : '••••••••'}
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  className="reveal"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'hide' : 'show'}
                </button>
                <i className="underline" />
              </span>
            </label>

            {isRegister && form.password && (
              <div className="strength">
                <div className="segments">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span
                      key={n}
                      className={n <= strength.score ? `seg on s${strength.score}` : 'seg'}
                    />
                  ))}
                </div>
                <span className="eyebrow">{strength.label}</span>
              </div>
            )}

            {!isRegister && (
              <label className="check enter" style={{ '--i': 3 }}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span className="box" aria-hidden="true" />
                <span>
                  Keep me signed in for 30 days
                  <span className="muted small block">
                    Off: the cookie is dropped when you close the browser.
                  </span>
                </span>
              </label>
            )}

            {error && <p className="error">{error}</p>}

            <button className="submit enter" style={{ '--i': 4 }} disabled={busy} type="submit">
              <span>
                {busy
                  ? isRegister
                    ? 'Creating account…'
                    : 'Checking…'
                  : isRegister
                    ? 'Create account'
                    : 'Sign in'}
              </span>
              <svg viewBox="0 0 16 16" aria-hidden="true" className="arrow">
                <path d="M2 8h11M9 4l4 4-4 4" />
              </svg>
            </button>
          </form>

          <p className="form-foot">
            {isRegister ? 'Already registered?' : 'First time here?'}{' '}
            <button
              type="button"
              className="link"
              onClick={() => switchMode(isRegister ? 'login' : 'register')}
            >
              {isRegister ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </div>
      </section>
    </div>
  )
}
