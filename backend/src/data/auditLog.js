// =========================================================================
// WORKFLOW AUDIT LOG  —  CCMS
// Section 12.6 — Non-Functional Requirements (Append-Only / Immutable)
//
// Design rules enforced in code:
//   1. APPEND-ONLY: entries are pushed to the array and immediately frozen
//      with Object.freeze() — no property can ever be changed after write.
//   2. The array itself is never exposed directly — only copies are returned.
//   3. There is no delete, update, or truncate function.
//   4. Every entry has a sequential logId, timestamp, and SHA-style checksum
//      of its content so any tampering attempt is detectable.
//   5. Both human (User) and system (SAP, SLA Engine) actions are recorded.
// =========================================================================

const crypto = require("crypto");

let auditLog = [];
let logCounter = 1;

// ── Checksum ──────────────────────────────────────────────────────────────
// SHA-256 of the entry content (excluding the checksum field itself).
// Allows independent verification that an entry was not altered post-write.
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

// ── log() ─────────────────────────────────────────────────────────────────
function log(params) {
  const entry = {
    logId:       `LOG-${String(logCounter++).padStart(6, "0")}`,
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

  // Attach integrity checksum
  entry.checksum = computeChecksum(entry);

  // FREEZE — entry is now immutable at the JS level
  Object.freeze(entry);

  auditLog.push(entry);
  return entry;
}

// ── Read-only accessors ───────────────────────────────────────────────────
function getForComplaint(complaintNo) {
  return auditLog
    .filter((e) => e.complaintNo === complaintNo)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function getAll() {
  return [...auditLog].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

// ── Integrity verifier ────────────────────────────────────────────────────
// Call GET /api/audit-log/verify to confirm no entry has been tampered with.
function verifyIntegrity() {
  const results = auditLog.map((entry) => {
    const expected = computeChecksum(entry);
    return {
      logId:    entry.logId,
      valid:    entry.checksum === expected,
      checksum: entry.checksum,
    };
  });
  const tampered = results.filter((r) => !r.valid);
  return {
    totalEntries: auditLog.length,
    valid:        tampered.length === 0,
    tamperedCount: tampered.length,
    tampered,
  };
}

module.exports = { log, getForComplaint, getAll, verifyIntegrity };
