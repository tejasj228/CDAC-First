# SecureDesk

A login / register page that uses cookies the way a real application does: the
password is hashed, the session lives in an `httpOnly` cookie, and everything
the app remembers about you between visits travels in a second cookie that is
**encrypted with AES-256-GCM**.

Sign in once, close the browser, come back later — the page greets you by name,
pre-fills your email, restores your theme and tells you when you were last here.

---

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Frontend | React 19 + Vite | – |
| Backend | Express 5, as a Vercel serverless function | Same language as the frontend |
| Database | Postgres (Neon in production, embedded locally) | Free, managed, no server to run |
| Passwords | bcrypt, cost 12 | The standard for password storage |
| Session | JWT inside an `httpOnly` cookie | Scripts can't read it, users can't forge it |
| Preferences | AES-256-GCM encrypted cookie | Unreadable in the browser, tamper-evident |

---

## Run it

```bash
npm install
npm run dev
```

- App: http://localhost:5173
- API: http://localhost:4000

That's the whole setup — no database to install and no accounts to create. With
no `DATABASE_URL` set, the server runs [PGlite](https://pglite.dev): real
Postgres compiled to WebAssembly, running inside Node and saving to
`server/pgdata/`. The SQL is identical to what runs in production.

On the very first run the server also generates a `.env` file with random secret
keys. That file is git-ignored and must never be committed.

To develop against the real Neon database instead, put its connection string in
`.env` as `DATABASE_URL=postgresql://…`.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Frontend + backend together |
| `npm test` | Runs the full sign-in flow against an in-memory Postgres |
| `npm run db` | Prints the users table so you can see the stored hashes |
| `npm run build` | Builds the frontend into `dist/` |
| `npm start` | Production mode: one server serves both API and frontend |

---

## How to check the cookies yourself

**1. Look at them in the browser**

Open DevTools (`F12`) → **Application** tab → **Storage → Cookies →
http://localhost:5173**. After signing in there are two:

| Cookie | HttpOnly | What you see |
| --- | --- | --- |
| `sid` | ✅ ticked | A JWT: `header.payload.signature` |
| `prefs` | ❌ unticked | A block of base64 gibberish — this is the ciphertext |

**2. Prove `httpOnly` works.** In the **Console** tab, run:

```js
document.cookie
```

Only `prefs` comes back. `sid` is missing — that is `httpOnly` doing its job. A
malicious script injected into the page could not steal your session.

**3. Prove the preferences really are encrypted.** Still in the console:

```js
readRawPrefsCookie()
```

You get something like `A69x98w-Nw1vY31H.ORc7hcwljmOl…` — your email and theme
are in there, but unreadable without the server's key.

**4. See it decrypted.** On the dashboard, open **Cookie inspector → Show me the
cookies**. The left panel is what the page can read; the right panel is the same
data after the server verifies and decrypts it.

**5. Prove tampering is detected.** In DevTools → Application → Cookies, edit the
`prefs` value (change any character) and reload. Decryption fails the
authentication-tag check, so the app throws the cookie away and falls back to
defaults instead of trusting it.

**6. Check the database.** Run `npm run db` to print the users table. The
password column holds a bcrypt hash like `$2b$12$Xk9…` — the real password is
nowhere on disk.

---

## How it works

**Registering.** The password is hashed with bcrypt at cost 12. A random salt is
generated per user and stored inside the hash string, so two people with the same
password still get different hashes. Hashing is one-way: even with the database
in hand, nobody can read the password back out.

**Signing in.** The server checks the password, then writes a row in the
`sessions` table and puts a signed JWT holding that row's id into the `sid`
cookie. The JWT payload is only base64 — anyone can read it — which is exactly
why no secret goes inside it. What nobody can do is forge the signature without
the server's key, so a user can't edit the cookie to become someone else.

Because every login is a database row, sessions can be revoked server-side —
that is what **Sign out other devices** does. A JWT on its own cannot do that.

**Coming back later.** On page load the browser automatically sends both cookies.
The server verifies the JWT, looks the session up, and returns your profile plus
your decrypted preferences. Nothing was typed in.

**Cookie flags.**

| Flag | Prevents |
| --- | --- |
| `httpOnly` | JavaScript reading the cookie (XSS token theft) |
| `sameSite=lax` | The cookie being sent on cross-site requests (CSRF) |
| `secure` | The cookie travelling over plain HTTP (on in production) |
| signature / auth tag | The cookie being edited to say something else |

**Remember me.** Ticked, the cookie gets a 30-day `maxAge`. Unticked it has no
`maxAge` at all, which makes it a *session cookie* — the browser deletes it when
it closes.

Also included: rate limiting (5 failed attempts locks that email for 60 seconds,
counted in the database so it survives restarts and works across every server
instance), a login path that takes the same time whether or not the email exists
(so timing doesn't leak which emails are registered), and a password strength
meter.

---

## Deploying — everything on Vercel

The frontend is served from Vercel's CDN and the Express app runs as a single
serverless function (`api/index.js`), so the site and the API share one origin
and the cookies stay first-party. The database is Neon, Vercel's managed
Postgres. All three are free.

**1. Import the project.** On [vercel.com](https://vercel.com): **Add New →
Project**, import this repo, **Deploy**. Vite is detected automatically. The
first deploy will build fine but the API won't work yet — it has no database.

**2. Create the database.** In the project, go to the **Storage** tab → **Create
Database** → **Neon (Postgres)** → **Connect**. Vercel adds `DATABASE_URL` to the
project's environment variables for you. The tables are created automatically on
the first request.

**3. Add the two secret keys.** **Settings → Environment Variables**, add
`JWT_SECRET` and `PREFS_KEY`. Generate a different random value for each:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**4. Redeploy** so the function picks up the new variables: **Deployments → ⋯ on
the latest one → Redeploy**.

Open the URL and register an account. In DevTools → Application → Cookies you
should see `sid` and `prefs` on your `*.vercel.app` domain.

### Worth knowing

- **Don't change the keys later.** Rotating `JWT_SECRET` signs everyone out, and
  rotating `PREFS_KEY` makes existing preference cookies unreadable (the app
  falls back to defaults, so nothing breaks — people just lose their settings).
- **Neon's free database sleeps** after a few minutes idle and takes a second or
  two to wake. The first request after a quiet spell is slower.
- **`NODE_ENV=production` is set by Vercel automatically**, which is what turns
  on `Secure` cookies and `trust proxy`.

---

## What I'd add next

Refresh-token rotation, email verification, password reset, and a CSRF token for
defence in depth.
