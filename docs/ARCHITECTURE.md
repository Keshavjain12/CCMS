# Architecture

How CCMS is put together, and why. For setup see the [README](../README.md);
for endpoints see [API.md](API.md); for tables see [DATABASE.md](DATABASE.md);
for auth and access control see [SECURITY.md](SECURITY.md).

---

## The shape of it

```
┌──────────────┐        ┌─────────────────────────────────┐        ┌────────────┐
│  Browser     │        │  Express API  (:3000)           │        │ SAP        │
│  SPA (:5173) │◄──────►│                                 │◄──────►│ S/4HANA    │
│              │  JSON  │  routes → services → data       │ OData  │ (mockable) │
│  vanilla JS  │ cookie │                                 │        │            │
└──────────────┘        └───────────────┬─────────────────┘        └────────────┘
                                        │ SQL
                                 ┌──────▼───────┐
                                 │ PostgreSQL   │
                                 │  18 tables   │
                                 └──────────────┘
```

Three processes, no build step on the frontend.

| Layer | Responsibility |
|---|---|
| `routes/` | HTTP only — parse, authorise, delegate, respond. No business rules. |
| `services/` | All decisions: workflow, gates, policy, SAP, SLA, visibility, KPIs. |
| `data/` | Persistence. Nothing above it writes SQL. |
| `db/pool.js` | One connection pool, one query helper, type parsers. |

The rule that keeps this honest: **a gate is never decided in a route handler.**
If you're reading `routes/complaints.js` and see a business rule, it's in the
wrong place.

---

## Request lifecycle

A typical `POST /api/complaints/:no/action`:

```
1. helmet / rate limit / CORS      server.js
2. cookie-parser → req.cookies     server.js
3. authenticate                    middleware/auth.js   ← JWT from httpOnly cookie
4. canActOnStatus                  middleware/auth.js   ← may this ROLE act at this STATUS?
5. complaintStore.getByNo          data/transactionalStore.js
6. evaluateTransition              services/workflowService.js  ← gates decided here
7. complaintStore.update           data/transactionalStore.js
8. audit.log                       data/auditLog.js     ← append-only
9. notify                          services/notificationService.js
```

Steps 4 and 6 are separate on purpose. Step 4 asks *"is this person allowed?"*;
step 6 asks *"is the complaint ready?"*. A QC Manager is allowed to approve at
`QC_Review` (4 passes) but is still blocked if the sample hasn't arrived
(6 fails). Collapsing them would make one of those impossible to express.

---

## Key decisions

### Master data is cached; transactional data is not

`data/masterData.js` loads all nine master entities into memory at boot and
exposes **synchronous** lookups. `data/transactionalStore.js` is fully async.

Master data is a few hundred rows, changes only via the nightly SAP sync, and
is read on virtually every request. Caching it means `findApplicablePolicy()`,
`findCustomer()` and the RBAC checks stay synchronous — so the policy engine,
SAP service and auth middleware needed no changes when the app moved to
Postgres. Call `masterData.reload()` after a SAP sync.

The trade-off: a direct `UPDATE` on a master table isn't visible until reload.
That's acceptable because master data is owned by SAP, not by CCMS.

### The database owns invariants that must not drift

Anything the application could get wrong is enforced in `schema.sql`:

- `defective_value` is a **generated column** (`unit_price * defective_qty`) —
  it cannot disagree with its inputs.
- Complaint numbers come from a **sequence**. The old in-memory counter reset
  to `00001` on restart, so duplicates were reachable.
- `audit_log` rejects `UPDATE`, `DELETE` and `TRUNCATE` via triggers. A JS
  `Object.freeze()` only protected the running process.
- `CHECK` constraints cover all 16 statuses, `defective_qty <= invoice_qty`,
  and `closed_at` only on terminal statuses.

### Snapshot vs. reference

`complaints` stores `customer_name`, `customer_segment`, `invoice_value` and
`is_key_account` as **copies**, not just foreign keys. A complaint must reflect
the invoice and customer *as they stood when it was filed* — if SAP later
re-segments a customer, a two-year-old complaint's policy decision must still
make sense.

### One visibility rule, shared

`services/visibility.js` answers "may this user see this complaint?" and is used
by **both** the complaints list and the KPI dashboard. It previously lived
inside the routes file, which meant the list enforced scoping and `/api/kpi`
silently didn't — leaking company-wide totals to junior roles. Any new endpoint
returning complaint data must scope through it.

---

## Background engines

Both start after `app.listen()` and log every action to the audit trail as a
system actor.

| Engine | Cadence | Does |
|---|---|---|
| **SLA** (`slaEngine.js`) | `SLA_TICK_MINUTES` (60) | Flags stages past `STAGE_SLA_DAYS`, samples past `SAMPLE_SLA_DAYS`, auto-closes clarifications past `CLARIFY_SLA_DAYS` |
| **Archival** (`archivalService.js`) | `ARCHIVE_TICK_HOURS` (24) | Purges attachment files after `ATTACHMENT_RETENTION_DAYS`, archives complaints after `COMPLAINT_ARCHIVE_DAYS` |

Archival purges the **file** and keeps the metadata row, so the audit trail
never develops holes.

---

## SAP integration

`services/sapService.js` is the only module that talks to SAP. Every touchpoint
has a mock branch, selected by `SAP_USE_MOCK`.

| # | Touchpoint | Direction | Mode |
|---|---|---|---|
| 1 | Invoice lookup | SAP → CCMS | real-time |
| 2 | Customer master | SAP → CCMS | nightly |
| 3 | Product master | SAP → CCMS | nightly |
| 4 | Sales policy | SAP → CCMS | nightly |
| 5 | Credit note push | CCMS → SAP | real-time |
| 6 | Credit note write-back | SAP → CCMS | response to 5 |

The mock returns the **exact OData shape** SAP does (`A_BillingDocument`,
`to_Item`, `BillingDocumentItem`…), so switching `SAP_USE_MOCK=false` needs no
code change anywhere else.

If SAP is unreachable at complaint creation, the complaint is still created and
flagged `sapValidationPending` rather than failing — a customer complaint must
never be lost because a gateway was down.

---

## Frontend

Vanilla JS, no framework, no build. `serve.js` is a zero-dependency static
server.

| File | Does |
|---|---|
| `js/router.js` | Hash router with `:param` patterns |
| `js/api.js` | fetch wrapper; sends the auth cookie, redirects on 401 |
| `js/auth.js` | Session cache — **holds no token** (it's httpOnly) |
| `js/shell.js` | App chrome; sets `--accent` per role |
| `js/roles.js` | Mirrors backend RBAC for **cosmetic** filtering only |
| `js/views/` | One module per screen |

`roles.js` duplicating backend rules is deliberate but **decorative**: it hides
buttons the user can't use. It is not a security control — the API re-checks
everything. Never add a rule to `roles.js` without adding it to the backend.

Each portal gets its own accent colour from one CSS custom property; the logo
mark derives its gradient from it via `color-mix()`, so a new role needs no new
CSS.
