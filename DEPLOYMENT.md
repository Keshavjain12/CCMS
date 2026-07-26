# Deploying CCMS

CCMS is two deployables plus a database:

| Piece | What it is | Example host |
|---|---|---|
| **PostgreSQL** | The data store | Render Postgres, Neon, Railway, Supabase, RDS |
| **Backend** | Express API (`backend/`) | Render / Railway / Fly.io Web Service, or a VPS |
| **Frontend** | Static SPA (`frontend/`) | Render / Netlify Static Site, or the same host |

There is **no build step** — the frontend is plain HTML/CSS/JS. You only need
Node 18+ for the backend.

The walkthrough below uses **Render** because it can host all three on one
dashboard, but the environment variables are identical everywhere.

---

## 1 · Create a hosted PostgreSQL

1. Render dashboard → **New → Postgres** → name it (e.g. `ccms-db`) → **Create**.
2. Open it and copy the **External Database URL** — it looks like
   `postgresql://user:pass@host.oregon-postgres.render.com/ccms_xxxx`.
   That single string is your **`DATABASE_URL`**.

When `DATABASE_URL` is set, the app uses it instead of the discrete `PG*` vars
and **turns on TLS automatically** (managed databases require it). No other DB
config is needed.

---

## 2 · Deploy the backend

Render → **New → Web Service** → connect your GitHub repo, then:

| Setting | Value |
|---|---|
| **Root Directory** | `backend` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |

Add these **Environment Variables**:

| Key | Value / how to get it |
|---|---|
| `DATABASE_URL` | paste from step 1 |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `TRUST_PROXY` | `true` |
| `CORS_ORIGIN` | your frontend URL (fill in after step 4, then redeploy) |
| `COOKIE_SAMESITE` | `none` (frontend & backend are different hosts) — use `lax` if same host |
| `SAP_USE_MOCK` | `true` (leave mock unless you have real SAP) |
| `NOTIFY_MODE` | `mock` — or `live` plus the `SMTP_*` vars below for real email |

For real email in `live` mode also set: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `SMTP_FROM`.

Deploy, and note the backend URL, e.g. `https://ccms-api.onrender.com`.

> The server **will not boot** in production without a strong `JWT_SECRET`, and
> in production it enforces HTTPS, sends HSTS, and marks the auth cookie
> `Secure` — all automatic from `NODE_ENV=production`.

---

## 3 · Seed the database (once)

In the backend service → **Shell** tab:

```bash
npm run init-db
```

It applies the schema and seed data. Because `NODE_ENV=production`, it also
**rotates every seeded account's password to a fresh random one and prints them
once** — copy them somewhere safe; these become your live logins. (Nothing
published in the repo can sign in to your database.)

To reset a password later:

```bash
npm run reset-password -- admin@orientpaper.com   # one account
npm run reset-password -- --all                   # everyone
```

Restart the service afterward (it caches users at boot).

---

## 4 · Deploy the frontend

Render → **New → Static Site** → same repo:

| Setting | Value |
|---|---|
| **Root Directory** | `frontend` |
| **Publish Directory** | `.` |
| **Build Command** | *(leave blank — no build)* |

**Create the runtime config.** `frontend/env/config.js` is git-ignored (the local
one holds demo emails), so it won't exist on a fresh clone and the app would fall
back to `localhost:3000`. Make a **production** config — it contains only the
public API URL, so it is safe to commit — and force-add it:

```js
// frontend/env/config.js
window.CCMS_ENV = Object.freeze({
  API_BASE_URL: "https://ccms-api.onrender.com",   // ← your backend URL
  SHOW_DEMO_ACCOUNTS: false,
  DEMO_ACCOUNTS: []
});
```

```bash
git add -f frontend/env/config.js
git commit -m "Add production frontend config"
git push
```

Deploy, then note the frontend URL (e.g. `https://ccms.onrender.com`).

---

## 5 · Close the loop

1. Go back to the **backend** service and set `CORS_ORIGIN` to the frontend URL,
   then redeploy.
2. Open the frontend URL and sign in with a login from step 3.

### Cross-domain cookie checklist

The frontend and backend are on different hosts, so the auth cookie is
cross-site. It only rides along when **all** of these are true — they are, if you
followed the steps:

- `NODE_ENV=production` → cookie is `Secure` (both sites are HTTPS)
- `COOKIE_SAMESITE=none`
- `TRUST_PROXY=true`
- `CORS_ORIGIN` lists the exact frontend origin

If login "succeeds" but you're immediately bounced to the login screen, one of
these is missing.

> **Simpler alternative:** serve the frontend from the backend so everything is
> one origin — then you can drop `CORS_ORIGIN`/`COOKIE_SAMESITE=none` entirely.
> Ask if you'd like that wired up.

---

## Quick reference — required backend env vars

```
DATABASE_URL=postgres://user:pass@host:5432/dbname
NODE_ENV=production
JWT_SECRET=<48+ random bytes>
CORS_ORIGIN=https://your-frontend-url
COOKIE_SAMESITE=none
TRUST_PROXY=true
SAP_USE_MOCK=true
NOTIFY_MODE=mock
```

See [`backend/.env.example`](backend/.env.example) for the full, annotated list.
