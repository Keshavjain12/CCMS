// =========================================================================
// WORKFLOW AUDIT LOG  —  CCMS
// Section 12.6 — Non-Functional Requirements (Append-Only / Immutable)
//
// Backed by PostgreSQL. Every function is async — await them.
//
// Design rules, now enforced by the database rather than by convention:
//   1. APPEND-ONLY: BEFORE UPDATE / DELETE / TRUNCATE triggers on audit_log
//      raise an exception. Object.freeze() only protected the running
//      process; these protect the data itself.
//   2. There is no update, delete, or truncate function here — and even a
//      direct psql session cannot alter a row.
//   3. Every entry has a sequential logId, timestamp, and SHA-256 checksum
//      of its content so any tampering attempt is detectable.
//   4. Both human (User) and system (SAP, SLA Engine) actions are recorded.
// =========================================================================

const crypto = require("crypto");
const db = require("../db/pool");

// ── Checksum ──────────────────────────────────────────────────────────────
// SHA-256 of the entry content (excluding the checksum field itself).
// Unchanged from the in-memory version, so historical entries stay verifiable.
function computeChecksum(entry) {
  const payload = JSON.stringify({
    logId:       entry.logId,
    complaintNo: entry.complaintNo,
    fromStatus:  entry.fromStatus,
    toStatus:    entry.toStatus,
    action:      entry.action,
    actorType:   entry.actorType,
    actorId:     entry.actorId,
    actorRole:   entry.actorRole,
    remarks:     entry.remarks,
    timestamp:   entry.timestamp,
  });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

const COLS = `
    'LOG-' || lpad(log_id::text, 6, '0') AS "logId",
    complaint_no AS "complaintNo",
    stage,
    from_status  AS "fromStatus",
    to_status    AS "toStatus",
    action,
    actor_type   AS "actorType",
    actor_id     AS "actorId",
    actor_role   AS "actorRole",
    remarks,
    "timestamp",
    checksum`;

// ── log() ─────────────────────────────────────────────────────────────────
// The checksum covers logId and timestamp, so both must be known BEFORE the
// insert. We draw the id from the sequence and stamp the time in JS, compute
// the checksum, then write the row exactly once.
//
// Deliberate: an insert-then-update-the-checksum approach would need to
// defeat the append-only triggers, which would mean any session could defeat
// them too. A single INSERT keeps the guarantee absolute — nothing in this
// codebase, or in a psql prompt, can alter a row after it lands.
async function log(params) {
  const idRow = await db.one(`SELECT nextval('audit_log_log_id_seq') AS id`);
  const logIdNum = idRow.id;

  const entry = {
    logId:       `LOG-${String(logIdNum).padStart(6, "0")}`,
    complaintNo: params.complaintNo,
    stage:       params.toStatus || params.fromStatus,
    fromStatus:  params.fromStatus || null,
    toStatus:    params.toStatus   || null,
    action:      params.action,
    actorType:   params.actorType  || "User",
    actorId:     params.actorId    || "UNKNOWN",
    actorRole:   params.actorRole  || null,
    remarks:     params.remarks    || null,
    timestamp:   new Date().toISOString(),
  };
  entry.checksum = computeChecksum(entry);

  await db.query(
    `INSERT INTO audit_log (log_id, complaint_no, stage, from_status, to_status,
                            action, actor_type, actor_id, actor_role, remarks,
                            "timestamp", checksum)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      logIdNum, entry.complaintNo, entry.stage, entry.fromStatus, entry.toStatus,
      entry.action, entry.actorType, entry.actorId, entry.actorRole,
      entry.remarks, entry.timestamp, entry.checksum,
    ]
  );

  return Object.freeze(entry);
}

// ── Read-only accessors ───────────────────────────────────────────────────
async function getForComplaint(complaintNo) {
  return db.many(
    `SELECT ${COLS} FROM audit_log WHERE complaint_no = $1 ORDER BY "timestamp" DESC, log_id DESC`,
    [complaintNo]
  );
}

async function getAll() {
  return db.many(`SELECT ${COLS} FROM audit_log ORDER BY "timestamp" DESC, log_id DESC`);
}

// ── Integrity verifier ────────────────────────────────────────────────────
// GET /api/audit-log/verify — recomputes every checksum and reports drift.
async function verifyIntegrity() {
  const rows = await db.many(`SELECT ${COLS} FROM audit_log ORDER BY log_id`);
  const results = rows.map((row) => {
    const expected = computeChecksum({
      logId:       row.logId,
      complaintNo: row.complaintNo,
      fromStatus:  row.fromStatus,
      toStatus:    row.toStatus,
      action:      row.action,
      actorType:   row.actorType,
      actorId:     row.actorId,
      actorRole:   row.actorRole,
      remarks:     row.remarks,
      timestamp:   row.timestamp.toISOString(),
    });
    return { logId: row.logId, valid: row.checksum === expected, checksum: row.checksum };
  });
  const tampered = results.filter((r) => !r.valid);
  return {
    totalEntries:  rows.length,
    valid:         tampered.length === 0,
    tamperedCount: tampered.length,
    tampered,
  };
}

module.exports = { log, getForComplaint, getAll, verifyIntegrity };
