// `npm run db` -- prints what is actually stored, for when you want to show
// someone that the database holds a hash and never the password itself.
import { query } from './db.js'

const { rows: users } = await query(
  `SELECT id, name, email, password_hash, created_at, last_login_at, login_count
   FROM users ORDER BY id`,
)

console.log(`\n${users.length} user${users.length === 1 ? '' : 's'}\n`)

for (const user of users) {
  const [, algorithm, cost] = user.password_hash.split('$')
  console.log(`  #${user.id}  ${user.name}  <${user.email}>`)
  console.log(`      registered   ${user.created_at.toISOString()}`)
  console.log(
    `      last login   ${user.last_login_at?.toISOString() ?? 'never'}  (${user.login_count} total)`,
  )
  console.log(`      password     ${user.password_hash}`)
  console.log(`                   ^ bcrypt (algo ${algorithm}, cost ${cost}) -- not reversible\n`)
}

const { rows: sessions } = await query(
  `SELECT id, user_id, created_at, expires_at, revoked_at
   FROM sessions ORDER BY created_at DESC LIMIT 10`,
)

console.log(`Last ${sessions.length} session(s)\n`)
for (const s of sessions) {
  const state = s.revoked_at ? 'revoked' : s.expires_at < new Date() ? 'expired' : 'active'
  console.log(
    `  ${s.id}  user ${s.user_id}  ${state.padEnd(7)}  started ${s.created_at.toISOString()}`,
  )
}
console.log()

process.exit(0)
