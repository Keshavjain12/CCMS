# CCMS — Complete Project Documentation
### Customer Complaint Management System · Orient Paper & Mill

> **Live demo:** https://ccms-6dut.onrender.com · **Repo:** github.com/Keshavjain12/CCMS
>
> This document explains the whole system end to end — what it does, how it's built,
> and why each piece exists. For task-focused guides see the
> [README](README.md) (setup), [DEPLOYMENT](DEPLOYMENT.md) (hosting), and the
> deep-dives in [`docs/`](docs/) (architecture, API, database, security).

---

## 1. What problem it solves

When a customer of Orient Paper & Mill receives a defective or short shipment, the
complaint has to travel through **many hands** — technical services, quality control,
operations, marketing, the managing director, sales, and finance — before the customer
gets a credit note. Done on paper/email, this is slow, easy to lose, impossible to
audit, and gives the customer no visibility.

**CCMS turns that whole journey into a governed, transparent, software-driven workflow:**

- Every complaint is logged against a **real SAP invoice** (prices and quantities come
  straight from SAP, so nothing can be over-claimed).
- It moves through a **fixed 13-stage lifecycle**, and at each stage only the **right
  role** can act.
- **Money-sensitive steps are gated** — a large settlement automatically requires the MD's
  sign-off and a mandatory customer visit.
- **Everyone is kept informed by email** — the customer at each milestone, and the staff
  member who owns the next step.
- **Every action is recorded** in an append-only, tamper-evident audit log.

---

## 2. The big picture (architecture)

```
                    ┌──────────────────────────────────────────────┐
   Browser  ───────▶│  Node / Express API  (backend/)              │
   (the SPA)        │                                              │
                    │  • JWT auth (httpOnly cookie) + RBAC          │
                    │  • Workflow engine (13-stage state machine)   │
                    │  • SAP integration service (mock or live)     │
                    │  • Notification service (email + DB trail)    │
                    │  • SLA / archival / KPI background engines    │
                    │  • Serves the static SPA (single origin)      │
                    └───────────────┬───────────────┬──────────────┘
                                    │               │
                        ┌───────────▼──────┐   ┌────▼─────────────┐
                        │  PostgreSQL       │   │  SAP S/4HANA     │
                        │  (18 tables,      │   │  (real-time +    │
                        │   append-only     │   │   batch, or a    │
                        │   audit log)      │   │   built-in mock) │
                        └───────────────────┘   └──────────────────┘
```

**Two source folders, one running service:**

| Folder | What it is |
|---|---|
| **`backend/`** | Express API + PostgreSQL access + all business logic |
| **`frontend/`** | A dependency-free vanilla-JS single-page app (no build step) |

In production the **backend also serves the frontend**, so the entire app runs from a
single origin — which is why the hosted deployment needs no CORS or cross-domain cookie
configuration.

### Technology stack

| Layer | Choice | Why |
|---|---|---|
| API | **Node.js + Express** | Simple, well-understood, huge ecosystem |
| Database | **PostgreSQL** | Real constraints (CHECK, FK), generated columns, triggers for the append-only audit log |
| Frontend | **Vanilla JS SPA** (`window.CCMS` namespace, an `el()` DOM helper) | Zero build step, nothing to compile, easy to host |
| Auth | **JWT in an httpOnly cookie** (`jsonwebtoken`, `bcryptjs`) | Token can't be read by page JS → XSS can't steal the session |
| Email | **Nodemailer over SMTP** | Works with Gmail SMTP, Brevo, or any relay |
| Hardening | **helmet, cors, express-rate-limit** | Standard Express security middleware |

---

## 3. The data model (18 tables)

The schema splits into **master data** (reference data, mostly synced from SAP) and
**transactional data** (the complaints themselves). Full column-level detail is in
[`docs/DATABASE.md`](docs/DATABASE.md); the summary:

**Master data (9 entities)** — Customers/Distributors, Users, Roles, Departments,
Products/SKUs, Invoices, Complaint Types, Sample Types, Sales Policies.

**Transactional data (7 entities)** — Complaint, Line Item, Attachment, Sample Record,
Visit Record, CAPA Record, Credit Note.

Plus the **audit log** and the **notifications** trail.

Design choices worth knowing:
- **Money is `numeric`**, never floating point. Defective value is a **generated column**
  (`unit_price × defective_qty`) so it can never drift from its inputs.
- **Every workflow status is CHECK-constrained** — the database itself refuses an invalid
  status, not just the app.
- **The audit log is append-only at the database level** — triggers *block* `UPDATE` and
  `DELETE`, so history cannot be rewritten even with direct SQL access.

---

## 4. The workflow engine — the heart of the system

A complaint is a **state machine**. The full sequence:

```
Draft → Logged → TS_Review → QC_Review
      → [Sample_Awaited]          ← only if the complaint type needs a physical sample
      → CAPA_Pending → Ops_Head_Approval → Marketing_Review → Marketing_Head_Approval
      → [MD_Approval]             ← only if settlement > ₹1,00,000 or a policy breach
      → [Visit_Pending]           ← only if settlement > ₹50,000 or a key account
      → Finance_Processing → Closed
```

**Side-states** reachable from any active stage:
- **Rejected** → sends the complaint *back to the previous stage* (never a dead end).
- **Clarification_Sought** → pauses; resumes at the same stage when the customer replies.
- **Auto_Closed** → closed automatically by the SLA engine after no response.

### The stages are dynamic, not fixed

This is the clever part. The sequence above is the *maximum* path. For any given complaint,
[`getEffectiveSequence()`](backend/src/services/workflowService.js) **removes the stages
that don't apply**:
- No physical sample needed? `Sample_Awaited` disappears.
- Settlement under ₹1L and within policy? `MD_Approval` disappears.
- Settlement under ₹50K and not a key account? `Visit_Pending` disappears.

So a small, in-policy paper complaint takes a short path; a large chemical contamination
claim takes the full escalation through the MD and a mandatory customer visit — all decided
automatically from the complaint's own data.

### The gates (business rules the workflow enforces)

| Gate | Rule |
|---|---|
| **Sample gate** | QC_Review can't be approved until the physical sample is *Received* (or beyond) |
| **MD-approval gate** | Inserted when `settlementValue > ₹1,00,000` **or** a Sales-Policy breach forces it |
| **Visit gate** | Inserted when the customer `isKeyAccount` **or** `settlementValue > ₹50,000` **or** a visit is requested |
| **Finance gate** | A complaint cannot reach `Closed` until a SAP **Credit Note number** exists on it |

### The universal transition rule (RBAC)

At every stage, **only the role that owns that stage can act**, enforced server-side in
[`canActOnStatus()`](backend/src/middleware/auth.js). The Admin role (R000) can act at any
stage (useful for demos/administration); everyone else is restricted to their own stage.

---

## 5. Roles & access control

Twelve roles map to the twelve real jobs in the complaint chain:

| ID | Role | Acts at |
|---|---|---|
| R000 | Admin | every stage |
| R001 | TS Officer | logs complaints; TS Review |
| R002 | TS Head | TS Review |
| R003 | QC Analyst | samples; QC Review |
| R004 | QC Manager | QC Review |
| R005 | Operations Analyst | CAPA |
| R006 | Operations Head | Ops Head Approval |
| R007 | Product Manager | Marketing Review |
| R008 | Marketing Head | Marketing Head Approval |
| R009 | Managing Director | MD Approval |
| R010 | Finance Officer | Credit note; closure |
| R011 | Sales / KAM | Customer visits |

Access control has **two layers**, both enforced by the API (never trusting the UI):
1. **Can this role act at this stage?** (the transition rule above).
2. **Can this user even *see* this complaint?** — read-scoping via
   [`visibleToUser()`](backend/src/services/visibility.js). A junior role never receives
   complaints outside its queue, even if it guesses the URL (IDOR protection).

---

## 6. SAP S/4HANA integration

CCMS is designed to sit on top of SAP. Six integration touchpoints (all working against a
**built-in mock** so the whole system runs with zero SAP access, and flip to **live** by
setting `SAP_USE_MOCK=false` + credentials — no code changes):

| # | Touchpoint | Direction | Timing |
|---|---|---|---|
| 1 | Invoice lookup (qty + price) | SAP → CCMS | Real-time (at complaint creation) |
| 2 | Customer / Distributor master | SAP → CCMS | Nightly batch |
| 3 | Product / SKU master | SAP → CCMS | Nightly batch |
| 4 | Sales-policy / pricing conditions | SAP → CCMS | Nightly batch |
| 5 | Credit-note creation request | CCMS → SAP | Real-time (at settlement) |
| 6 | Credit-note number write-back | SAP → CCMS | Real-time (response to #5) |

Because prices and quantities come from SAP at creation, a complaint can only claim against
items that are actually on the invoice, and can't over-claim quantity — the API rejects both.

---

## 7. Email notifications

As a complaint moves, CCMS keeps **two audiences** informed, and records every message.

**The customer** is emailed at each milestone (acknowledgement on creation → technical
review done → QC done → pending MD approval → approved/credit-note in progress → resolved &
closed), plus on exception paths (clarification requested, returned for revision,
auto-closed). Messages are **de-duplicated** so a reject-then-reapprove never double-sends.

**Internal staff** are emailed the "action required" for the stage they own — TS, QC,
Operations, Marketing, MD, Sales/KAM, Finance — via a role-based routing matrix. Supervisors
also receive automatic **SLA-breach escalations**.

Every email is:
- **Sent over SMTP** with nodemailer (Gmail SMTP, Brevo, or any relay — chosen via env vars).
- **Persisted to PostgreSQL** (the `notifications` table), so the trail survives restarts.
- **Viewable in-app** — a per-complaint **Emails** tab and a global **Notifications** page.

Two modes via `NOTIFY_MODE`: `mock` (records everything, sends nothing — ideal for dev) or
`live` (sends real email). Switching is one variable, no code change.

> **Deliverability note (real-world):** free PaaS hosts (like Render's free tier) block
> outbound SMTP ports, and sending "from a @gmail.com address" through a third-party relay
> trips Gmail's anti-spoofing. For genuine inbox delivery the reliable setup is **Gmail's own
> SMTP** (`smtp.gmail.com` with an App Password) from an environment that allows outbound
> SMTP. This is exactly the kind of production concern the notification layer is built to
> accommodate — it's transport-agnostic.

---

## 8. Security

Security is layered and enforced server-side:

- **Authentication** — password login (bcrypt-hashed, never stored in plaintext) issues a
  **JWT delivered as an httpOnly cookie**. Page JavaScript can't read it, so an XSS bug
  can't steal the session. Logout revokes the token (jti blocklist).
- **Authorisation** — role gates on every action + read-scoping on every fetch (Section 5).
- **The audit log** — append-only, enforced by database triggers, and **checksummed** so
  tampering is detectable. `Policy Engine` and `SAP Integration` appear as actors alongside
  people, so automated actions are audited too.
- **Transport & hardening** — in production the server sends **HSTS**, marks cookies
  **Secure**, **refuses plain HTTP**, and won't boot without a strong `JWT_SECRET`. `helmet`
  sets security headers; a **CORS allow-list** and **rate limiting** (global + stricter on
  login) guard the API.
- **SQL** — every query is parameterised (no string-built SQL → no injection).

Full detail: [`docs/SECURITY.md`](docs/SECURITY.md).

---

## 9. The background engines

Three services run on timers alongside the API:

- **SLA engine** — checks every complaint against its stage deadline; flags breaches, emails
  the supervisor to escalate, and **auto-closes** complaints stuck in `Clarification_Sought`
  past the SLA.
- **Archival engine** — moves long-closed complaints to an archive and purges old attachment
  files per the retention policy (metadata is kept).
- **KPI service** — powers the dashboard tiles (open vs lifetime settlement, closure rate,
  pipeline by status, SLA compliance), scoped per user and cached briefly.

---

## 10. Deployment

CCMS deploys as **one web service + a PostgreSQL database** — the backend serves the SPA, so
there's a single origin (no CORS/cookie cross-domain setup). The database layer supports a
single **`DATABASE_URL`** connection string with **automatic TLS**, so it works out of the
box on managed Postgres (Render, Neon, Railway, Supabase, RDS…).

The live demo runs on **Render** at **https://ccms-6dut.onrender.com**. Step-by-step hosting
instructions (env vars, seeding, the single-service model) are in
[`DEPLOYMENT.md`](DEPLOYMENT.md).

Production-hardening built in:
- Refuses to boot on a weak `JWT_SECRET`.
- `NODE_ENV=production` → Secure cookies, HSTS, HTTPS enforcement, masked error messages.
- `npm run init-db` detects a managed database and seeds it as-is; with `NODE_ENV=production`
  it **rotates every seeded account's password** to a fresh random one and prints it once, so
  nothing published in the repo can sign in to a live database.

---

## 11. How to run it

**Locally** (two terminals):

```bash
# backend
cd backend && npm install && cp .env.example .env   # set PGPASSWORD
npm run init-db        # creates the DB, loads schema + seed
npm start              # → http://localhost:3000

# frontend
cd frontend && cp env/config.example.js env/config.js
node serve.js          # → http://localhost:5173
```

**Hosted:** create a Postgres, set `DATABASE_URL` + `NODE_ENV=production` + a random
`JWT_SECRET`, deploy the `backend/` folder, run `npm run init-db` once. See
[`DEPLOYMENT.md`](DEPLOYMENT.md).

**Sign in:** use the one-click demo-account buttons on the login page, or
`admin@orientpaper.com` / `Admin@456` (public sandbox credentials).

---

## 12. Project structure

```
CCMS/
├── backend/                         ← Express API + PostgreSQL
│   ├── db/                             init.js, schema.sql, seed.sql, pgConfig.js (DATABASE_URL+SSL)
│   └── src/
│       ├── db/pool.js                  connection pool + query helpers
│       ├── data/                       masterData, transactionalStore, auditLog
│       ├── services/                   workflow, sap, notification, sla, archival, kpi, visibility
│       ├── routes/                     auth, complaints, masterData
│       ├── middleware/auth.js          JWT, RBAC, status gates
│       ├── utils/                      pagination, fileStore, asyncRoute
│       └── server.js                   entry point (API + serves the SPA)
├── frontend/                        ← dependency-free vanilla-JS SPA
│   ├── js/  css/  assets/  env/  index.html  serve.js
├── docs/                            ← deep-dives: ARCHITECTURE, API, DATABASE, SECURITY
├── README.md   DEPLOYMENT.md   DOCUMENTATION.md (this file)
└── CCMS-Presentation.pptx          ← the project deck
```

---

## 13. What makes this project stand out

- **A real workflow engine**, not a CRUD app — a dynamic 13-stage state machine with
  data-driven gates.
- **Governance by design** — money-sensitive steps force higher approval automatically; the
  audit trail is tamper-evident at the database level.
- **SAP-ready** — six integration touchpoints, mock-or-live with a single flag.
- **End-to-end communication** — customers and staff kept informed by real email, with a
  persisted, in-app audit of every message.
- **Actually deployed** — single-service, single-origin, TLS-to-managed-Postgres, live on
  the internet, with production security enabled.

---

*Built by Keshav Raj Jain · Customer Complaint Management System · Orient Paper & Mill*
