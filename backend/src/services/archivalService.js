



















require("dotenv").config();
const { complaintStore, attachmentStore } = require("../data/transactionalStore");
const audit = require("../data/auditLog");
const rollout = require("../config/rollout");
const fileStore = require("../utils/fileStore");

const ATTACHMENT_RETENTION_DAYS = parseInt(process.env.ATTACHMENT_RETENTION_DAYS || "365");
const COMPLAINT_ARCHIVE_DAYS    = parseInt(process.env.COMPLAINT_ARCHIVE_DAYS    || "730");
const ARCHIVE_TICK_HOURS        = parseInt(process.env.ARCHIVE_TICK_HOURS        || "24");
const ARCHIVE_ENABLED           = process.env.ARCHIVE_ENABLED !== "false";






async function getAllArchived() {
  return complaintStore.getAll({ archived: true });
}

async function getArchivedComplaint(complaintNo) {
  const c = await complaintStore.getByNo(complaintNo);
  return c && c.archived ? c : null;
}





const archivalLog = [];

function logArchival(entry) {
  archivalLog.push({ ...entry, archivedAt: new Date().toISOString() });
}

function getAllArchivalLog() {
  return [...archivalLog].reverse();
}


function daysSince(isoDate) {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
}


async function runArchivalCheck() {
  const now = new Date().toISOString();
  console.log(`\n🗄️  [ARCHIVAL] Running check at ${now}`);



  const all = await complaintStore.getAll({ archived: false });
  let attachmentsPurged = 0;
  let complaintsArchived = 0;

  for (const complaint of all) {

    if (complaint.status !== "Closed" && complaint.status !== "Auto_Closed") continue;
    if (!complaint.closedAt) continue;

    const daysSinceClosure = daysSince(complaint.closedAt);


    if (daysSinceClosure >= ATTACHMENT_RETENTION_DAYS) {
      const attachments = attachmentStore
        ? await attachmentStore.getForComplaint(complaint.complaintNo)
        : [];

      for (const att of attachments) {
        if (att.purged) continue;




        attachmentStore && attachmentStore.markPurged && await attachmentStore.markPurged(att.attachmentId);
        fileStore.remove(att.fileReference);

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


    if (daysSinceClosure >= COMPLAINT_ARCHIVE_DAYS) {





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


async function getPolicy() {
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
      totalArchived: (await getAllArchived()).length,

      archivalLogEntriesThisRun: archivalLog.length,
    },
  };
}


let archiveInterval = null;

function startArchivalEngine() {
  if (!ARCHIVE_ENABLED) {
    console.log("🗄️  [ARCHIVAL] Disabled (ARCHIVE_ENABLED=false)");
    return;
  }



  if (!rollout.isFeatureEnabled("archival")) {
    console.log(`🗄️  [ARCHIVAL] Disabled — not enabled in ${rollout.currentPhase.label}`);
    return;
  }

  const tickMs = ARCHIVE_TICK_HOURS * 60 * 60 * 1000;
  console.log(`🗄️  [ARCHIVAL ENGINE] Started — running every ${ARCHIVE_TICK_HOURS} hour(s)`);
  console.log(`   Attachment retention : ${ATTACHMENT_RETENTION_DAYS} days post-closure`);
  console.log(`   Complaint archival   : ${COMPLAINT_ARCHIVE_DAYS} days post-closure`);


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
