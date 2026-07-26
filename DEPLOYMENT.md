# Deploying CCMS

CCMS deploys as **one web service plus a database** — the backend serves the
frontend too, so there is a single origin (no CORS, no cross-domain cookies, no
separate static site to wire up).

| Piece | What it is | Example host |
|---|---|---|
| **PostgreSQL** | The data store | Render Postgres, Neon, Railway, Supabase, RDS |
| **Web service** | Express API **+** the static SPA (`backend/` serves `frontend/`) | Render / Railway / Fly.io, or a VPS |

There is **no build step** and **no separate frontend host**. You need Node 18+.

The walkthrough uses **Render**; the environment variables are the same anywhere.

---

## 1 · Create a hosted PostgreSQL

1. Render dashboard → **New → Postgres** → name it (e.g. `ccms-db`) → **Create**.
2. Open it and copy the **External Database URL** — it looks like
   `postgresql://user:pass@host.oregon-postgres.render.com/ccms_xxxx`.
   That single string is your **`DATABASE_URL`**.

> Use the **External** URL — it requires TLS, which the app enables automatically
> whenever `DATABASE_URL` is set. No other DB config is needed.

---

## 2 · Create the web service

Render → **New → Web Service** → connect your GitHub repo, then:

| Setting | Value |
|---|---|
| **Root Directory** | `backend` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |

Add these **Environment Variables**:

| Key | Value / how to get it |
|---|---|
| `DATABASE_URL` | paste the External URL from step 1 |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `TRUST_PROXY` | `true` |
| `SAP_USE_MOCK` | `true` (leave mock unless you have real SAP) |
| `NOTIFY_MODE` | `mock` — or `live` plus the `SMTP_*` vars for real email |

For real email in `live` mode also set: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `SMTP_FROM`.

That's the whole list — because it's one origin you **don't** need `CORS_ORIGIN`,
`COOKIE_SAMESITE`, or a frontend config file.

Deploy, and note the service URL, e.g. `https://ccms.onrender.com`.

> The server **will not boot** without a strong `JWT_SECRET` in production, and it
> automatically enforces HTTPS, sends HSTS, and marks the auth cookie `Secure` —
> all from `NODE_ENV=production` + `TRUST_PROXY=true`.

---

## 3 · Seed the database (once)

In the web service → **Shell** tab:

```bash
npm run init-db
```

It applies the schema and seed data. Because `NODE_ENV=production`, it also
**rotates every seeded account's password to a fresh random one and prints them
once** — copy them somewhere safe; these are your live logins. (Nothing published
in the repo can sign in to your database.)

To reset a password later:

```bash
npm run reset-password -- admin@orientpaper.com   # one account
npm run reset-password -- --all                   # everyone
```

Restart the service afterward (it caches users at boot).

---

## 4 · Open it

Browse to the service URL (e.g. `https://ccms.onrender.com`). The SPA loads, the
API is on the same origin, and you sign in with a login from step 3. Done.

---

## Quick reference — backend env vars

```
DATABASE_URL=postgres://user:pass@host:5432/dbname   # External URL, TLS auto-on
NODE_ENV=production
JWT_SECRET=<48+ random bytes>
TRUST_PROXY=true
SAP_USE_MOCK=true
NOTIFY_MODE=mock          # or live + SMTP_* for real email
```

See [`backend/.env.example`](backend/.env.example) for the full, annotated list.

---

## Notes

- **Free tier sleeps.** On Render's free plan the service spins down when idle and
  takes a few seconds to wake on the next request. Fine for demos.
- **Local dev is unchanged.** Locally you can still run the API (`npm start` in
  `backend/`) and the static server (`node serve.js` in `frontend/`) separately;
  point `frontend/env/config.js` at `http://localhost:3000`. The single-origin
  behaviour only matters in the hosted build.
- **Uploaded files** live on the service's local disk, which is ephemeral on most
  PaaS free tiers. For durable attachments, mount a disk and set `UPLOAD_DIR`.
