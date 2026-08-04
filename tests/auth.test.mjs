/**
 * End-to-end test of the whole sign-in flow.
 *
 * It boots the real Express app against an in-process Postgres (PGlite), so it
 * needs no database account and no network -- but the SQL it runs is the exact
 * SQL that runs in production.
 *
 *   npm test
 */
process.env.USE_EMBEDDED_DB = '1'
process.env.JWT_SECRET ||= 'test-jwt-secret-value-long-enough'
process.env.PREFS_KEY ||= 'test-prefs-key-value-long-enough'

const { app } = await import('../server/app.js')

const server = app.listen(0)
await new Promise((resolve) => server.once('listening', resolve))
const BASE = `http://localhost:${server.address().port}/api`

/* ---------- a tiny browser-like cookie jar ---------- */

const jar = new Map()

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(';')
    const idx = pair.indexOf('=')
    const name = pair.slice(0, idx)
    const value = pair.slice(idx + 1)
    if (value === '') jar.delete(name)
    else jar.set(name, value)
  }

  return { status: res.status, data: await res.json().catch(() => null) }
}

/* ---------- assertions ---------- */

let failures = 0
const ok = (label, condition, extra = '') => {
  if (!condition) failures++
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${extra ? `  -> ${extra}` : ''}`)
}

/* ---------- the flow ---------- */

const email = 'Tejas@Example.com' // deliberately mixed case
const password = 'CorrectHorse9!'

let r = await call('/register', {
  method: 'POST',
  body: { name: 'Tejas Jaiswal', email, password },
})
ok('register creates the account', r.status === 201 && r.data.user.email === email)
ok('session cookie was set', jar.has('sid'))
ok('prefs cookie was set', jar.has('prefs'))
ok('prefs cookie is ciphertext (email not readable)', !jar.get('prefs').includes('ejas'))

r = await call('/session')
ok('cookie alone identifies the user', r.data.user?.email === email)
ok('one active session listed', r.data.sessions.length === 1)
ok('session records the device', r.data.sessions[0]?.user_agent?.includes('Chrome'))

r = await call('/cookie-inspector')
ok('server decrypts the prefs cookie', r.data.prefs.decrypted?.lastEmail === email)
ok(
  'JWT payload is readable but signed',
  Boolean(r.data.session.decodedPayload?.sid) && r.data.session.valid,
)

await call('/logout', { method: 'POST' })
ok('session cookie cleared on logout', !jar.has('sid'))
ok('prefs cookie survives logout', jar.has('prefs'))

r = await call('/session')
ok('logged out -> no user', r.data.user === null)
ok('...but the email is still remembered', r.data.prefs.lastEmail === email)
ok('...and the theme is still remembered', r.data.prefs.theme === 'dark')

// Signing back in with different capitalisation must find the same account.
r = await call('/login', {
  method: 'POST',
  body: { email: 'tejas@example.com', password, remember: true },
})
ok('login is case-insensitive on email', r.status === 200)
ok('server reports the PREVIOUS login time', Boolean(r.data.user.previousLoginAt))
ok('login count incremented', r.data.user.loginCount === 2, `count=${r.data.user.loginCount}`)

r = await call('/session')
ok('visit counter in cookie incremented', r.data.prefs.visits === 2, `visits=${r.data.prefs.visits}`)
ok('previous visit recorded in cookie', Boolean(r.data.prefs.previousVisitAt))

r = await call('/prefs', { method: 'PATCH', body: { theme: 'light' } })
ok('theme saved to encrypted cookie', r.data.prefs.theme === 'light')
r = await call('/session')
ok('theme read back from cookie', r.data.prefs.theme === 'light')

// Tampering
const goodPrefs = jar.get('prefs')
jar.set('prefs', goodPrefs.slice(0, -4) + 'AAAA')
r = await call('/session')
ok('tampered prefs cookie falls back to defaults', r.data.prefs.lastEmail === null)
jar.set('prefs', goodPrefs)

const goodSid = jar.get('sid')
jar.set('sid', goodSid.slice(0, -6) + 'abcdef')
r = await call('/session')
ok('forged JWT signature is rejected', r.data.user === null)
jar.set('sid', goodSid)
r = await call('/session')
ok('real cookie still works afterwards', r.data.user?.email === email)

// Two devices, then revoke
const firstDevice = new Map(jar)
jar.clear()
await call('/login', { method: 'POST', body: { email, password } })
const secondDevice = new Map(jar)

jar.clear()
for (const [k, v] of firstDevice) jar.set(k, v)
r = await call('/session')
ok('two devices signed in', r.data.sessions.length === 2, `n=${r.data.sessions.length}`)

r = await call('/sessions/revoke-others', { method: 'POST' })
ok('revoked the other device', r.data.revoked === 1)

jar.clear()
for (const [k, v] of secondDevice) jar.set(k, v)
r = await call('/session')
ok('revoked device is signed out', r.data.user === null)

// Lockout
jar.clear()
let lastStatus = 0
for (let i = 0; i < 6; i++) {
  const res = await call('/login', { method: 'POST', body: { email, password: 'wrong-password' } })
  lastStatus = res.status
}
ok('locked out after repeated failures', lastStatus === 429, `status=${lastStatus}`)

r = await call('/login', { method: 'POST', body: { email: 'TEJAS@example.com', password } })
ok('lockout is case-insensitive too', r.status === 429)

// Validation
r = await call('/register', { method: 'POST', body: { name: 'Someone', email, password } })
ok('duplicate email rejected', r.status === 409)

r = await call('/register', {
  method: 'POST',
  body: { name: 'Someone', email: 'other@example.com', password: 'short' },
})
ok('short password rejected', r.status === 400)

r = await call('/register', {
  method: 'POST',
  body: { name: 'Someone', email: 'not-an-email', password: 'CorrectHorse9!' },
})
ok('invalid email rejected', r.status === 400)

/* ---------- done ---------- */

server.close()
console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`)
process.exit(failures === 0 ? 0 : 1)
