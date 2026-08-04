import path from 'node:path'
import express from 'express'
import cookieParser from 'cookie-parser'

import { config, rootDir } from './config.js'
import './db.js' // creates the tables on first import
import { router as authRouter } from './auth.js'

const app = express()

// Hosts like Render sit behind a load balancer. Without this, Express thinks
// every request arrived over plain HTTP and would refuse to send Secure
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

// In production this one server also serves the built React app, so the site
// and the API share an origin and the cookies stay first-party.
if (config.isProd) {
  const dist = path.join(rootDir, 'dist')
  app.use(express.static(dist))

  // Anything that isn't an API call falls through to index.html so the React
  // app can handle the route.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
    res.sendFile(path.join(dist, 'index.html'))
  })
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: 'Something went wrong on the server.' })
})

app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`)
})
