import { useEffect, useState } from 'react'

import { api } from '../api'

/**
 * The demo piece. It puts the browser's view of the cookies next to the
 * server's view of the same cookies, which makes two points visible at once:
 *
 *  1. The session cookie is completely missing from document.cookie -> httpOnly
 *     is working, so a malicious script could not steal the login.
 *  2. The preferences cookie IS visible to JavaScript, but it is unreadable
 *     ciphertext until the server decrypts it with the secret key.
 */
export default function CookieInspector() {
  const [serverView, setServerView] = useState(null)
  const [clientCookies, setClientCookies] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    setClientCookies(document.cookie || '(nothing readable)')
    api.inspectCookies().then(setServerView).catch(() => setServerView(null))
  }, [open])

  return (
    <section className="panel">
      <div className="section-head">
        <h2>Cookie inspector</h2>
        <button className="ghost-button" onClick={() => setOpen((v) => !v)} type="button">
          {open ? 'Hide' : 'Show me the cookies'}
        </button>
      </div>
      <p className="muted small section-sub">
        A side-by-side of what the page can read versus what the server can read.
      </p>

      {open && (
        <>
          <div className="inspector-grid">
            <div className="inspector-card">
              <h3>What JavaScript in this page can see</h3>
              <p className="muted small">
                <code>document.cookie</code>
              </p>
              <pre className="code-block">{clientCookies}</pre>
              <p className="small">
                No <code>sid</code> here — the session cookie is{' '}
                <strong>httpOnly</strong>, so scripts simply cannot reach it.
                The <code>prefs</code> value is visible but it is ciphertext.
              </p>
            </div>

            <div className="inspector-card">
              <h3>What the server can see</h3>
              <p className="muted small">after verifying and decrypting</p>
              <pre className="code-block">
                {serverView
                  ? JSON.stringify(
                      {
                        sessionCookieValid: serverView.session.valid,
                        jwtPayload: serverView.session.decodedPayload,
                        decryptedPrefs: serverView.prefs.decrypted,
                      },
                      null,
                      2,
                    )
                  : 'Loading…'}
              </pre>
              <p className="small">
                The JWT payload is only base64, so anyone can read it — that is
                why it holds no secrets. What they cannot do is forge the
                signature without our key.
              </p>
            </div>
          </div>

          <div className="flags">
            <h3>Why each flag is set</h3>
            <table className="flag-table">
              <thead>
                <tr>
                  <th>Flag</th>
                  <th>Session cookie</th>
                  <th>Prefs cookie</th>
                  <th>What it prevents</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>httpOnly</code></td>
                  <td className="yes">yes</td>
                  <td className="no">no (on purpose, for this demo)</td>
                  <td>Script-based cookie theft (XSS)</td>
                </tr>
                <tr>
                  <td><code>sameSite=lax</code></td>
                  <td className="yes">yes</td>
                  <td className="yes">yes</td>
                  <td>Cross-site request forgery (CSRF)</td>
                </tr>
                <tr>
                  <td><code>secure</code></td>
                  <td className="yes">in production</td>
                  <td className="yes">in production</td>
                  <td>Being read off plain HTTP</td>
                </tr>
                <tr>
                  <td>signature / auth tag</td>
                  <td className="yes">JWT HMAC</td>
                  <td className="yes">GCM tag</td>
                  <td>Editing the cookie to become another user</td>
                </tr>
              </tbody>
            </table>
            <p className="small muted">
              Try it: open DevTools → Application → Cookies, change one character
              of the <code>prefs</code> value, and refresh. Decryption fails, and
              the app safely falls back to defaults instead of trusting it.
            </p>
          </div>
        </>
      )}
    </section>
  )
}
