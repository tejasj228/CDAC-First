import { config } from './config.js'
import { app } from './app.js'
import { closeDb } from './db.js'

// Runs the API as an ordinary Node server. This is what `npm run dev` and
// `npm start` use. On Vercel this file is never loaded -- api/index.js is.
const server = app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`)
})

// Shut the database down before exiting. Without this, stopping the dev server
// (or letting --watch restart it) can interrupt a write and leave the local
// embedded database unreadable.
let closing = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (closing) return
    closing = true
    server.close()
    await closeDb().catch(() => {})
    process.exit(0)
  })
}
