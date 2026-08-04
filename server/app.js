import path from 'node:path'
import express from 'express'
import cookieParser from 'cookie-parser'

import { config, rootDir } from './config.js'
import { router as authRouter } from './auth.js'

// The Express app on its own, with no server attached. Two things import it:
// server/index.js (runs it as a normal Node server for local development) and
// api/index.js (hands it to Vercel as a serverless function).
export const app = express()

// Vercel and every other host sit behind a load balancer. Without this, Express
// thinks each request arrived over plain HTTP and would refuse to send Secure
// cookies -- and req.ip would be the balancer, not the visitor.
if (config.isProd) app.set('trust proxy', 1)

app.use(express.json({ limit: '10kb' }))
app.use(cookieParser())

// A few standard hardening headers. One line each, easy to explain.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff') // don't guess file types
  res.setHeader('X-Frame-Options', 'DENY') // can't be iframed (clickjacking)
  res.setHeader('Referrer-Policy', 'same-origin')
  next()
})

app.get('/api/health', (req, res) => res.json({ ok: true }))
app.use('/api', authRouter)

// On Vercel the built React app is served by their CDN, so Express only ever
// handles /api. Running as a plain Node server (npm start) it serves the site
// too, which keeps the site and API on one origin.
if (config.serveStatic) {
  const dist = path.join(rootDir, 'dist')
  app.use(express.static(dist))

  // Anything that isn't an API call falls through to index.html so the React
  // app can handle the route.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
    res.sendFile(path.join(dist, 'index.html'))
  })
}

// Must be registered last: Express only treats a four-argument middleware as an
// error handler, and only ones declared after the failing route can catch it.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: 'Something went wrong on the server.' })
})

export default app
