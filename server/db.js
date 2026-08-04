import Database from 'better-sqlite3'
import { config } from './config.js'

// SQLite = the whole database is one file on disk (server/data.db).
// No database server to install, but it is still real SQL.
export const db = new Database(config.dbFile)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL,
    last_login_at TEXT,
    login_count   INTEGER NOT NULL DEFAULT 0
  );

  -- One row per active login. Lets us log a device out from the server side,
  -- which a plain JWT-only design cannot do.
  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL,
    expires_at TEXT    NOT NULL,
    last_seen  TEXT    NOT NULL,
    user_agent TEXT,
    ip         TEXT,
    revoked_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`)

export const queries = {
  createUser: db.prepare(
    `INSERT INTO users (name, email, password_hash, created_at)
     VALUES (@name, @email, @password_hash, @created_at)`,
  ),
  findUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  findUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  recordLogin: db.prepare(
    `UPDATE users SET login_count = login_count + 1, last_login_at = ? WHERE id = ?`,
  ),

  createSession: db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen, user_agent, ip)
     VALUES (@id, @user_id, @created_at, @expires_at, @last_seen, @user_agent, @ip)`,
  ),
  findSession: db.prepare('SELECT * FROM sessions WHERE id = ?'),
  touchSession: db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?'),
  revokeSession: db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?'),
  revokeOtherSessions: db.prepare(
    `UPDATE sessions SET revoked_at = ?
     WHERE user_id = ? AND id != ? AND revoked_at IS NULL`,
  ),
  activeSessions: db.prepare(
    `SELECT id, created_at, last_seen, expires_at, user_agent, ip
     FROM sessions
     WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
     ORDER BY last_seen DESC`,
  ),
}
