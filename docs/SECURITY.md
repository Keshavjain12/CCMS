# Security

Authentication, authorisation, and what is deliberately *not* protected.

---

## Authentication

Login issues a JWT as an **httpOnly cookie**. It is not in the response body
and not in `localStorage`.

```
POST /api/auth/login  { email, password }
  → Set-Cookie: ccms_token=<jwt>; HttpOnly; SameSite=Lax; Max-Age=28800
  → { message, expiresIn, user }        ← no token here, on purpose
```

| Property | Value | Why |
|---|---|---|
| `httpOnly` | always | Page JavaScript cannot read it, so an XSS flaw has nothing to steal |
| `SameSite` | `lax` | Not sent on cross-site requests — this is the CSRF defence |
| `secure` | production only | HTTPS-only. Off in dev so plain-http localhost works |
| `maxAge` | `JWT_EXPIRES` (8h) | Matches the token's own expiry |

`authenticate` reads the cookie first, then falls back to
`Authorization: Bearer` so Postman, curl and CI scripts still work.

### What this does and does not fix

**Fixed:** the token can't be read by scripts, isn't in `localStorage`, and
isn't in the login response body.

**Not fixed, and unfixable:** the token is still visible in *your own* browser's
Network tab, in the `Set-Cookie` header. This is not a vulnerability. The
browser must receive the credential to use it, and DevTools shows its owner
what their own browser received. Every site behaves this way. An attacker
isn't sitting at your DevTools; if they were, the token is the least of your
problems.

### `JWT_SECRET`

Anyone holding it can forge a token for any user or role — including Admin —
without a password. It must be long and random, and must never be committed:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The server warns on a weak secret in development and **refuses to boot** in
production (`middleware/auth.js`).

### Logout

`POST /api/auth/logout` clears the cookie server-side **and revokes the token**
by its `jti` (each token carries a unique one): an in-process denylist that
`authenticate` checks, so a token copied before logout stops working
immediately rather than staying valid until expiry.

**Remaining limitation:** the denylist is process memory, so a server restart
forgets revocations — a token revoked just before a restart would work again
until its own expiry (≤ `JWT_EXPIRES`, 8h). Surviving restarts needs
persistence (e.g. a per-user `token_valid_after` timestamp) or short-lived
tokens plus refresh. Acceptable at 8h for an internal tool.

---

## Authorisation — three independent layers

A request must pass all three.

### 1. Role → route

`requireRoles([...])` gates whole endpoints.

| Endpoint | Roles |
|---|---|
| Samples | `R003` QC Analyst, `R004` QC Manager |
| CAPA | `R005` Ops Analyst, `R006` Ops Head |
| Visits | `R010` Finance, `R011` Sales/KAM |
| Credit note | `R010` Finance |
| Archive, rollout, SAP sync | `R000` Admin |
| Global audit log, notifications, SLA board | `R000` Admin, `R009` MD |

Admin (`R000`) bypasses role gates by design — full oversight.

### 2. Role → status

`canActOnStatus` asks whether this role may act *at this stage*. A QC Manager
can approve at `QC_Review` and nowhere else. Defined in
`STATUS_ALLOWED_ROLES` (`middleware/auth.js`).

### 3. Read scoping

`services/visibility.js` decides which complaints a user may **see** at all. A
complaint is visible when the user:

- is Admin (`R000`) or MD (`R009`), or
- reported it, or
- it is in their role's action queue (or its prior status when parked in
  `Clarification_Sought`), or
- they have acted on it before (per the audit trail, whose `actorId` comes from
  the JWT and can't be spoofed).

This applies to the complaints list **and** `/api/kpi`. Both must use it: the
KPI endpoint once counted every complaint company-wide, so a Sales/KAM user saw
"4 total, ₹18,56,600" against a 3-row list and could derive the hidden
complaint's value by subtraction.

> **If you add an endpoint that returns complaint data, or anything derived
> from it, scope it through `visibility.js`.** That is the single easiest way
> to reintroduce this leak.

### The frontend is not a security layer

`js/roles.js` mirrors these rules to hide buttons. It is cosmetic. Every rule
is re-checked server-side. Never rely on it.

---

## Workflow gates

Distinct from authorisation — these ask whether the *complaint* is ready, not
whether the *person* is allowed. All in `services/workflowService.js`.

| Gate | Blocks | Condition |
|---|---|---|
| **Sample** | leaving `QC_Review` | complaint type needs a sample and none is `Received`+ |
| **MD approval** | skipping `MD_Approval` | settlement > `MD_APPROVAL_THRESHOLD`, or policy breach where the policy forces override |
| **Visit** | skipping `Visit_Pending` | key account, or settlement > `VISIT_THRESHOLD`, or visit requested |
| **Finance** | reaching `Closed` | no SAP credit note recorded |

---

## Audit log

Append-only, enforced by the database — not by convention.

- `BEFORE UPDATE`, `BEFORE DELETE` and `BEFORE TRUNCATE` triggers raise an
  exception. The truncate guard matters: row-level triggers don't fire on
  `TRUNCATE`, which would otherwise wipe the whole log in one statement.
- Every entry carries a SHA-256 checksum over its content. `GET
  /api/audit-log/verify` recomputes them all and reports drift.
- The checksum is written in the **same** `INSERT` as the row. An
  insert-then-update approach would have to defeat the triggers, which would
  mean anyone could.
- `audit_log` has **no foreign key** to `complaints`, deliberately — a trail
  must outlive the record it describes.
- Actors include `Policy Engine`, `SLA Engine` and `SAP Integration` alongside
  people.

**Limitation:** a database superuser or the table *owner* can `ALTER TABLE ...
DISABLE TRIGGER`. The log is immutable to the *application*, not to whoever owns
the database. The fix is to run the app under a least-privilege role that
neither owns the tables nor holds `UPDATE`/`DELETE` on `audit_log`:
[`db/harden.sql`](../backend/db/harden.sql) creates `ccms_app` for exactly this.
Point `PGUSER`/`PGPASSWORD` at it in production. (Stronger still: ship entries
off-box to an append-only sink.)

---

## Transport

In production (`NODE_ENV=production`) the API:

- sets `Secure` on the auth cookie,
- sends HSTS (`max-age=15552000; includeSubDomains`),
- **rejects plain HTTP** with 403,
- refuses to boot on a weak `JWT_SECRET`.

Set `TRUST_PROXY=true` behind Nginx/Heroku/Render so `req.secure` is accurate.

`CORS_ORIGIN` must list the frontend origins explicitly — the wildcard is
illegal with credentialed requests, and reflecting any origin would let any
site issue authenticated calls.

---

## Other controls

| Control | Where |
|---|---|
| Rate limiting | 500/15min global; 20/15min on `/api/auth` (brute force) |
| Password storage | bcrypt (`bcryptjs`) |
| Payload cap | `JSON_BODY_LIMIT` (1mb) |
| Response cap | `paginate()`, hard max 2000 rows |
| SQL injection | Parameterised queries throughout; the one interpolated identifier (`CREATE DATABASE` in `db/init.js`) is quote-escaped |
| Security headers | helmet |
| Attribution | `actorId` comes from the JWT, never the request body |

---

## Before production — checklist

- [ ] Strong random `JWT_SECRET`, not committed
- [ ] `NODE_ENV=production`
- [ ] HTTPS terminated; `TRUST_PROXY=true` if behind a proxy
- [ ] `CORS_ORIGIN` set to the real frontend origin
- [ ] `SHOW_DEMO_ACCOUNTS=false` and `DEMO_ACCOUNTS=[]` in `frontend/env/config.js`
- [ ] Seeded demo passwords (`Orient@123`, `Admin@456`) removed or rotated
- [ ] Run [`db/harden.sql`](../backend/db/harden.sql) and point `PGUSER`/`PGPASSWORD` at the least-privilege `ccms_app` role (not `postgres`) — this is also what makes the audit log tamper-evident
- [ ] `.env` never committed (already gitignored)
- [ ] 8h tokens with in-process revocation on logout — decide if that's enough, or add persistent revocation before anything public
