import pg from 'pg'

import { config } from './config.js'

/**
 * Postgres access.
 *
 * Everything goes through query()/exec() so there is exactly one place that
 * knows how we talk to the database. In production that is Neon over the
 * network; `npm test` swaps in an in-process Postgres so the suite can run
 * without a database account.
 */

let backendPromise

async function getBackend() {
  if (backendPromise) return backendPromise

  backendPromise = (async () => {
    if (config.useEmbeddedDb) {
      const { PGlite } = await import('@electric-sql/pglite')
      // No argument = in memory; a path = persisted to that folder.
      const db = new PGlite(config.embeddedDbPath)
      return {
        // PGlite calls it affectedRows; node-postgres calls it rowCount. Line
        // them up here so no caller has to care which one it is talking to.
        query: async (text, params) => {
          const result = await db.query(text, params)
          return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
        },
        exec: (text) => db.exec(text),
      }
    }

    // A small pool: serverless functions are short-lived and Neon's pooled
    // connection string already has PgBouncer in front of the database.
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    })
    return {
      query: (text, params) => pool.query(text, params),
      exec: (text) => pool.query(text),
    }
  })()

  return backendPromise
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            SERIAL      PRIMARY KEY,
    name          TEXT        NOT NULL,
    email         TEXT        NOT NULL,
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ,
    login_count   INTEGER     NOT NULL DEFAULT 0
  );

  -- Unique on the lowercased email, so Tejas@x.com and tejas@x.com are one
  -- account. Postgres has no "case-insensitive column" the way SQLite does.
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

  -- One row per active login. Lets us sign a device out from the server side,
  -- which a plain JWT-only design cannot do.
  CREATE TABLE IF NOT EXISTS sessions (
    id         UUID        PRIMARY KEY,
    user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_agent TEXT,
    ip         TEXT,
    revoked_at TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

  -- Failed sign-in counter. In the database rather than in memory so it keeps
  -- working across restarts and across every server instance.
  CREATE TABLE IF NOT EXISTS login_attempts (
    email        TEXT PRIMARY KEY,
    fails        INTEGER     NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ
  );
`

let schemaPromise

// Creating the tables is idempotent, so we just make sure it has happened once
// per running instance before the first query.
export async function ensureSchema() {
  const backend = await getBackend()
  schemaPromise ??= backend.exec(SCHEMA)
  await schemaPromise
  return backend
}

export async function query(text, params) {
  const backend = await ensureSchema()
  return backend.query(text, params)
}

// Small helpers so the routes read cleanly.
const rows = async (text, params) => (await query(text, params)).rows
const one = async (text, params) => (await rows(text, params))[0] ?? null

export const db = {
  createUser: (user) =>
    one(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [user.name, user.email, user.password_hash],
    ),

  findUserByEmail: (email) =>
    one('SELECT * FROM users WHERE lower(email) = lower($1)', [email]),

  findUserById: (id) => one('SELECT * FROM users WHERE id = $1', [id]),

  recordLogin: (userId) =>
    one(
      `UPDATE users SET login_count = login_count + 1, last_login_at = now()
       WHERE id = $1
       RETURNING *`,
      [userId],
    ),

  createSession: (session) =>
    one(
      `INSERT INTO sessions (id, user_id, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [session.id, session.user_id, session.expires_at, session.user_agent, session.ip],
    ),

  // Only ever returns a session that is still usable.
  findLiveSession: (id) =>
    one(
      `SELECT * FROM sessions
       WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [id],
    ),

  touchSession: (id) => query('UPDATE sessions SET last_seen = now() WHERE id = $1', [id]),

  revokeSession: (id) =>
    query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [id]),

  revokeOtherSessions: async (userId, keepId) =>
    (
      await query(
        `UPDATE sessions SET revoked_at = now()
         WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
        [userId, keepId],
      )
    ).rowCount,

  activeSessions: (userId) =>
    rows(
      `SELECT id, created_at, last_seen, expires_at, user_agent, ip
       FROM sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY last_seen DESC`,
      [userId],
    ),

  /* ---- brute-force protection ---- */

  lockoutFor: (email) =>
    one(
      `SELECT CEIL(EXTRACT(EPOCH FROM (locked_until - now())))::int AS seconds_left
       FROM login_attempts
       WHERE email = lower($1) AND locked_until > now()`,
      [email],
    ),

  noteFailedLogin: (email, maxFails, lockSeconds) =>
    one(
      `INSERT INTO login_attempts (email, fails) VALUES (lower($1), 1)
       ON CONFLICT (email) DO UPDATE
         SET fails = login_attempts.fails + 1,
             locked_until = CASE
               WHEN login_attempts.fails + 1 >= $2 THEN now() + make_interval(secs => $3)
               ELSE NULL
             END
       RETURNING fails, locked_until`,
      [email, maxFails, lockSeconds],
    ),

  clearFailedLogins: (email) =>
    query('DELETE FROM login_attempts WHERE email = lower($1)', [email]),
}
