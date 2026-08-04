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
| Backend | Express 5 | Same language as the frontend |
| Database | SQLite (one file, `server/data.db`) | No database server to install |
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

`npm run dev` starts both. On the very first run the server generates a `.env`
file with random secret keys — that file is git-ignored and must never be
committed.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Frontend + backend together |
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

Also included: rate limiting (5 failed attempts locks that email for 60 seconds),
a login path that takes the same time whether or not the email exists (so timing
doesn't leak which emails are registered), and a password strength meter.

---

## Deploying

SQLite is a file on the server's disk, so the backend needs a host that runs a
real Node process. Vercel's serverless functions don't keep a disk between
requests, so the API goes on **Render** either way.

### Option A — everything on Render (simplest)

One service serves the API *and* the built React app, so both share an origin and
the cookies just work.

1. Push this repo to GitHub.
2. On [render.com](https://render.com): **New → Blueprint**, pick the
   `CDAC-First` repo. The included `render.yaml` fills in everything:
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Env vars `JWT_SECRET` and `PREFS_KEY` are generated for you
3. Click **Apply**. You get a URL like `https://securedesk.onrender.com`.

If you'd rather not use the blueprint, create a **Web Service** manually with the
same two commands, then add three environment variables: `NODE_ENV=production`,
plus long random values for `JWT_SECRET` and `PREFS_KEY`. Generate them with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Option B — frontend on Vercel, backend on Render

Do Option A first so the backend exists. Then:

1. Edit `vercel.json` and replace `securedesk.onrender.com` with your real Render
   host.
2. On [vercel.com](https://vercel.com): **Add New → Project**, import the repo,
   deploy. Vite is detected automatically.

The `rewrites` rule in `vercel.json` makes Vercel forward `/api/*` to Render
behind the scenes. The browser only ever talks to the Vercel domain, so the login
cookie stays first-party — no CORS setup and no `SameSite=None`, which modern
browsers increasingly block.

### Two things to know about the free tiers

- **Render's free instances sleep** after 15 minutes idle. The first request
  afterwards takes ~50 seconds while it wakes up. Load the page once before
  demoing it.
- **The SQLite file is not permanent on the free plan.** A redeploy or restart
  wipes registered users. Fine for a demo; for real persistence attach a Render
  disk (paid) or move to Postgres.

---

## What I'd add next

Refresh-token rotation, email verification, password reset, a CSRF token for
defence in depth, and moving the rate limiter into Redis so it survives restarts
and works across several servers.
