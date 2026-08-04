import { config } from './config.js'
import { app } from './app.js'

// Runs the API as an ordinary Node server. This is what `npm run dev` and
// `npm start` use. On Vercel this file is never loaded -- api/index.js is.
app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`)
})
