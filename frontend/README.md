# CCMS Frontend — Orient Paper & Mill

A **dependency-free single-page web app** for the CCMS backend. It provides
role-specific portals with **JWT authentication**, mirroring the backend's
RBAC so each user only sees the actions their role can perform.

No build step, no framework, no `npm install` — just plain HTML/CSS/JS served
as static files against the CORS-enabled Express API.

---

## 1. Prerequisites

The backend must be running first:

```bash
# from the backend/ folder
cd backend
npm install
npm start          # → http://localhost:3000  (MOCK SAP mode)
```

## 2. Configure the environment

The browser can't read a `.env` file, so config lives in a JS file that sets
`window.CCMS_ENV`. Copy the template and point it at your backend:

```bash
cd frontend
cp env/config.example.js env/config.js
# edit env/config.js → set API_BASE_URL if the backend isn't on :3000
```

See [`env/README.md`](env/README.md) for every key.

## 3. Run the frontend

Serve the folder over HTTP (don't open `index.html` via `file://` — browsers
block API calls from `file://` origins). A tiny built-in server is included:

```bash
# from the frontend/ folder
node serve.js               # → http://localhost:5173
# or:  PORT=8080 node serve.js
```

Any static server works too — e.g. `npx serve`, `python -m http.server`, or
the VS Code **Live Server** extension.

Open **http://localhost:5173** and sign in.

---

## Login / demo accounts

The login screen can show seeded accounts as click-to-fill shortcuts, but the
credentials are **not** hardcoded in the app source. They are supplied at
runtime via `DEMO_ACCOUNTS` in the git-ignored `env/config.js`, and only render
when `SHOW_DEMO_ACCOUNTS` is the literal `true` (**fail-closed**). A production
build therefore ships **zero** cleartext passwords.

The seeded sandbox logins live in `env/config.js` (admin `Admin@456`, all other
staff `Orient@123`). For any real deployment, set `SHOW_DEMO_ACCOUNTS: false`
and empty `DEMO_ACCOUNTS` — see [`env/README.md`](env/README.md).

---

## Roles & portals

Each role signs in to a portal themed with its own accent colour. The sidebar,
dashboard queue, and the action buttons on a complaint are all filtered by the
role → status permission map (`js/roles.js`, a mirror of the backend's
`src/middleware/auth.js`). The **server re-authorises every request**, so the
UI mirror is purely for UX — it never grants access on its own.

| Role | Portal | Can do (beyond viewing) |
|---|---|---|
| Admin (R000) | Admin Console | Everything + master data, SAP sync, rollout, archive |
| TS Officer / Head (R001/R002) | Technical Services | Create complaints; TS Head approves `TS_Review` |
| QC Analyst / Manager (R003/R004) | Quality Control | Samples; approve `QC_Review` (sample gate) |
| Operations Analyst / Head (R005/R006) | Operations | Document CAPA; Ops Head approves |
| Product Manager / Marketing Head (R007/R008) | Marketing | Marketing review / approval |
| Managing Director (R009) | MD Office | MD approval (high value / policy breach) |
| Finance Officer (R010) | Finance | Raise SAP credit note; approve to Closed |
| Sales / KAM (R011) | Sales | Create complaints; schedule / record visits |

---

## What's included

- **JWT auth** — login → token stored in `localStorage` → `Authorization: Bearer`
  on every request; auto-logout + redirect on `401`; client-side expiry check.
- **Dashboard** — role-aware "my action queue", KPI tiles, pipeline-by-status.
- **Complaints** — filterable list, and a full detail view with the workflow
  strip, line items, samples, CAPA, visits, credit notes, gates, audit trail,
  and the stage actions the current role may take.
- **Create complaint** — real-time SAP invoice lookup + line-item builder.
- **Notifications, SLA breaches, audit log** — company-wide views, restricted
  to privileged roles (Admin, MD — see `GLOBAL_VIEW_ROLES` in `js/roles.js`).
- **Admin console** — master-data browser (9 entities), SAP batch sync,
  rollout status, and the data-retention archive.

---

## Project layout

```
frontend/
├── env/
│   ├── config.example.js   ← template (committed)
│   ├── config.js           ← active config (git-ignore in prod)
│   └── README.md
├── css/
│   └── styles.css
├── js/
│   ├── config.js           ← merges CCMS_ENV with defaults
│   ├── api.js              ← fetch wrapper (JWT + 401 handling)
│   ├── auth.js             ← login / logout / session
│   ├── roles.js            ← RBAC mirror (portals, nav, status gates)
│   ├── ui.js               ← DOM builder, badges, toasts, modals
│   ├── shell.js            ← top bar + role-filtered sidebar
│   ├── router.js           ← hash router with auth guard
│   ├── app.js              ← route registration + bootstrap
│   └── views/
│       ├── login.js
│       ├── dashboard.js
│       ├── complaints.js
│       ├── complaintDetail.js
│       ├── createComplaint.js
│       ├── lists.js         ← notifications · SLA · audit
│       └── admin.js         ← master data · SAP · rollout · archive
├── serve.js                ← zero-dependency static server
├── index.html
└── README.md
```

---

## Security hardening (frontend)

The following client-side protections are built in. **RBAC and data scoping are
enforced by the backend** — these client measures reduce attack surface and are
never the sole line of defence.

- **CSP + security headers** — `index.html` ships a `Content-Security-Policy`
  (`script-src 'self'`, so injected inline scripts / `onerror=` handlers can't
  run) and `serve.js` sends CSP, `X-Frame-Options: DENY`, `nosniff`, and
  `Referrer-Policy: no-referrer` on every response. Replicate these headers on
  your production web server / reverse proxy.
- **XSS-safe DOM builder** — `ui.js` has no `innerHTML` sink; all data goes in
  as `textContent`. Combined with the CSP this neutralises stored/DOM XSS.
- **Frozen, fail-closed config** — `window.CCMS_ENV` and `CCMS.config` are
  `Object.freeze`d so XSS can't rewrite `API_BASE_URL` to redirect the JWT to
  an attacker. `SHOW_DEMO_ACCOUNTS` is fail-closed (`=== true`).
- **No credentials in source** — demo logins come from the git-ignored
  `env/config.js`, never from `js/views/login.js`.
- **Least-privilege UI** — company-wide views (audit / SLA / notifications) and
  the API-host readout are limited to privileged roles; the workflow action
  call no longer sends a spoofable `actorId`/`actorRole` (the backend must
  derive identity from the JWT).
- **Request timeouts** — `api.js` aborts a stalled request after
  `API_TIMEOUT_MS` (15s) instead of hanging on "Loading…".

> **Still a backend responsibility** (the frontend cannot fix these): scoping
> `/api/complaints` & `/api/audit-log` to what the user may see (over-fetch),
> validating `unitPrice`/`invoiceQty` server-side (price tampering), invoice
> IDOR checks, rate-limiting login, and — ideally — moving the JWT to a
> `HttpOnly` cookie so it's out of `localStorage` reach entirely.

## Notes

- The app talks only to the endpoints already exposed by the backend
  (`src/routes/*` and the extra routes in `src/server.js`). No backend changes
  are required.
- To connect real SAP, that's a backend concern — set `SAP_USE_MOCK=false` in
  the backend `.env`. The frontend is unaffected.
