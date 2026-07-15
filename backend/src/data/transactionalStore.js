// =========================================================================
// TRANSACTIONAL DATA STORE  —  CCMS
// =========================================================================
// Source: Section 4 (Transactional Data), Section 6.3 (Sample Records),
//         Section 7.1 (Visit Records), Section 4 (CAPA, Credit Note).
//
// Backed by PostgreSQL. Every method is async — await them.
//
// The public interface is unchanged from the in-memory version, so callers
// only needed to add `await`. Columns are snake_case in the database and
// aliased back to camelCase here, so returned objects keep their old shape.
//
// Runtime-only fields (not columns) hydrated on read:
//   _customer      — from the master-data cache (synchronous, free)
//   _latestSample  — via LATERAL join, so the QC sample gate is always
//                    evaluated against current data with no N+1 queries
// `_priorStatus` IS persisted (prior_status) — the clarification/reject
// return path depends on it surviving a restart.
//
// Entities:
//   1. Complaints              2. Complaint Line Items   3. Attachments
//   4. Sample Records          5. Visit Records          6. CAPA Records
//   7. Credit Notes
// =========================================================================

const db = require("../db/pool");
const masterData = require("./masterData");

const SAMPLE_STATUSES = ["Awaited", "Received", "Under Testing", "Tested", "Disposed"];
const VISIT_STATUSES  = ["Planned", "Completed", "Cancelled"];
// Mirrors the visits.outcome CHECK constraint in db/schema.sql — keep in step.
const VISIT_OUTCOMES  = ["Resolved On-Site", "Escalation Confirmed", "No Further Action"];

// ── generic update builder ───────────────────────────────────────────────
// Only whitelisted keys are written; anything else (e.g. the runtime-only
// `_latestSample`) is ignored rather than throwing.
function buildSet(updates, colMap) {
  const sets = [];
  const vals = [];
  for (const [key, value] of Object.entries(updates || {})) {
    const col = colMap[key];
    if (!col) continue;
    vals.push(value);
    sets.push(`${col} = $${vals.length}`);
  }
  return { sets, vals };
}

// ──────────────────────────────────────────────────────────────────────────
// 1. COMPLAINTS
// ──────────────────────────────────────────────────────────────────────────
const COMPLAINT_COLS = `
    c.complaint_no             AS "complaintNo",
    c.title, c.remarks, c.status,
    c.prior_status             AS "_priorStatus",
    c.business_line            AS "businessLine",
    c.invoice_number           AS "invoiceNumber",
    to_char(c.invoice_date, 'YYYY-MM-DD') AS "invoiceDate",
    c.invoice_value            AS "invoiceValue",
    c.currency,
    c.customer_id              AS "customerId",
    c.customer_name            AS "customerName",
    c.customer_segment         AS "customerSegment",
    c.is_key_account           AS "isKeyAccount",
    c.settlement_value         AS "settlementValue",
    c.policy_id                AS "policyId",
    c.policy_flag              AS "policyFlag",
    c.policy_compliance        AS "policyCompliance",
    c.policy_clause_breached   AS "policyClauseBreached",
    c.policy_forces_md_approval AS "policyForcesMdApproval",
    c.sample_required          AS "sampleRequired",
    c.visit_requested          AS "visitRequested",
    c.reported_by              AS "reportedBy",
    c.sap_validation_pending   AS "sapValidationPending",
    c.credit_note_number       AS "creditNoteNumber",
    c.sla_breached             AS "slaBreached",
    c.sla_breached_at          AS "slaBreachedAt",
    c.sla_breached_status      AS "slaBreachedStatus",
    c.archived,
    c.archived_at              AS "archivedAt",
    c.created_at               AS "createdAt",
    c.updated_at               AS "updatedAt",
    c.closed_at                AS "closedAt",
    ls.sample                  AS "_latestSample"`;

// Latest sample per complaint, as JSON — one join, no N+1.
const LATEST_SAMPLE_JOIN = `
  LEFT JOIN LATERAL (
    SELECT to_jsonb(s2) AS sample FROM (
      SELECT sample_id AS "sampleId", complaint_no AS "complaintNo",
             sample_type_id AS "sampleTypeId", sample_status AS "sampleStatus",
             test_result AS "testResult"
      FROM samples
      WHERE complaint_no = c.complaint_no
      ORDER BY created_at DESC
      LIMIT 1
    ) s2
  ) ls ON true`;

const COMPLAINT_UPDATE_COLS = {
  title: "title", remarks: "remarks", status: "status",
  _priorStatus: "prior_status", priorStatus: "prior_status",
  businessLine: "business_line",
  invoiceNumber: "invoice_number", invoiceDate: "invoice_date",
  invoiceValue: "invoice_value", currency: "currency",
  customerId: "customer_id", customerName: "customer_name",
  customerSegment: "customer_segment", isKeyAccount: "is_key_account",
  settlementValue: "settlement_value",
  policyId: "policy_id", policyFlag: "policy_flag",
  policyCompliance: "policy_compliance",
  policyClauseBreached: "policy_clause_breached",
  policyForcesMdApproval: "policy_forces_md_approval",
  sampleRequired: "sample_required", visitRequested: "visit_requested",
  reportedBy: "reported_by", sapValidationPending: "sap_validation_pending",
  creditNoteNumber: "credit_note_number", closedAt: "closed_at",
  // Background engine state. Absent from this map, the SLA and archival
  // engines' writes were accepted and silently discarded — buildSet drops any
  // key it does not know, so nothing failed loudly.
  slaBreached: "sla_breached", slaBreachedAt: "sla_breached_at",
  slaBreachedStatus: "sla_breached_status",
  archived: "archived", archivedAt: "archived_at",
};

// Attach the customer record from the master cache (used by the visit gate).
function hydrate(row) {
  if (!row) return null;
  row._customer = row.customerId ? masterData.findCustomer(row.customerId) : null;
  if (row._latestSample === undefined) row._latestSample = null;
  return row;
}

const complaintStore = {
  async create(data) {
    const row = await db.one(
      `INSERT INTO complaints (
         title, remarks, status, business_line, invoice_number, invoice_date,
         invoice_value, currency, customer_id, customer_name, customer_segment,
         is_key_account, settlement_value, policy_id, policy_flag,
         policy_compliance, policy_clause_breached, policy_forces_md_approval,
         sample_required, visit_requested, reported_by, sap_validation_pending)
       VALUES ($1,$2,'Logged',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING complaint_no`,
      [
        data.title || "", data.remarks || "", data.businessLine || null,
        data.invoiceNumber, data.invoiceDate || null,
        parseFloat(data.invoiceValue || 0), data.currency || "INR",
        data.customerId, data.customerName || null, data.customerSegment || null,
        data.isKeyAccount || false, parseFloat(data.settlementValue || 0),
        data.policyId || null, data.policyFlag || null,
        data.policyCompliance == null ? null : data.policyCompliance,
        data.policyClauseBreached || null, data.policyForcesMdApproval || false,
        data.sampleRequired || false, data.visitRequested || false,
        data.reportedBy || null, data._sapFallback || false,
      ]
    );
    return this.getByNo(row.complaint_no);
  },

  async getAll(filters = {}) {
    const where = [];
    const vals = [];
    if (filters.status)       { vals.push(filters.status);       where.push(`c.status = $${vals.length}`); }
    if (filters.customerId)   { vals.push(filters.customerId);   where.push(`c.customer_id = $${vals.length}`); }
    if (filters.businessLine) { vals.push(filters.businessLine); where.push(`c.business_line = $${vals.length}`); }
    // Archived complaints are excluded unless asked for. Section 12.7 keeps
    // them out of live views and KPIs, and defaulting to exclude means a
    // caller that forgets the filter gets the policy's answer rather than a
    // quietly wrong one.
    //   (omitted)      → live records only
    //   archived: true → the archive
    //   archived: null → both, ignoring the distinction
    if (filters.archived !== null) {
      vals.push(filters.archived === undefined ? false : filters.archived);
      where.push(`c.archived = $${vals.length}`);
    }
    const rows = await db.many(
      `SELECT ${COMPLAINT_COLS} FROM complaints c ${LATEST_SAMPLE_JOIN}
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY c.created_at DESC`,
      vals
    );
    return rows.map(hydrate);
  },

  async getByNo(complaintNo) {
    const row = await db.one(
      `SELECT ${COMPLAINT_COLS} FROM complaints c ${LATEST_SAMPLE_JOIN}
       WHERE c.complaint_no = $1`,
      [complaintNo]
    );
    return hydrate(row);
  },

  async update(complaintNo, updates) {
    const { sets, vals } = buildSet(updates, COMPLAINT_UPDATE_COLS);
    if (sets.length) {
      vals.push(complaintNo);
      await db.query(
        `UPDATE complaints SET ${sets.join(", ")} WHERE complaint_no = $${vals.length}`,
        vals
      );
    }
    return this.getByNo(complaintNo);
  },
};

// ──────────────────────────────────────────────────────────────────────────
// 2. COMPLAINT LINE ITEMS
// ──────────────────────────────────────────────────────────────────────────
const LINE_ITEM_COLS = `
    line_item_id        AS "lineItemId",
    complaint_no        AS "complaintNo",
    invoice_number      AS "invoiceNumber",
    invoice_item_no     AS "invoiceItemNo",
    sap_material_no     AS "sapMaterialNo",
    product_name        AS "productName",
    invoice_qty         AS "invoiceQty",
    unit_price          AS "unitPrice",
    defective_qty       AS "defectiveQty",
    uom,
    defective_value     AS "defectiveValue",
    complaint_type_id   AS "complaintTypeId",
    complaint_type_name AS "complaintTypeName",
    sample_required     AS "sampleRequired",
    created_at          AS "createdAt"`;

const lineItemStore = {
  // defective_value is a GENERATED column — the database computes
  // unit_price * defective_qty, so it can never drift from its inputs.
  async create(data) {
    return db.one(
      `INSERT INTO complaint_line_items (
         complaint_no, invoice_number, invoice_item_no, sap_material_no,
         product_name, invoice_qty, unit_price, defective_qty, uom,
         complaint_type_id, complaint_type_name, sample_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${LINE_ITEM_COLS}`,
      [
        data.complaintNo, data.invoiceNumber || null, data.invoiceItemNo || null,
        data.sapMaterialNo || null, data.productName || null,
        parseFloat(data.invoiceQty || 0), parseFloat(data.unitPrice || 0),
        parseFloat(data.defectiveQty || 0), data.uom || "Ream",
        data.complaintTypeId || null, data.complaintTypeName || null,
        data.sampleRequired || false,
      ]
    );
  },

  async getForComplaint(complaintNo) {
    return db.many(
      `SELECT ${LINE_ITEM_COLS} FROM complaint_line_items
       WHERE complaint_no = $1 ORDER BY created_at`,
      [complaintNo]
    );
  },

  async getById(lineItemId) {
    return db.one(`SELECT ${LINE_ITEM_COLS} FROM complaint_line_items WHERE line_item_id = $1`, [lineItemId]);
  },

  async getTotalDefectiveValue(complaintNo) {
    const row = await db.one(
      `SELECT COALESCE(SUM(defective_value), 0) AS total
       FROM complaint_line_items WHERE complaint_no = $1`,
      [complaintNo]
    );
    return parseFloat(row.total);
  },
};

// ──────────────────────────────────────────────────────────────────────────
// 3. COMPLAINT ATTACHMENTS
// ──────────────────────────────────────────────────────────────────────────
const ATTACHMENT_COLS = `
    attachment_id  AS "attachmentId",
    complaint_no   AS "complaintNo",
    line_item_id   AS "lineItemId",
    file_reference AS "fileReference",
    file_type      AS "fileType",
    description,
    uploaded_by    AS "uploadedBy",
    uploaded_at    AS "uploadedAt",
    purged,
    purged_at      AS "purgedAt"`;

const attachmentStore = {
  async create(data) {
    return db.one(
      `INSERT INTO attachments (complaint_no, line_item_id, file_reference,
                                file_type, description, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${ATTACHMENT_COLS}`,
      [
        data.complaintNo, data.lineItemId || null, data.fileReference,
        data.fileType || "photo", data.description || "", data.uploadedBy || null,
      ]
    );
  },

  async getForComplaint(complaintNo) {
    return db.many(`SELECT ${ATTACHMENT_COLS} FROM attachments WHERE complaint_no = $1 ORDER BY uploaded_at`, [complaintNo]);
  },

  async getForLineItem(lineItemId) {
    return db.many(`SELECT ${ATTACHMENT_COLS} FROM attachments WHERE line_item_id = $1 ORDER BY uploaded_at`, [lineItemId]);
  },

  // Flag the file as purged (metadata retained for audit) — archival engine.
  async markPurged(attachmentId) {
    return db.one(
      `UPDATE attachments SET purged = true, purged_at = now()
       WHERE attachment_id = $1 RETURNING ${ATTACHMENT_COLS}`,
      [attachmentId]
    );
  },
};

// ──────────────────────────────────────────────────────────────────────────
// 4. SAMPLE RECORDS  —  Section 6.3
// ──────────────────────────────────────────────────────────────────────────
const SAMPLE_COLS = `
    sample_id             AS "sampleId",
    complaint_no          AS "complaintNo",
    line_item_id          AS "lineItemId",
    sample_type_id        AS "sampleTypeId",
    sample_type_name      AS "sampleTypeName",
    dispatch_mode         AS "dispatchMode",
    to_char(dispatched_date, 'YYYY-MM-DD') AS "dispatchedDate",
    to_char(received_date, 'YYYY-MM-DD')   AS "receivedDate",
    received_by           AS "receivedBy",
    sample_status         AS "sampleStatus",
    test_result           AS "testResult",
    test_result_notes     AS "testResultNotes",
    test_report_reference AS "testReportReference",
    to_char(disposal_date, 'YYYY-MM-DD')   AS "disposalDate",
    created_at            AS "createdAt",
    updated_at            AS "updatedAt"`;

const SAMPLE_UPDATE_COLS = {
  lineItemId: "line_item_id", sampleTypeId: "sample_type_id",
  sampleTypeName: "sample_type_name", dispatchMode: "dispatch_mode",
  dispatchedDate: "dispatched_date", receivedDate: "received_date",
  receivedBy: "received_by", sampleStatus: "sample_status",
  testResult: "test_result", testResultNotes: "test_result_notes",
  testReportReference: "test_report_reference", disposalDate: "disposal_date",
};

const sampleStore = {
  async create(data) {
    return db.one(
      `INSERT INTO samples (complaint_no, line_item_id, sample_type_id,
                            sample_type_name, dispatch_mode, dispatched_date)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${SAMPLE_COLS}`,
      [
        data.complaintNo, data.lineItemId || null, data.sampleTypeId,
        data.sampleTypeName || null, data.dispatchMode || "Courier",
        data.dispatchedDate || null,
      ]
    );
  },

  async getForComplaint(complaintNo) {
    return db.many(`SELECT ${SAMPLE_COLS} FROM samples WHERE complaint_no = $1 ORDER BY created_at`, [complaintNo]);
  },

  async getById(sampleId) {
    return db.one(`SELECT ${SAMPLE_COLS} FROM samples WHERE sample_id = $1`, [sampleId]);
  },

  async getLatestForComplaint(complaintNo) {
    return db.one(
      `SELECT ${SAMPLE_COLS} FROM samples WHERE complaint_no = $1
       ORDER BY created_at DESC LIMIT 1`,
      [complaintNo]
    );
  },

  async update(sampleId, updates) {
    const { sets, vals } = buildSet(updates, SAMPLE_UPDATE_COLS);
    if (sets.length) {
      vals.push(sampleId);
      await db.query(`UPDATE samples SET ${sets.join(", ")} WHERE sample_id = $${vals.length}`, vals);
    }
    return this.getById(sampleId);
  },
};

// ──────────────────────────────────────────────────────────────────────────
// 5. VISIT RECORDS  —  Section 7.1
// ──────────────────────────────────────────────────────────────────────────
const VISIT_COLS = `
    visit_id                 AS "visitId",
    complaint_no             AS "complaintNo",
    visit_type               AS "visitType",
    trigger_reason           AS "triggerReason",
    to_char(scheduled_date, 'YYYY-MM-DD') AS "scheduledDate",
    assigned_to              AS "assignedTo",
    visit_status             AS "visitStatus",
    to_char(visit_date, 'YYYY-MM-DD')     AS "visitDate",
    findings,
    customer_acknowledgement AS "customerAcknowledgement",
    outcome,
    created_at               AS "createdAt",
    updated_at               AS "updatedAt"`;

const VISIT_UPDATE_COLS = {
  visitType: "visit_type", triggerReason: "trigger_reason",
  scheduledDate: "scheduled_date", assignedTo: "assigned_to",
  visitStatus: "visit_status", visitDate: "visit_date",
  findings: "findings", customerAcknowledgement: "customer_acknowledgement",
  outcome: "outcome",
};

const visitStore = {
  async create(data) {
    return db.one(
      `INSERT INTO visits (complaint_no, visit_type, trigger_reason,
                           scheduled_date, assigned_to)
       VALUES ($1,$2,$3,$4,$5) RETURNING ${VISIT_COLS}`,
      [
        data.complaintNo, data.visitType || "Optional", data.triggerReason || null,
        data.scheduledDate || null, data.assignedTo || null,
      ]
    );
  },

  async getForComplaint(complaintNo) {
    return db.many(`SELECT ${VISIT_COLS} FROM visits WHERE complaint_no = $1 ORDER BY created_at`, [complaintNo]);
  },

  async getById(visitId) {
    return db.one(`SELECT ${VISIT_COLS} FROM visits WHERE visit_id = $1`, [visitId]);
  },

  async update(visitId, updates) {
    const { sets, vals } = buildSet(updates, VISIT_UPDATE_COLS);
    if (sets.length) {
      vals.push(visitId);
      await db.query(`UPDATE visits SET ${sets.join(", ")} WHERE visit_id = $${vals.length}`, vals);
    }
    return this.getById(visitId);
  },

  /** Delete a visit outright. Callers must first establish that it holds no
   *  recorded work — a visit that happened is cancelled, never removed. */
  async remove(visitId) {
    const { rowCount } = await db.query(`DELETE FROM visits WHERE visit_id = $1`, [visitId]);
    return rowCount > 0;
  },
};

// ──────────────────────────────────────────────────────────────────────────
// 6. CAPA RECORDS  —  Section 4
// ──────────────────────────────────────────────────────────────────────────
const CAPA_COLS = `
    capa_id                AS "capaId",
    complaint_no           AS "complaintNo",
    root_cause_description AS "rootCauseDescription",
    corrective_action      AS "correctiveAction",
    preventive_action      AS "preventiveAction",
    documented_by          AS "documentedBy",
    documented_by_name     AS "documentedByName",
    documented_date        AS "documentedDate",
    sample_test_reference  AS "sampleTestReference"`;

const capaStore = {
  async create(data) {
    return db.one(
      `INSERT INTO capa_records (complaint_no, root_cause_description,
                                 corrective_action, preventive_action,
                                 documented_by, documented_by_name,
                                 sample_test_reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${CAPA_COLS}`,
      [
        data.complaintNo, data.rootCauseDescription || "",
        data.correctiveAction || "", data.preventiveAction || "",
        data.documentedBy || null, data.documentedByName || null,
        data.sampleTestReference || null,
      ]
    );
  },

  async getForComplaint(complaintNo) {
    return db.many(`SELECT ${CAPA_COLS} FROM capa_records WHERE complaint_no = $1 ORDER BY documented_date`, [complaintNo]);
  },

  async getById(capaId) {
    return db.one(`SELECT ${CAPA_COLS} FROM capa_records WHERE capa_id = $1`, [capaId]);
  },
};

// ──────────────────────────────────────────────────────────────────────────
// 7. CREDIT NOTES  —  Section 4 + SAP touchpoints 5 & 6
// ──────────────────────────────────────────────────────────────────────────
const CREDIT_NOTE_COLS = `
    credit_note_id      AS "creditNoteId",
    complaint_no        AS "complaintNo",
    credit_note_number  AS "creditNoteNumber",
    sap_document_number AS "sapDocumentNumber",
    amount, currency,
    raised_by           AS "raisedBy",
    raised_by_name      AS "raisedByName",
    raised_date         AS "raisedDate",
    notified_to         AS "notifiedTo"`;

const creditNoteStore = {
  async create(data) {
    return db.one(
      `INSERT INTO credit_notes (complaint_no, credit_note_number, sap_document_number,
                                 amount, currency, raised_by, raised_by_name, notified_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING ${CREDIT_NOTE_COLS}`,
      [
        data.complaintNo, data.creditNoteNumber,
        data.sapDocumentNumber || data.creditNoteNumber,
        parseFloat(data.amount || 0), data.currency || "INR",
        data.raisedBy || null, data.raisedByName || null,
        JSON.stringify(data.notifiedTo || []),
      ]
    );
  },

  async getForComplaint(complaintNo) {
    return db.many(`SELECT ${CREDIT_NOTE_COLS} FROM credit_notes WHERE complaint_no = $1 ORDER BY raised_date`, [complaintNo]);
  },
};

module.exports = {
  complaintStore,
  lineItemStore,
  attachmentStore,
  sampleStore,
  visitStore,
  capaStore,
  creditNoteStore,
  SAMPLE_STATUSES,
  VISIT_STATUSES,
  VISIT_OUTCOMES,
};
