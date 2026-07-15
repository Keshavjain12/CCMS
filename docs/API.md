# API Reference

Base URL `http://localhost:3000`. All responses are JSON.

Authentication is an **httpOnly cookie** set at login and sent automatically by
the browser. Non-browser clients (Postman, curl, CI) may instead send
`Authorization: Bearer <token>`; the cookie takes precedence when both are
present.

Every endpoint below requires authentication except `POST /api/auth/login` and
`GET /`.

**Role codes:** `R000` Admin · `R001` TS Officer · `R002` TS Head · `R003` QC
Analyst · `R004` QC Manager · `R005` Ops Analyst · `R006` Ops Head · `R007`
Product Manager · `R008` Marketing Head · `R009` Managing Director · `R010`
Finance Officer · `R011` Sales/KAM

---

## Auth

### `POST /api/auth/login`
```json
{ "email": "admin@orientpaper.com", "password": "Admin@456" }
```
Sets `ccms_token` (HttpOnly, SameSite=Lax, 8h). Returns:
```json
{ "message": "Welcome, CCMS Admin!", "expiresIn": "8h",
  "user": { "userId": "U000", "roleId": "R000", "roleName": "Admin", "...": "" } }
```
The token is **not** in the body — by design. Rate limited to 20 attempts/15min.

### `GET /api/auth/me`
Current user, permissions and department.

### `POST /api/auth/logout`
Clears the cookie. No auth required — logging out must work with a stale token.

---

## Complaints

### `POST /api/complaints`
Stage 1. Looks up the invoice in SAP, resolves the customer, matches a sales
policy, creates the complaint and its line items, and computes settlement.

```json
{
  "invoiceNumber": "90009999",
  "title": "Caustic Soda contamination — IBC drums",
  "remarks": "Off-colour and odour in 3 drums",
  "lineItemsInput": [
    { "invoiceItemNo": "10", "sapMaterialNo": "MAT-2001",
      "defectiveQty": 3, "complaintTypeId": "CT06" }
  ],
  "attachmentsInput": []
}
```
A line item needs both `complaintTypeId` and `defectiveQty > 0` or it's ignored.
`reportedBy` is taken from the JWT, never the body. If SAP is unreachable the
complaint is still created with `sapValidationPending: true`.

**Roles:** `R011` Sales/KAM, `R001`/`R002` TS, `R000` Admin.

### `GET /api/complaints`
Complaints the caller may see — [read scoping](SECURITY.md#3-read-scoping)
applies. Query: `status`, `customerId`, `businessLine`, `limit`, `offset`.

```json
{ "data": [ ... ], "total": 3, "count": 3, "offset": 0, "hasMore": false }
```

### `GET /api/complaints/:complaintNo`
Full record: line items, attachments, samples, visits, CAPA, credit notes, and
the effective status sequence. 403 if not visible (so enumeration reveals
nothing).

### `POST /api/complaints/:complaintNo/action`
The universal workflow transition.

```json
{ "action": "approve", "remarks": "Verified against batch records" }
```

| action | Effect |
|---|---|
| `approve` | Advance to the next applicable status |
| `reject` | Return to the previous status |
| `clarify` | Park in `Clarification_Sought`, remembering the prior status |
| `resolve_clarification` | Return to the prior status |
| `auto_close` | Terminal `Auto_Closed` (Admin) |

**422** when a gate blocks (sample not received, no credit note).
**403** when your role may not act at this status.

### `POST /api/complaints/:complaintNo/line-items`
Add a line item. Recomputes settlement and re-evaluates the MD/visit gates.

### `POST /api/complaints/:complaintNo/attachments`
Attach a file reference (`fileReference`, `fileType`, `description`).
Metadata only — there is no upload endpoint yet.

### `GET /api/complaints/:complaintNo/audit-log`
This complaint's trail, newest first.
```json
{ "complaintNo": "...", "currentStatus": "Closed", "entries": [ ... ] }
```

### `GET /api/complaints/:complaintNo/status-sequence`
The stages this complaint will actually pass through, with conditional gates
resolved.

---

## Samples · Visits · CAPA · Credit note

### `POST /api/complaints/:complaintNo/samples` — `R003`, `R004`
```json
{ "sampleTypeId": "ST03", "dispatchMode": "Courier", "dispatchedDate": "2026-06-28" }
```

### `PUT /api/complaints/:complaintNo/samples/:sampleId` — `R003`, `R004`
```json
{ "sampleStatus": "Received", "receivedDate": "2026-07-01" }
```
`Awaited → Received → Under Testing → Tested → Disposed`. Reaching `Received`
opens the QC gate. A non-`Awaited` status requires `receivedDate`.

### `POST /api/complaints/:complaintNo/visits` — `R010`, `R011`
```json
{ "visitType": "Mandatory", "scheduledDate": "2026-07-15", "assignedTo": "U011" }
```

### `PUT /api/complaints/:complaintNo/visits/:visitId` — `R010`, `R011`
```json
{ "visitStatus": "Completed", "visitDate": "2026-07-15",
  "findings": "3 of 5 drums confirmed contaminated",
  "outcome": "Resolved On-Site", "customerAcknowledgement": "OTP-verified" }
```
`outcome` ∈ `Resolved On-Site` | `Escalation Confirmed` | `No Further Action`.

### `POST /api/complaints/:complaintNo/capa` — `R005`, `R006`
```json
{ "rootCauseDescription": "...", "correctiveAction": "...", "preventiveAction": "..." }
```

### `POST /api/complaints/:complaintNo/credit-note` — `R010`
Pushes a credit memo to SAP (touchpoint 5) and writes the returned number back
(touchpoint 6). Required before a complaint can close.
```json
{ "reason": "3 MT contamination confirmed by QC" }
```

---

## Master data

### `GET /api/master-data/:entity`
`customers` · `users` · `roles` · `departments` · `products` · `complaintTypes` ·
`sampleTypes` · `salesPolicies`

### `GET /api/master-data/invoice/:invoiceNo`
Real-time SAP invoice lookup (touchpoint 1). Mock invoices: `90001234`,
`90005678`, `90009999`.

### `GET /api/master-data/policy-check`
Dry-run the policy engine. Query: `businessLine`, `segment`, `settlementValue`,
`invoiceValue`, `invoiceDate`.

### `POST /api/master-data/sap-sync` — `R000`
Nightly batch (touchpoints 2–4), then reloads the master-data cache.

---

## Dashboard & oversight

### `GET /api/kpi` / `GET /api/kpi/summary`
Volume, pipeline, resolution times, settlement analytics, SLA compliance, SAP
health. **Scoped to the caller** — figures reflect only complaints they may see.
Admin/MD get the full picture.

### `GET /api/audit-log` — `R000`, `R009`
Company-wide trail. Paginated (`entries` key).

### `GET /api/audit-log/verify` — `R000`, `R009`
Recomputes every checksum.
```json
{ "totalEntries": 24, "valid": true, "tamperedCount": 0, "tampered": [] }
```

### SLA — `R000`, `R009`
| | |
|---|---|
| `GET /api/sla/breaches` | All current breaches |
| `GET /api/sla/breaches/:complaintNo` | Breaches for one complaint |
| `POST /api/sla/check` | Run the SLA engine now, without waiting for the tick |

### Notifications
| | |
|---|---|
| `GET /api/notifications` | Everything sent — `R000`, `R009` (the matrix contains message bodies) |
| `GET /api/notifications/:complaintNo` | Notifications for one complaint |

### Archive — `R000`
| | |
|---|---|
| `GET /api/archive` | Archived complaints |
| `GET /api/archive/policy` | Current retention windows |
| `GET /api/archive/log` | What the archival engine has done |
| `GET /api/archive/:complaintNo` | Archive status of one complaint |
| `POST /api/archive/run` | Run the archival engine now |

### `GET /api/rollout`
Current phase and what it enables.

### `GET /`
Public discovery: SAP mode, entities, touchpoints, workflow, endpoint index.

---

## Errors

| Code | Meaning |
|---|---|
| `400` | Bad input (missing invoice number, no line items) |
| `401` | Not authenticated, or session expired |
| `403` | Authenticated but not permitted — wrong role, or complaint not visible |
| `404` | Not found |
| `422` | Valid request, but a **workflow gate** blocks it |
| `429` | Rate limited |
| `500` | Server/database error |

```json
{ "error": "Cannot proceed from QC_Review: physical sample has not been received yet." }
```

The `403` vs `422` split is deliberate: `403` means *you* may not do this;
`422` means *the complaint* isn't ready.
