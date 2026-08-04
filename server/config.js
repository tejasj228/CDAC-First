import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const isProd = process.env.NODE_ENV === 'production'
const envPath = path.join(rootDir, '.env')

// In development there are no secret keys on the first run, so we generate them
// and save them to .env (which is git-ignored). Hard-coding secrets in source is
// the classic beginner mistake, so we never do it.
//
// In production nothing is generated: the host (Render, etc.) supplies the keys
// as environment variables. Generating them there would mean a new key on every
// restart, which would silently log everybody out.
if (!isProd && !fs.existsSync(envPath)) {
  const key = () => crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(
    envPath,
    [
      '# Auto-generated on first run. NEVER commit this file.',
      `JWT_SECRET=${key()}`,
      `PREFS_KEY=${key()}`,
      'API_PORT=4000',
      '',
    ].join('\n'),
  )
  console.log('[config] created .env with freshly generated secret keys')
}

if (fs.existsSync(envPath)) process.loadEnvFile(envPath)

for (const name of ['JWT_SECRET', 'PREFS_KEY']) {
  const value = process.env[name]
  if (!value || value.length < 16) {
    throw new Error(
      `Missing or too-short ${name}. Set it as an environment variable on your ` +
        `host (generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")`,
    )
  }
}

// AES-256 needs a key of exactly 32 bytes. Hashing whatever secret string we
// were given always produces exactly 32 bytes, so any host's generated secret
// works without us having to demand a precise format.
const prefsKey = crypto.createHash('sha256').update(process.env.PREFS_KEY).digest()

export const config = {
  // API_PORT first so a PORT set for the frontend dev server can't hijack the
  // API locally; PORT second because that is what hosts like Render provide.
  port: Number(process.env.API_PORT || process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET,
  prefsKey,
  isProd,
  dbFile: process.env.DB_FILE || path.join(rootDir, 'server', 'data.db'),

  // How long a login lasts.
  sessionMinutes: 30, // normal login: cookie dies with the browser session
  rememberMeDays: 30, // "remember me": long-lived cookie

  // Brute-force protection.
  maxFailedLogins: 5,
  lockoutSeconds: 60,
}
