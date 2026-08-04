// Vercel turns every file in /api into a serverless function. Exporting the
// Express app hands each request straight to it, so the same code runs locally
// and in production.
//
// vercel.json rewrites /api/* to this one function, and Express does the rest
// of the routing from there.
export { default } from '../server/app.js'
