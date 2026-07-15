// =========================================================================
// ARCHIVAL SERVICE  —  Orient Paper & Mill CCMS
// Section 12.7 — Data Retention & Archival Policy
//
// Policy (all configurable via .env):
//   ATTACHMENT_RETENTION_DAYS  = 365  (1 year full-res after closure)
//   COMPLAINT_ARCHIVE_DAYS     = 730  (2 years before archival)
//   ARCHIVE_TICK_HOURS         = 24   (run nightly)
//
// Archival actions:
//   1. Attachments older than ATTACHMENT_RETENTION_DAYS after complaint
//      closure are flagged for deletion (file purge) but metadata retained.
//   2. Complaints closed longer than COMPLAINT_ARCHIVE_DAYS are moved to
//      an "archived" store — still queryable for compliance but excluded
//      from live KPI calculations.
//   3. Every archival action is written to the audit log (System actor).
//   4. GET /api/archive gives the archived complaint list.
//   5. GET /api/archive/:complaintNo retrieves an archived complaint.
// =========================================================================

require("dotenv").config();
const { complaintStore, attachmentStore } = require("../data/transactionalStore");
const audit = require("../data/auditLog");

const ATTACHMENT_RETENTION_DAYS = parseInt(process.env.ATTACHMENT_RETENTION_DAYS || "365");
const COMPLAINT_ARCHIVE_DAYS    = parseInt(process.env.COMPLAINT_ARCHIVE_DAYS    || "730");
const ARCHIVE_TICK_HOURS        = parseInt(process.env.ARCHIVE_TICK_HOURS        || "24");
const ARCHIVE_ENABLED           = process.env.ARCHIVE_ENABLED !== "false";

// ── Archive store (in-memory — replace with DB collection in production) ──
const archivedComplaints = [];
const archivalLog = [];

function logArchival(entry) {
  archivalLog.push({ ...entry, archivedAt: new Date().toISOString() });
}

function getAllArchived() {
  return [...archivedComplaints];
}

function getArchivedComplaint(complaintNo) {
  return archivedComplaints.find((c) => c.complaintNo === complaintNo) || null;
}

function getAllArchivalLog() {
  return [...archivalLog].reverse();
}

// ── Helpers ───────────────────────────────────────────────────────────────
function daysSince(isoDate) {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
}

// ── Core archival run ─────────────────────────────────────────────────────
async function runArchivalCheck() {
  const now = new Date().toISOString();
  console.log(`\n🗄️  [ARCHIVAL] Running check at ${now}`);

  const all = await complaintStore.getAll();
  let attachmentsPurged = 0;
  let complaintsArchived = 0;

  for (const complaint of all) {
    // Only process closed complaints
    if (complaint.status !== "Closed" && complaint.status !== "Auto_Closed") continue;
    if (!complaint.closedAt) continue;
    if (complaint.archived) continue; // already archived

    const daysSinceClosure = daysSince(complaint.closedAt);

    // ── 1. Attachment retention check ─────────────────────────────────
    if (daysSinceClosure >= ATTACHMENT_RETENTION_DAYS) {
      const attachments = attachmentStore
        ? await attachmentStore.getForComplaint(complaint.complaintNo)
        : [];

      for (const att of attachments) {
        if (att.purged) continue;

        // Flag for purge — in production this deletes the file from S3/disk
        // Here we mark the metadata and log it
        attachmentStore && attachmentStore.markPurged && await attachmentStore.markPurged(att.attachmentId);

        logArchival({
          type:        "attachment_purge",
          complaintNo: complaint.complaintNo,
          attachmentId: att.attachmentId,
          fileReference: att.fileReference,
          reason:      `Retention period (${ATTACHMENT_RETENTION_DAYS} days) exceeded`,
          daysSinceClosure,
        });

        await audit.log({
          complaintNo: complaint.complaintNo,
          action:      "Attachment Purged",
          actorType:   "System",
          actorId:     "ARCHIVAL_ENGINE",
          actorRole:   "System",
          remarks:     `Attachment ${att.fileReference} purged after ${ATTACHMENT_RETENTION_DAYS}-day retention window. Metadata retained for compliance.`,
        });

        attachmentsPurged++;
      }
    }

    // ── 2. Complaint archival check ────────────────────────────────────
    if (daysSinceClosure >= COMPLAINT_ARCHIVE_DAYS) {
      // Move to archived store
      archivedComplaints.push({
        ...complaint,
        archived:   true,
        archivedAt: now,
        archivalNote: `Archived after ${COMPLAINT_ARCHIVE_DAYS} days post-closure. Metadata retained for compliance. Attachments purged per retention policy.`,
      });

      // Mark as archived in live store (excluded from KPI/live queries)
      await complaintStore.update(complaint.complaintNo, { archived: true, archivedAt: now });

      logArchival({
        type:        "complaint_archive",
        complaintNo: complaint.complaintNo,
        closedAt:    complaint.closedAt,
        daysSinceClosure,
        reason:      `Archive window (${COMPLAINT_ARCHIVE_DAYS} days) exceeded`,
      });

      await audit.log({
        complaintNo: complaint.complaintNo,
        action:      "Complaint Archived",
        actorType:   "System",
        actorId:     "ARCHIVAL_ENGINE",
        actorRole:   "System",
        remarks:     `Complaint archived after ${COMPLAINT_ARCHIVE_DAYS} days post-closure. Still queryable via GET /api/archive/${complaint.complaintNo}.`,
      });

      complaintsArchived++;
      console.log(`   🗄️  ARCHIVED: ${complaint.complaintNo}`);
    }
  }

  console.log(`   ✅ Archival check complete — ${attachmentsPurged} attachment(s) purged, ${complaintsArchived} complaint(s) archived\n`);

  return {
    checkedComplaints: all.filter((c) => c.status === "Closed" || c.status === "Auto_Closed").length,
    attachmentsPurged,
    complaintsArchived,
  };
}

// ── Policy summary (for GET /api/archive/policy) ──────────────────────────
function getPolicy() {
  return {
    enabled: ARCHIVE_ENABLED,
    tickHours: ARCHIVE_TICK_HOURS,
    rules: [
      {
        rule: "Attachment Retention",
        window: `${ATTACHMENT_RETENTION_DAYS} days after complaint closure`,
        action: "Attachment file purged from storage. Metadata (filename, upload date, uploader) retained permanently for audit trail.",
        rationale: "Photo/video attachments accumulate storage cost. 1-year retention covers all reasonable dispute/audit windows.",
      },
      {
        rule: "Complaint Archival",
        window: `${COMPLAINT_ARCHIVE_DAYS} days after complaint closure`,
        action: "Complaint moved to archive store. Excluded from live KPI calculations and default list views. Still fully queryable via GET /api/archive/:complaintNo.",
        rationale: "Keeps the live complaint store lean and fast. Archived records remain available for compliance audits indefinitely.",
      },
    ],
    currentStats: {
      totalArchived: archivedComplaints.length,
      archivalLogEntries: archivalLog.length,
    },
  };
}

// ── Scheduler ─────────────────────────────────────────────────────────────
let archiveInterval = null;

function startArchivalEngine() {
  if (!ARCHIVE_ENABLED) {
    console.log("🗄️  [ARCHIVAL] Disabled (ARCHIVE_ENABLED=false)");
    return;
  }

  const tickMs = ARCHIVE_TICK_HOURS * 60 * 60 * 1000;
  console.log(`🗄️  [ARCHIVAL ENGINE] Started — running every ${ARCHIVE_TICK_HOURS} hour(s)`);
  console.log(`   Attachment retention : ${ATTACHMENT_RETENTION_DAYS} days post-closure`);
  console.log(`   Complaint archival   : ${COMPLAINT_ARCHIVE_DAYS} days post-closure`);

  // Run once on startup, then on interval
  runArchivalCheck().catch(console.error);
  archiveInterval = setInterval(() => runArchivalCheck().catch(console.error), tickMs);
}

function stopArchivalEngine() {
  if (archiveInterval) clearInterval(archiveInterval);
}

module.exports = {
  startArchivalEngine,
  stopArchivalEngine,
  runArchivalCheck,
  getAllArchived,
  getArchivedComplaint,
  getAllArchivalLog,
  getPolicy,
};
