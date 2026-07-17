# CCMS — Project Analysis

**Customer Complaint Management System · Orient Paper & Mill**
Senior Staff engineering review — architecture, runtime verification, API reference, and ranked findings.

> Scope: a full read of every source file, a dependency audit, a live end-to-end run of both servers against PostgreSQL, and runtime exercise of the API surface. Every conclusion cites the file(s) it came from. No application code was modified.

---

## 1. Repository Overview

A complaint-management system for a paper & chemical manufacturer, built to a "CCMS Data Classification Report & Addendum" spec. It models the full Stage 1–8 complaint lifecycle (log → technical/QC review → CAPA → marketing/MD approval → customer visit → finance credit note → close), with SAP S/4HANA integration (mockable), an append-only audit trail, RBAC, SLA auto-escalation, KPIs, notifications, phased rollout, and data-retention archival.

| Aspect | Detail | Source |
|---|---|---|
| **Backend** | Node.js + Express 4 (`4.22.2` installed) | `backend/package.json`, `backend/src/server.js` |
| **Frontend** | Vanilla JS SPA — no framework, no build step | `frontend/index.html`, `frontend/js/*` |
| **Database** | PostgreSQL (18 tables), verified running on **PostgreSQL 18.4** | `backend/db/schema.sql`, `backend/src/db/pool.js` |
| **Auth** | JWT (`jsonwebtoken`) delivered as an **httpOnly cookie**; Bearer fallback for non-browser clients | `backend/src/middleware/auth.js`, `backend/src/routes/auth.js` |
| **External service** | SAP S/4HANA OData (6 touchpoints), mock branch on every call | `backend/src/services/sapService.js` |
| **Package manager** | npm (`package-lock.json` present); backend has deps, frontend has none | `backend/package-lock.json` |
| **Routing (BE)** | Express routers registered in order; wildcard `/:entity` kept last | `backend/src/routes/masterData.js:64` |
| **Routing (FE)** | Hash router with `:param` patterns + auth guard | `frontend/js/router.js` |
| **State (FE)** | `window.CCMS` namespace; session profile in `localStorage` (token is **not** stored — it's httpOnly) | `frontend/js/auth.js` |
| **Config** | `dotenv` backend `.env`; frontend `window.CCMS_ENV` from `env/config.js` | `backend/.env.example`, `frontend/env/config.example.js` |
| **Lines of code** | ~14,600 across JS/SQL/HTML/CSS/MD/JSON | — |

### Detected stack summary

- **Frontend framework:** none (deliberate — vanilla JS, `frontend/README.md`). DOM built by a small `el()` helper (`frontend/js/ui.js`) that is XSS-safe by construction (no `innerHTML`).
- **Backend framework:** Express 4 with `helmet`, `cors`, `morgan`, `express-rate-limit`, `cookie-parser`.
- **Database driver:** `pg` (single shared pool, `backend/src/db/pool.js`).
- **Auth:** JWT (HS256) in httpOnly cookie; bcrypt (`bcryptjs`) password hashing.
- **Build tools:** none. `nodemon` is the only devDependency. Frontend served by a 78-line zero-dependency static server (`frontend/serve.js`).

---

## 2. Folder Structure & Responsibilities

```
CCMS/
├── backend/                         Express API + PostgreSQL
│   ├── db/
│   │   ├── schema.sql               18 tables, CHECK constraints, generated columns, triggers
│   │   ├── seed.sql                 Idempotent master data (ON CONFLICT DO NOTHING)
│   │   ├── init.js                  npm run init-db — create DB, apply schema+seed, guard live data
│   │   ├── credentials.js           Shared: which passwords are "published", how to reissue
│   │   └── reset-password.js        npm run reset-password — rotate without data loss
│   ├── src/
│   │   ├── server.js                Express entry: middleware, oversight routes, engine startup
│   │   ├── config/rollout.js        Phased-rollout gate (business line/region)
│   │   ├── db/pool.js               Pool + query/one/many/tx helpers + pg type parsers
│   │   ├── middleware/auth.js       JWT verify, requireRoles, canActOnStatus (role→status RBAC)
│   │   ├── data/                    Persistence only (no business rules)
│   │   │   ├── masterData.js        9 master entities cached in memory (SYNC lookups)
│   │   │   ├── transactionalStore.js 7 transactional entities (async, camelCase aliasing)
│   │   │   └── auditLog.js          Append-only log + SHA-256 checksums + integrity verify
│   │   ├── services/                All decisions
│   │   │   ├── workflowService.js   13-status state machine + gate evaluation
│   │   │   ├── visibility.js        Single read-scoping rule (list + KPI share it)
│   │   │   ├── sapService.js        6 SAP touchpoints, mock/live branch
│   │   │   ├── slaEngine.js         Background SLA breach + auto-close engine
│   │   │   ├── notificationService.js Communication matrix (mock/live email)
│   │   │   ├── kpiService.js        Live KPI computation (scoped per user)
│   │   │   └── archivalService.js   Retention/archival engine
│   │   ├── routes/                  HTTP only — parse, authorise, delegate, respond
│   │   │   ├── auth.js  complaints.js  masterData.js
│   │   └── utils/
│   │       ├── asyncRoute.js        Wraps async handlers so rejections → 500, not process crash
│   │       └── pagination.js        Bounded list responses (hard cap 2000)
│   └── .env / .env.example
├── frontend/                        Static SPA
│   ├── index.html                   Script load order + CSP meta
│   ├── serve.js                     Zero-dep static server + security headers
│   ├── css/styles.css               One design system (tokens, light/dark, per-role accent)
│   ├── env/config.example.js        Runtime config template (→ config.js, git-ignored)
│   └── js/
│       ├── config.js color.js api.js auth.js roles.js ui.js shell.js router.js theme.js app.js
│       └── views/  login dashboard complaints complaintDetail createComplaint lists admin
├── docs/                            ARCHITECTURE · API · DATABASE · SECURITY (+ screenshots)
├── CCMS-OrientPaperMill.postman_collection.json
└── README.md
```

The layering rule is stated in `docs/ARCHITECTURE.md` and holds throughout the code: **routes** do HTTP only, **services** make every decision, **data** owns persistence, **db/pool** owns the connection. A gate is never decided in a route handler.

---

## 3. Architecture

### 3.1 System diagram (ASCII)

```
 ┌───────────────────┐         HTTPS/JSON          ┌────────────────────────────────────┐
 │  Browser SPA       │  ── credentials:include ──► │  Express API  (:3000)               │
 │  (:5173)           │  ◄── httpOnly cookie ──────  │                                     │
 │  vanilla JS        │                              │  helmet · rate-limit · cors ·       │
 │  window.CCMS.*     │                              │  cookie-parser · morgan             │
 │                    │                              │        │                            │
 │  router→views→api  │                              │  ┌─────▼──────┐  authenticate (JWT) │
 └───────────────────┘                               │  │  routes/    │  requireRoles      │
                                                      │  └─────┬──────┘                     │
                                                      │  ┌─────▼──────┐                     │
                                    ┌────────────────►│  │ services/   │  workflow · gates  │
                                    │   OData (mock/   │  │             │  visibility · SLA  │
             ┌──────────────┐       │   live)          │  └─────┬──────┘  kpi · sap · notify │
             │  SAP S/4HANA │◄──────┘                  │  ┌─────▼──────┐                     │
             │  (mockable)  │                          │  │  data/      │  master (cached)   │
             └──────────────┘                          │  └─────┬──────┘  transactional/audit│
                                                      └────────┼────────────────────────────┘
                                                               │ SQL (pg pool)
                                                        ┌──────▼───────┐
                                                        │  PostgreSQL   │  18 tables
                                                        │  (persistent) │  generated cols,
                                                        └───────────────┘  CHECK, triggers
```

Three independent processes; the frontend has no build step.

### 3.2 Request lifecycle — `POST /api/complaints/:no/action`

```
1. helmet / rate-limit / CORS / HTTPS-guard        server.js
2. cookie-parser → req.cookies                     server.js
3. authenticate  (JWT from httpOnly cookie)        middleware/auth.js   ← WHO is this?
4. canActOnStatus (role allowed at this status?)   middleware/auth.js   ← may this ROLE act?
5. complaintStore.getByNo (+ latest sample join)   data/transactionalStore.js
6. workflow.evaluateTransition  (gates decided)    services/workflowService.js ← is the COMPLAINT ready?
7. complaintStore.update                           data/transactionalStore.js
8. audit.log  (append-only, checksummed)           data/auditLog.js
9. notify.sendNotification (fire-and-forget)       services/notificationService.js
```

Steps 4 and 6 are deliberately separate (`docs/ARCHITECTURE.md`): step 4 = *"is this person allowed?"*, step 6 = *"is the complaint ready?"*. A QC Manager may approve at `QC_Review` (4 passes) yet be blocked because the sample hasn't arrived (6 fails). **Verified at runtime** — see §6.

### 3.3 Authentication & authorization flow

- **Login** (`routes/auth.js`): bcrypt-compare against the in-memory user cache → `signToken()` → set `ccms_token` httpOnly cookie. The token is deliberately **not** returned in the body.
- **Every protected request**: `authenticate` reads the cookie first, then `Authorization: Bearer`; verifies JWT; re-hydrates role flags from the live master cache onto `req.user`.
- **Three independent authorization layers** (`docs/SECURITY.md`), all re-checked server-side:
  1. **Role → route** — `requireRoles([...])` gates whole endpoints (samples=QC, CAPA=Ops, credit-note=Finance, admin surfaces=R000, global views=R000/R009).
  2. **Role → status** — `canActOnStatus` via `STATUS_ALLOWED_ROLES` (`middleware/auth.js:64`).
  3. **Read scoping** — `services/visibility.js` decides which complaints a user may *see at all*; used by both the list route and `/api/kpi`.
- **Frontend `roles.js` mirrors these rules but is cosmetic only** — it hides buttons; the server re-authorizes everything.

### 3.4 Workflow engine (`services/workflowService.js`)

13-status forward/back sequence plus 3 side-states (`Rejected`, `Clarification_Sought`, `Auto_Closed`). Conditional stages are filtered per-complaint by `getEffectiveSequence()`:

- **Sample gate** — `QC_Review` cannot advance until the latest sample is `Received`+ (only when the complaint type requires a sample).
- **MD gate** — `MD_Approval` included when `settlementValue > MD_APPROVAL_THRESHOLD` (₹100k) OR policy breach forces override.
- **Visit gate** — `Visit_Pending` included when key account OR `settlementValue > VISIT_THRESHOLD` (₹50k) OR visit requested.
- **Finance gate** — cannot reach `Closed` without a credit-note number.

Thresholds come from `.env` (not hardcoded), and the frontend reads gate state from `GET /:no/status-sequence` rather than recomputing — so the UI can't drift from the engine.

### 3.5 Data flow — Stage 1 create

```
POST /api/complaints
  → sap.getInvoice(invoiceNumber)          (real-time; on failure → fallback, sapValidationPending=true)
  → sap.getCustomerMaster(SoldToParty)      (customer snapshot)
  → rollout.checkRolloutGate(line, region)  (403 if phase disallows)
  → masterData.findApplicablePolicy(...)    (business line + segment)
  → per line item: unitPrice/qty taken STRICTLY from SAP invoice (price-tamper guard)
  → checkPolicyCompliance(...)              (window + max settlement %)
  → complaintStore.create(...)              (header; reportedBy from JWT, never body)
  → lineItemStore.create(...) per item      (defective_value is a GENERATED column)
  → audit.log("Complaint Created")          (+ "Policy Flag" if breach)
  → 201 { complaint (enriched), policyAlert, warnings }
```

### 3.6 Persistence design

- **Master data cached in memory at boot** (`masterData.load()`), giving synchronous lookups for the policy engine / RBAC / SAP service. Transactional data is fully async. Trade-off: a direct master-table UPDATE isn't visible until `reload()`.
- **Snapshots on `complaints`** — `customer_name`, `customer_segment`, `invoice_value`, `is_key_account` are copied, not just referenced, so an old complaint's policy decision still makes sense if SAP later re-segments the customer.
- **Invariants enforced by the DB, not the app** — generated `defective_value`, `complaint_no` sequence, `defective_qty <= invoice_qty`, `closed_at` only when terminal, all 16 statuses CHECK-constrained, and `audit_log` UPDATE/DELETE/TRUNCATE blocked by triggers.

### 3.7 Background engines

| Engine | Cadence (`.env`) | Behaviour | Source |
|---|---|---|---|
| **SLA** | `SLA_TICK_MINUTES` (60) | Flag stages past their SLA window, escalate to supervisor, auto-close stale clarifications; breach state persisted on the complaint to survive restarts | `services/slaEngine.js` |
| **Archival** | `ARCHIVE_TICK_HOURS` (24) | Purge attachment files after retention (keep metadata), archive complaints after window; gated on rollout feature flag | `services/archivalService.js` |

Both log every action to the audit trail as a system actor and start after `app.listen()`.

---

## 4. Dependency Analysis

**Environment:** Node v24.14.1, npm 11.11.0. `backend/node_modules` present; `npm install` reports "up to date".

**Module integrity:** all 18 local backend modules load cleanly — **no circular dependencies, no broken imports** (verified by requiring each in isolation).

### Installed dependency versions

| Package | Declared | Installed | Notes |
|---|---|---|---|
| express | ^4.19.2 | 4.22.2 | — |
| pg | ^8.22.0 | 8.22.0 | — |
| jsonwebtoken | ^9.0.2 | 9.0.3 | — |
| bcryptjs | ^2.4.3 | 2.4.3 | pure-JS bcrypt |
| helmet | ^7.1.0 | 7.x | loads OK |
| express-rate-limit | ^7.3.1 | 7.x | loads OK |
| cors | ^2.8.5 | 2.8.6 | — |
| dotenv | ^16.4.5 | 16.6.1 | — |
| morgan | ^1.10.0 | 1.11.0 | — |
| cookie-parser | ^1.4.7 | 1.4.7 | — |
| node-fetch | ^2.7.0 | 2.7.0 | v2 on purpose (CJS; v3 is ESM-only) |
| nodemailer | ^9.0.3 | 9.0.3 | only used in `NOTIFY_MODE=live` |
| **uuid** | ^9.0.1 | 9.0.1 | **unused** — see below |

### Findings

- **`uuid` is an unused dependency.** No `require("uuid")` exists anywhere in `src/`; UUIDs are generated by Postgres `gen_random_uuid()` (`schema.sql`). It is also the *only* package flagged by `npm audit` (1 moderate: GHSA-w5hq-g745-h8pq). **Removing it clears the audit finding at zero code cost.**
- **`npm audit`:** 1 moderate, entirely attributable to the unused `uuid`.
- **No deprecated packages** in active use. `node-fetch@2` is intentional (CJS compatibility).
- Minor dead imports: `const express = require("express")` in `routes/complaints.js:16` and `routes/masterData.js:4` is unused (both use `safeRouter()`).

---

## 5. Runtime Verification (both servers live)

Both processes started clean on the first attempt — **no debugging required**:

- **Backend** (`npm start`): `[DB] connected → ccms (PostgreSQL 18.4)`, master data loaded (5 customers, 12 users, 12 roles, 7 depts, 7 products, 4 invoices, 10 complaint types, 5 sample types, 5 sales policies), SLA + Archival engines started, listening on `:3000`, SAP MOCK.
- **Frontend** (`node serve.js`): listening on `:5173`, serving with full CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, correct MIME types, SPA fallback working.

### What was exercised against the live API

| Test | Result |
|---|---|
| Discovery `GET /` | 200, MOCK mode reported |
| Login (missing creds / wrong pw / no token) | 400 / 401 / 401 ✓ |
| Login admin → httpOnly cookie set; `GET /api/auth/me` | cookie set, `R000` isAdmin ✓ |
| `GET /api/master-data/users` hides `password` | field absent ✓ |
| Invoice lookup (good / bad) | 200 / 404 ✓ |
| **Full lifecycle** COMP-2026-00005 (chemical, ₹105k) | Logged→…→Closed, **21 audit entries** ✓ |
| Sample gate at `QC_Review` before receipt | **422** blocked ✓ |
| Finance close before credit note | **422** blocked ✓ |
| Credit-note push (mock) | `CN5000001` / SAP doc `49005000001` ✓ |
| Price-tamper: item not on invoice | **400** rejected ✓ |
| **Read scoping** admin vs QC Analyst | admin sees 2, QC sees **0** ✓ |
| **KPI scoping** (QC Analyst) | `summary.total = 0` (matches list, no company-wide leak) ✓ |
| Global views (audit / notifications) as QC | **403** ✓ |
| Admin surfaces (archive / sap-sync) as QC | **403** ✓ |
| RBAC role→status: Finance approve at `Logged` | **403** ✓ |
| Audit integrity `GET /api/audit-log/verify` | `valid=true`, 80 entries, 0 tampered ✓ |
| **DB-level audit immutability** (direct UPDATE/DELETE) | both blocked by trigger ✓ |
| KPI / rollout / archive-policy / SLA / notifications / sap-sync | all 200 with expected shapes ✓ |

> **Test data note:** these runs created COMP-2026-00005/00006/00007 and audit entries in the local `ccms` DB. They were left in place (deleting complaints is a destructive DB change, and the audit log is immutable by design). COMP-2026-00007 is the orphan from finding **H-1** below.

---

## 6. API Reference

Base URL `http://localhost:3000`. All responses JSON. Auth = httpOnly `ccms_token` cookie (or `Authorization: Bearer <jwt>`). Role codes: `R000` Admin · `R001` TS Officer · `R002` TS Head · `R003` QC Analyst · `R004` QC Manager · `R005` Ops Analyst · `R006` Ops Head · `R007` Product Mgr · `R008` Marketing Head · `R009` MD · `R010` Finance · `R011` Sales/KAM.

### Auth — `routes/auth.js`
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | public (20/15min) | `{email,password}` → sets cookie, returns `{message,expiresIn,user}` (no token in body) |
| GET | `/api/auth/me` | any | Current user + permissions + department |
| POST | `/api/auth/logout` | public | Clears the cookie |

### Complaints — `routes/complaints.js`
| Method | Path | Roles | Purpose / notes |
|---|---|---|---|
| POST | `/api/complaints` | R001/R002/R011/R000 | Stage 1 create; invoice lookup, policy check, line items; `reportedBy` from JWT |
| GET | `/api/complaints` | any | **Scoped** list; `?status &customerId &businessLine &limit &offset` |
| GET | `/api/complaints/:no` | any (visible) | Full enriched record; **403** if not visible (IDOR guard) |
| POST | `/api/complaints/:no/action` | per-status | `approve\|reject\|clarify\|resolve_clarification\|auto_close`; **403** wrong role, **422** gate blocks |
| POST | `/api/complaints/:no/line-items` | any (Draft/Logged) | Add item; price from SAP; recomputes settlement |
| POST | `/api/complaints/:no/attachments` | any | Attach a file *reference* (metadata only — no upload endpoint) |
| POST | `/api/complaints/:no/samples` | R003/R004 | Create sample record |
| PUT | `/api/complaints/:no/samples/:id` | R003/R004 | Update status (`Awaited→…→Disposed`); `receivedBy` from JWT |
| POST | `/api/complaints/:no/visits` | R010/R011 | Schedule visit |
| PUT | `/api/complaints/:no/visits/:id` | R010/R011 | Record outcome (validated against CHECK enums) |
| DELETE | `/api/complaints/:no/visits/:id` | R010/R011 | Remove a visit **only if it holds no recorded work** (else 409) |
| POST | `/api/complaints/:no/capa` | R005/R006 | Document CAPA (root/corrective/preventive required); `documentedBy` from JWT |
| POST | `/api/complaints/:no/credit-note` | R010 | Push credit memo to SAP (touchpoints 5+6); only at `Finance_Processing` |
| GET | `/api/complaints/:no/audit-log` | any (visible) | This complaint's trail |
| GET | `/api/complaints/:no/status-sequence` | any (visible) | Effective sequence + gate state |

### Master data — `routes/masterData.js`
| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/api/master-data/:entity` | any | `customers\|users\|roles\|departments\|products\|complaintTypes\|sampleTypes\|salesPolicies` (users omit password) |
| GET | `/api/master-data/invoice/:invoiceNo` | any | Real-time SAP invoice lookup (404 if unknown) |
| GET | `/api/master-data/policy-check` | any | Dry-run policy compliance |
| POST | `/api/master-data/sap-sync` | R000 | Trigger nightly batch sync |

### Oversight & admin — `server.js`
| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/` | public | Discovery |
| GET | `/api/kpi`, `/api/kpi/summary` | any (**scoped**) | Live dashboard KPIs |
| GET | `/api/audit-log` | R000/R009 | Company-wide trail (paginated) |
| GET | `/api/audit-log/verify` | R000/R009 | Recompute all checksums |
| GET | `/api/notifications` | R000/R009 | All queued/sent notifications |
| GET | `/api/notifications/:complaintNo` | any | Per-complaint notifications |
| GET | `/api/sla/breaches` | R000/R009 | All SLA breaches |
| GET | `/api/sla/breaches/:complaintNo` | any | Per-complaint breaches |
| POST | `/api/sla/check` | R000 | Run SLA engine now |
| GET | `/api/archive`, `/policy`, `/log`, `/:complaintNo` | R000 | Archived complaints / policy / run-log / one |
| POST | `/api/archive/run` | R000 | Run archival now |
| GET | `/api/rollout` | R000 | Current phase + feature flags |

**Error codes:** 400 bad input · 401 unauthenticated · 403 not permitted / not visible · 404 not found · **422 workflow gate blocks** · 429 rate limited · 500 server/db. The 403-vs-422 split is deliberate: 403 = *you* may not; 422 = the *complaint* isn't ready.

---

## 7. Code Review — Findings Ranked by Severity

Every item cites the file(s) it came from. Nothing here was changed.

### HIGH

**H-1 · Stage-1 create is not transactional → orphaned complaints + broken SAP-fallback (500).**
`routes/complaints.js:233` inserts the complaint header, then loops line-item inserts at `:261` — with **no `db.tx()` wrapper**, even though `db/pool.js:85` provides `tx()` expressly "for creating a complaint plus its line items." If any line-item insert fails, the header is already committed. This is reachable through the **documented SAP-fallback path** (Section 11.2, "a customer complaint must never be lost"): a fallback create that supplies `defectiveQty` but no `invoiceQty` violates the `defective_not_more_than_invoiced` CHECK (`schema.sql:289`), returning **HTTP 500** and leaving an orphan header with zero line items and `settlementValue 0`.
*Verified at runtime:* the Postman request "Create Complaint — Bad Invoice (SAP fallback path)" produced `COMP-2026-00007` (status Logged, 0 line items). Fix direction: wrap header + items + attachments in `tx()`, and validate `defectiveQty <= invoiceQty` in the fallback branch with a 400 rather than letting the constraint 500.

### MEDIUM

**M-1 · Postman collection auth is broken against the cookie-auth backend.**
Every login request in `CCMS-OrientPaperMill.postman_collection.json` runs `if (d.token) pm.collectionVariables.set("token", d.token)`, but `routes/auth.js:40` deliberately returns **no `token` in the body** (it's an httpOnly cookie). So `{{token}}` stays empty and every subsequent `Authorization: Bearer {{token}}` request is unauthenticated (401). The lifecycle folder also still sends `actorId`/`actorRole` in bodies, which the backend now ignores. The collection predates the cookie migration and needs regenerating (or a test script that reads the `Set-Cookie` header).

**M-2 · `sap-sync` route does not reload the master cache (doc/code mismatch).**
`docs/API.md` says sap-sync "then reloads the master-data cache," and `masterData.js` exports `reload`. But `routes/masterData.js:26` calls only `sap.runMasterDataBatchSync()` + `audit.log` — it never calls `masterData.reload()`. Harmless in MOCK mode (data already seeded), but in live mode a sync would not refresh the in-memory cache until a process restart.

**M-3 · KPI repeat-complaint detection is O(n²) and doesn't match its own spec.**
`services/kpiService.js:210` nested-loops every complaint pair. The header comment (`:16`, `:206`) says repeats are "same customer + product + type within 90 days," but the code (`:214`) keys on `customerId` only. At scale this is both a performance cost and an over-broad flag. Bound it (index by customer) and include product/type as documented.

### LOW

**L-1 · Dashboard SAP-health chip always shows "unknown".**
`views/dashboard.js:114-115` reads `kpi.sapHealth.status` / `kpi.sapHealth.mode`, but `kpiService.js:287` emits `creditNoteIssuanceRate/closedWithCreditNote/totalClosed/pendingSAPValidation` — neither key exists. *Verified:* the chip renders "SAP: unknown" with a permanent warn dot. Cosmetic.

**L-2 · SLA-breaches table shows empty "Type"/"Age" columns.**
`views/lists.js:87-88` reads `b.breachType`/`b.ageDays`, but `slaEngine.js:183` breach objects carry `status/action/slaDays/daysElapsed/overdueBy/detectedAt`. The "Type" column falls back to the literal "SLA" and "Age" shows "—", though the data exists under other names. Cosmetic.

**L-3 · Unused `uuid` dependency (also the sole `npm audit` finding).** See §4. Remove it.

**L-4 · Dead `express` imports.** `routes/complaints.js:16`, `routes/masterData.js:4` import `express` but use `safeRouter()`. Trivial cleanup.

**L-5 · `Draft` appears in the effective sequence though complaints start at `Logged`.**
`workflowService.js:15` lists `Draft` first; `complaintStore.create` inserts at `Logged`. The workflow strip therefore renders a `Draft` step that is never the current status. Minor UI nuance, not a bug.

**L-6 · Visit gate silently under-evaluates for uncached customers.**
`workflowService.js:requiresVisit` depends on `complaint._customer` from the master cache; in the SAP-fallback path with an unknown customer, `_customer` is null, so key-account can't be detected (settlement threshold still applies). Edge case tied to H-1's fallback path.

### Observations (not defects)

- **XSS-safe by construction:** `ui.js:12` has no `innerHTML` sink — all values go in as `textContent`; combined with `script-src 'self'` CSP this closes DOM/stored XSS. Confirmed by reading every `el()` call site.
- **Attribution is server-derived everywhere** (`reportedBy`, `receivedBy`, `documentedBy`, `raisedBy`, audit `actorId`) — the frontend's spoofable body fields are ignored.
- **`asyncRoute.protect/safeRouter`** correctly preserves 4-arg error middleware arity (`utils/asyncRoute.js:24`) — a subtle correctness point many implementations get wrong.
- Duplicated-but-intentional logic: `roles.js` mirrors `middleware/auth.js` (documented as cosmetic); `STATUS_ALLOWED_ROLES` exists on both sides. Keep them in step.

---

## 7.1 Resolution Log — all findings fixed & verified

Every finding above was fixed and re-verified against a restarted server. No behaviour outside the fix was changed.

| ID | Fix | Files | Runtime verification |
|---|---|---|---|
| **H-1** | Stage-1 create now runs header + line items + attachments inside one `db.tx()`; added a pre-write over-claim guard returning **400** (not a constraint 500). Added an optional `client` param to `pool.using()` and to `complaintStore.create/getByNo`, `lineItemStore.create`, `attachmentStore.create`. Same guard added to the `line-items` route. | `db/pool.js`, `data/transactionalStore.js`, `routes/complaints.js` | Bad-invoice fallback → **400, complaint count unchanged (no orphan)**; valid fallback → **201 created**; happy path → 201; real-invoice over-claim → 400 |
| **M-1** | Regenerated the Postman collection for cookie auth: removed 61 `Bearer {{token}}` headers (cookie jar carries the session), fixed 8 login test scripts that read a non-existent body `token`, stripped `actorId`/`actorRole` from 17 bodies, removed the `token` variable, refreshed the description. | `CCMS-OrientPaperMill.postman_collection.json` | 0 remaining `{{token}}`/`d.token`/`actorId` refs; valid v2.1 JSON |
| **M-2** | `sap-sync` now calls `masterData.reload()` after the batch. | `routes/masterData.js` | `POST /sap-sync` → `success=true`, cache reloaded |
| **M-3** | Repeat-detection grouped by customer (no longer O(n²) across all pairs); comment corrected (headers-only dataset, no product/type). | `services/kpiService.js` | `quality.repeatComplaints` well-formed, grouped per customer |
| **L-1** | `sapHealth.mode` added to KPI; dashboard chip keys the dot/label off `mode`. | `services/kpiService.js`, `views/dashboard.js` | `sapHealth.mode="MOCK"` → chip shows "SAP: MOCK" |
| **L-2** | SLA table reads `action` (breach kind) and `daysElapsed` (age) — the fields the engine actually emits. | `views/lists.js` | Columns now populate |
| **L-3** | Removed unused `uuid` dependency. | `backend/package.json`, `package-lock.json` | `npm audit` → **0 vulnerabilities** |
| **L-4** | Removed dead `express` imports. | `routes/complaints.js`, `routes/masterData.js`, `routes/auth.js` | All modules load |
| **L-5** | Confirmed real, not cosmetic: reject at `Logged` stranded the complaint in `Draft` (no non-admin role may action it). `getEffectiveSequence` now excludes `Draft` unless the complaint is actually in it — removing the phantom "done" step and making `getPreviousStatus(Logged)=null` so reject-at-Logged is refused. A genuine `Draft` complaint is unaffected. | `services/workflowService.js` | Seq starts at `Logged`; reject at `Logged` → **422** "cannot reject further", status stays `Logged`; a `Draft` complaint still shows/advances |
| **L-6** | Confirmed real: the visit gate bailed to `false` whenever `_customer` was absent (skipping the settlement-threshold check) and read key-account from the live cache instead of the snapshot. `requiresVisit` now uses the complaint's own `settlementValue` and snapshotted `isKeyAccount`. | `services/workflowService.js` | Unit-tested (uncached+high settlement → true; snapshot key-account → true) and end-to-end (`visitRequired=true` for an uncached high-value complaint) |
| **H-2** (found while testing L-6) | SAP-fallback create with an unknown SoldToParty violated `complaints_customer_id_fkey` → **500** and lost the complaint (a third failure mode of the fallback path, alongside H-1). Now persists `customer_id = null` when the party isn't a real customer, keeping the `customer_name` snapshot. | `routes/complaints.js` | Unknown-customer fallback → **201** (was 500), `customerId=null`, name snapshot retained, `pendingSAP=true` |

> Runtime test data created during analysis/verification (COMP-2026-00005…00009, incl. the pre-fix orphan 00007) remains in the local `ccms` DB. It's a reseedable sandbox — `npm run init-db -- --force` gives a clean slate. Post-fix, no new orphans are creatable.

## 7.2 Hardening round — remaining gaps closed

A follow-up pass addressed the outstanding items from §9. All verified against a restarted server; a **32-test suite** (`npm test`, `node:test`, no new deps) now locks in the decision layer.

| # | Fix | Files | Verification |
|---|---|---|---|
| **1** | Route 500s no longer echo `err.message`. Local catches route to the global handler via `next(err)`; the handler masks in production unless the error carries a caller-safe `err.publicMessage` (used for the SAP credit-note failure). | `server.js`, `routes/complaints.js`, `routes/masterData.js` | prod → "Internal server error"; dev → real message; SAP failure → safe message, no internals |
| **2** | `POST /attachments` and `/line-items` now enforce read-scoping (`denyIfHidden`), take `uploadedBy` from the JWT, and write an audit entry. | `routes/complaints.js` | QC (can't see complaint) → **403**; admin → 201 + "Attachment Added" in the trail |
| **3** | Test suite for the decision layer: workflow gates/transitions (incl. L-5/L-6), policy compliance, rollout gate, RBAC, token revocation, pagination, file-store traversal guard. | `backend/test/*.test.js`, `package.json` | **32 pass / 0 fail** |
| **4** | Logout revokes the token: each JWT carries a `jti`, and logout adds it to an in-process denylist `authenticate` checks. (Limitation documented: memory-only, forgotten on restart.) | `middleware/auth.js`, `routes/auth.js`, `docs/SECURITY.md` | `/me` after logout on the same cookie → **401** |
| **5+8** | `db/harden.sql` creates a least-privilege `ccms_app` role that can append but not UPDATE/DELETE `audit_log` and doesn't own the tables (so it can't disable the triggers) — the app-tier tamper-evidence control. Checklist + docs updated. | `backend/db/harden.sql`, `docs/SECURITY.md`, `.env.example` | SQL includes a `has_table_privilege` verification block |
| **6** | Short per-user TTL cache on `computeKPIs` (`KPI_CACHE_MS`, default 10s; 0 disables). | `services/kpiService.js`, `.env.example` | two quick `/api/kpi` calls share one `generatedAt` (cache hit) |
| **7** | Complaints-list enrich batched: `enrichMany` fetches all six child types for the page in 6 `ANY($1)` queries instead of 6×N. | `data/transactionalStore.js`, `routes/complaints.js` | list rows still carry `lineItems[]` / `statusSequence[]`; fixed query count |
| **9** | Real attachment upload: `POST /:no/attachments/upload` streams raw bytes to disk (dependency-free, size/type-capped, path-safe), `GET …/attachments/:id/file` serves them (auth + visibility), archival deletes the file on purge. | `utils/fileStore.js`, `routes/complaints.js`, `services/archivalService.js`, `.gitignore`, `.env.example` | upload → 201 + bytes served back (200, correct MIME); QC → 403; bad type → 400; traversal names rejected |

---

## 8. Business Flow (end-to-end)

**Who uses it:** internal staff across TS, QC, Operations, Marketing, MD Office, Finance, and Sales, plus an Admin. Each role signs into its own accent-themed portal; the sidebar, dashboard queue, and complaint actions are filtered to what the role can do (server re-checks all of it).

**The journey of one complaint (matches the 21-entry audit trail verified in §5):**

1. **Sign in** (`views/login.js`) → JWT cookie → **Dashboard** (`views/dashboard.js`) shows "My action queue" (complaints this role can act on now), KPI tiles (open exposure vs lifetime settlement), and pipeline-by-status.
2. **Create** (Stage 1, `views/createComplaint.js`) — TS/Sales/Admin enters an invoice number → live SAP lookup pre-fills line items → add defective quantity + complaint type per item → submit. Backend computes settlement, matches sales policy, flags breaches, sets the sample/MD/visit gates, and logs "Complaint Created". SAP down? The complaint is still filed, flagged *Pending SAP Validation*.
3. **TS Review** (R002) approves → **QC Review** (R003/R004). If the complaint type needs a sample, QC creates a sample record and updates it to *Received*; **the sample gate blocks approval until then** (422 verified).
4. **CAPA** (R005/R006) documents root cause / corrective / preventive action → **Ops Head** approves.
5. **Marketing Review → Marketing Head** approve the commercial settlement.
6. **MD Approval** (R009) — only if settlement > ₹1L or a policy breach forces it. The UI shows a consequence confirmation before committing money (`complaintDetail.js:583`).
7. **Customer Visit** (R010/R011) — only if key account or settlement > ₹50k. Schedule → record outcome.
8. **Finance** (R010) raises the SAP credit note (touchpoints 5+6). **Closing is blocked until the credit note exists** (422 verified). Approve once more → **Closed**, with a closure notification to reporter + stakeholders.
9. **Oversight, throughout:** the SLA engine flags overdue stages and auto-closes stale clarifications; the audit log records every human and system action immutably; Admin/MD can read the company-wide audit log, notifications, SLA board, and (Admin) master data, SAP sync, rollout, and archive.

Side paths at any active stage: **Reject** (back one stage), **Seek/Resolve clarification** (park and return), and **Auto-close** (admin / SLA engine).

---

## 9. Recommendations

### Correctness / reliability
1. **Wrap Stage-1 create in a transaction** and validate fallback quantities (fixes **H-1**; removes orphaned complaints).
2. **Regenerate the Postman collection** for cookie auth (fixes **M-1**), or document the `Set-Cookie`-extraction script.
3. **Call `masterData.reload()` after `sap-sync`** (fixes **M-2**) so live syncs take effect without a restart.
4. **Align the two frontend KPI/SLA field mismatches** (**L-1**, **L-2**).

### Performance
- Bound the KPI repeat-detection loop (**M-3**) — index complaints by `customerId` instead of the O(n²) pair scan; add product/type to match the spec.
- The complaints list enriches each row with 6 child queries after pagination (`routes/complaints.js:322`) — fine at current scale, but consider a single aggregated query or a lighter list projection as volume grows.
- KPIs recompute from scratch on every call (`kpiService.js`, "no caching") — add a short TTL cache if the dashboard is polled.

### Security (already strong — hardening only)
- **Remove the unused `uuid` dependency** to clear the single `npm audit` finding (**L-3**).
- Consider **JWT revocation** (denylist or short-lived + refresh) — currently a logout only clears the cookie; the token stays valid until expiry (documented limitation, `docs/SECURITY.md`).
- Production checklist in `docs/SECURITY.md` is thorough (strong `JWT_SECRET`, `NODE_ENV=production`, HTTPS/`TRUST_PROXY`, `CORS_ORIGIN`, demo accounts off, rotate seeded passwords, non-superuser DB role). Follow it before any public deployment.
- For true audit tamper-evidence beyond the app, use a restricted DB role or ship entries off-box (a superuser can `DISABLE TRIGGER`).

### Technical debt
- Dead code: unused `express` imports (**L-4**), `Draft` in the workflow sequence (**L-5**).
- The master-data cache means direct master-table writes need a `reload()`; acceptable while SAP owns that data, but worth a note for operators.
- No automated test suite ships with the repo — the Postman collection is the closest thing, and it's currently broken (**M-1**). A small integration test harness around the lifecycle would lock in the gate behaviour verified in §5.

---

## 10. Overall Assessment

This is a **well-architected, thoroughly documented, security-conscious** application. The layering discipline (routes→services→data) is real and consistently applied; the database owns the invariants that matter; authentication uses an httpOnly cookie with three independent, server-enforced authorization layers; and the audit log is genuinely immutable at the database level. Every one of those claims was **verified at runtime**, not just read.

The single issue that rose above cosmetic was **H-1** (non-transactional create breaking the documented SAP-fallback path and leaving orphaned records). The rest were medium/low: a stale Postman collection, a missing cache-reload, an O(n²) KPI loop, two harmless frontend field mismatches, and an unused dependency.

**Update:** all findings (H-1, M-1/2/3, L-1/2/3/4) have since been fixed and re-verified against a restarted server — see **§7.1 Resolution Log**. `npm audit` now reports 0 vulnerabilities, and the SAP-fallback path both creates valid complaints and rejects over-claims with a clean 400, with no orphans possible.
