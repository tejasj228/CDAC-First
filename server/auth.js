import crypto from 'node:crypto'
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

import { config } from './config.js'
import { queries } from './db.js'
import { encrypt, decrypt } from './secure-cookie.js'

export const router = express.Router()

export const SESSION_COOKIE = 'sid'
export const PREFS_COOKIE = 'prefs'

const now = () => new Date().toISOString()

/* ------------------------------------------------------------------ *
 * Cookies
 * ------------------------------------------------------------------ */

// These flags are the whole security story of a cookie, so they are worth
// knowing by heart:
//   httpOnly -> JavaScript (document.cookie) cannot read it. Stops an XSS
//               attack from stealing the login token.
//   sameSite -> the browser refuses to send it on cross-site requests, which
//               is what blocks CSRF.
//   secure   -> only ever sent over HTTPS. Off in dev because localhost is HTTP.
//   maxAge   -> how long the browser keeps it. Omit it and the cookie dies when
//               the browser closes (a "session cookie").
const sessionCookieOptions = (maxAgeMs) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProd,
  path: '/',
  ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
})

// The preferences cookie is deliberately NOT httpOnly so the demo page can show
// you the raw value with document.cookie. It is safe to expose because the
// contents are encrypted -- the browser only ever holds ciphertext.
const prefsCookieOptions = () => ({
  httpOnly: false,
  sameSite: 'lax',
  secure: config.isProd,
  path: '/',
  maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
})

// Everything in here lives ONLY in the browser cookie (encrypted), never in the
// database. This is the "context" we reload the next time you come back.
const DEFAULT_PREFS = {
  theme: 'dark',
  accent: 'violet',
  lastEmail: null,
  lastName: null,
  lastVisitAt: null,
  previousVisitAt: null,
  visits: 0,
}

export function readPrefs(req) {
  const decrypted = decrypt(req.cookies?.[PREFS_COOKIE])
  return { ...DEFAULT_PREFS, ...(decrypted || {}) }
}

export function writePrefs(res, prefs) {
  res.cookie(PREFS_COOKIE, encrypt(prefs), prefsCookieOptions())
  return prefs
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  createdAt: user.created_at,
  lastLoginAt: user.last_login_at,
  loginCount: user.login_count,
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateCredentials({ email, password, name }, { needName }) {
  if (needName && (!name || name.trim().length < 2)) return 'Please enter your name.'
  if (!email || !EMAIL_RE.test(email)) return 'Please enter a valid email address.'
  if (!password || password.length < 8) return 'Password must be at least 8 characters.'
  return null
}

// Very small in-memory brute-force guard. A real deployment would keep this in
// Redis so it survives a restart and works across multiple servers.
const failedAttempts = new Map()

function lockoutRemaining(key) {
  const entry = failedAttempts.get(key)
  if (!entry || entry.count < config.maxFailedLogins) return 0
  const remaining = entry.lockedUntil - Date.now()
  if (remaining <= 0) {
    failedAttempts.delete(key)
    return 0
  }
  return Math.ceil(remaining / 1000)
}

function noteFailure(key) {
  const entry = failedAttempts.get(key) || { count: 0, lockedUntil: 0 }
  entry.count += 1
  if (entry.count >= config.maxFailedLogins) {
    entry.lockedUntil = Date.now() + config.lockoutSeconds * 1000
  }
  failedAttempts.set(key, entry)
  return Math.max(0, config.maxFailedLogins - entry.count)
}

function startSession(req, res, user, remember) {
  const maxAgeMs = remember
    ? config.rememberMeDays * 24 * 60 * 60 * 1000
    : config.sessionMinutes * 60 * 1000

  const sessionId = crypto.randomUUID()
  const createdAt = now()

  queries.createSession.run({
    id: sessionId,
    user_id: user.id,
    created_at: createdAt,
    expires_at: new Date(Date.now() + maxAgeMs).toISOString(),
    last_seen: createdAt,
    user_agent: req.get('user-agent') ?? null,
    ip: req.ip ?? null,
  })
  queries.recordLogin.run(createdAt, user.id)

  // The cookie holds a signed JWT, not the user id on its own. Anyone can read
  // the payload, but without the secret key nobody can forge the signature --
  // so a user cannot edit the cookie to become someone else.
  const token = jwt.sign({ sid: sessionId, uid: user.id }, config.jwtSecret, {
    expiresIn: Math.floor(maxAgeMs / 1000),
  })

  // "remember me" off -> no maxAge -> cookie is dropped when the browser closes.
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(remember ? maxAgeMs : null))

  return sessionId
}

// Reads the cookie and turns it back into a user. Returns null when there is no
// valid login. Every protected route goes through this.
function currentAuth(req) {
  const token = req.cookies?.[SESSION_COOKIE]
  if (!token) return null

  let payload
  try {
    payload = jwt.verify(token, config.jwtSecret) // checks signature + expiry
  } catch {
    return null
  }

  const session = queries.findSession.get(payload.sid)
  if (!session || session.revoked_at) return null
  if (session.expires_at <= now()) return null

  const user = queries.findUserById.get(session.user_id)
  if (!user) return null

  queries.touchSession.run(now(), session.id)
  return { user, session }
}

function requireAuth(req, res, next) {
  const auth = currentAuth(req)
  if (!auth) {
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions())
    return res.status(401).json({ error: 'Not signed in.' })
  }
  req.auth = auth
  next()
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

// Called on every page load. Works signed in OR signed out: when signed out it
// still returns the remembered preferences so the page can pre-fill the email
// and restore the theme.
router.get('/session', (req, res) => {
  const auth = currentAuth(req)
  const prefs = readPrefs(req)

  res.json({
    user: auth ? publicUser(auth.user) : null,
    prefs,
    sessions: auth
      ? queries.activeSessions.all(auth.user.id, now()).map((s) => ({
          ...s,
          current: s.id === auth.session.id,
        }))
      : [],
  })
})

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body ?? {}

  const problem = validateCredentials({ name, email, password }, { needName: true })
  if (problem) return res.status(400).json({ error: problem })

  if (queries.findUserByEmail.get(email)) {
    return res.status(409).json({ error: 'That email is already registered.' })
  }

  // bcrypt with a cost of 12: the salt is generated per user and stored inside
  // the hash string, and the cost makes brute-forcing the hash slow on purpose.
  const password_hash = await bcrypt.hash(password, 12)

  const info = queries.createUser.run({
    name: name.trim(),
    email: email.trim(),
    password_hash,
    created_at: now(),
  })

  const user = queries.findUserById.get(info.lastInsertRowid)
  startSession(req, res, user, false)

  writePrefs(res, {
    ...readPrefs(req),
    lastEmail: user.email,
    lastName: user.name,
    lastVisitAt: now(),
    previousVisitAt: null,
    visits: 1,
  })

  res.status(201).json({
    user: { ...publicUser(user), loginCount: 1, previousLoginAt: null },
  })
})

router.post('/login', async (req, res) => {
  const { email, password, remember = false } = req.body ?? {}

  const problem = validateCredentials({ email, password }, { needName: false })
  if (problem) return res.status(400).json({ error: problem })

  const key = String(email).toLowerCase()
  const locked = lockoutRemaining(key)
  if (locked) {
    return res
      .status(429)
      .json({ error: `Too many failed attempts. Try again in ${locked}s.` })
  }

  const user = queries.findUserByEmail.get(email)

  // Compare against a dummy hash when the user does not exist so that both
  // cases take the same amount of time -- otherwise the response time alone
  // would tell an attacker which emails are registered.
  const hash = user?.password_hash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv'
  const ok = await bcrypt.compare(password, hash)

  if (!user || !ok) {
    const left = noteFailure(key)
    return res.status(401).json({
      error: 'Incorrect email or password.',
      attemptsLeft: left,
    })
  }

  failedAttempts.delete(key)

  // Grab the "before" values first -- once startSession runs, last_login_at is
  // this login, and we want to show the user their PREVIOUS one.
  const previousLoginAt = user.last_login_at
  startSession(req, res, user, Boolean(remember))

  const prefs = readPrefs(req)
  writePrefs(res, {
    ...prefs,
    lastEmail: user.email,
    lastName: user.name,
    previousVisitAt: prefs.lastVisitAt,
    lastVisitAt: now(),
    visits: (prefs.visits || 0) + 1,
  })

  res.json({
    user: {
      ...publicUser(user),
      loginCount: user.login_count + 1,
      previousLoginAt,
    },
  })
})

router.post('/logout', (req, res) => {
  const auth = currentAuth(req)
  // Revoke server-side too, so a copied cookie is useless after logout.
  if (auth) queries.revokeSession.run(now(), auth.session.id)

  res.clearCookie(SESSION_COOKIE, sessionCookieOptions())
  // The preferences cookie deliberately survives logout -- that is what lets us
  // greet the user by name and keep their theme next time.
  res.json({ ok: true })
})

router.patch('/prefs', (req, res) => {
  const { theme, accent } = req.body ?? {}
  const prefs = readPrefs(req)

  if (theme === 'dark' || theme === 'light') prefs.theme = theme
  if (typeof accent === 'string' && /^[a-z]{3,12}$/.test(accent)) prefs.accent = accent

  writePrefs(res, prefs)
  res.json({ prefs })
})

router.post('/sessions/revoke-others', requireAuth, (req, res) => {
  const info = queries.revokeOtherSessions.run(now(), req.auth.user.id, req.auth.session.id)
  res.json({ revoked: info.changes })
})

// Demo endpoint: shows exactly what the browser sent us and what it decodes to.
// Handy for explaining the design; you would not ship this in production.
router.get('/cookie-inspector', (req, res) => {
  const raw = req.cookies ?? {}
  const token = raw[SESSION_COOKIE]

  let jwtPayload = null
  if (token) {
    const [, body] = token.split('.')
    // The payload is only base64 -- readable by anyone. That is exactly why no
    // secret ever goes inside a JWT. The signature is what makes it trustworthy.
    try {
      jwtPayload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    } catch {
      jwtPayload = null
    }
  }

  res.json({
    cookiesReceived: Object.keys(raw),
    session: {
      present: Boolean(token),
      raw: token ?? null,
      decodedPayload: jwtPayload,
      valid: Boolean(currentAuth(req)),
    },
    prefs: {
      raw: raw[PREFS_COOKIE] ?? null,
      decrypted: decrypt(raw[PREFS_COOKIE]),
    },
  })
})

export { requireAuth, currentAuth }
