// =========================================================================
// SLA ENGINE  —  Orient Paper & Mill CCMS
// Section 12.2 — SLA & Auto-Escalation Engine
//
// Runs as a background job (interval-based).
// Every tick it checks all active complaints and:
//   1. Flags complaints that have breached their per-stage SLA
//   2. Sends escalation notifications to the stage owner's supervisor
//   3. Records every breach in the audit log
//   4. Auto-closes complaints stuck in Clarification_Sought beyond the
//      customer-response window
//
// Configuration (all in .env):
//   SLA_TICK_MINUTES   — how often the engine runs (default 60 mins)
//   STAGE_SLA_DAYS     — default days per stage before escalation (default 3)
//   SAMPLE_SLA_DAYS    — days before Sample_Awaited escalates (default 7)
//   CLARIFY_SLA_DAYS   — days before Clarification_Sought auto-closes (default 30)
//   SLA_ENABLED        — set false to disable the engine (default true)
// =========================================================================

require("dotenv").config();
const { complaintStore } = require("../data/transactionalStore");
const audit              = require("../data/auditLog");
const notify             = require("./notificationService");
const md                 = require("../data/masterData");

// ── Config ────────────────────────────────────────────────────────────────
const SLA_ENABLED      = process.env.SLA_ENABLED !== "false";
const TICK_MINUTES     = parseInt(process.env.SLA_TICK_MINUTES || "60");
const STAGE_SLA_DAYS   = parseInt(process.env.STAGE_SLA_DAYS   || "3");
const SAMPLE_SLA_DAYS  = parseInt(process.env.SAMPLE_SLA_DAYS  || "7");
const CLARIFY_SLA_DAYS = parseInt(process.env.CLARIFY_SLA_DAYS || "30");

// ── Per-status SLA windows (days) ─────────────────────────────────────────
// Overrides the default STAGE_SLA_DAYS for specific stages.
const STATUS_SLA = {
  Logged:                   1,   // Must be picked up by TS same day
  TS_Review:                STAGE_SLA_DAYS,
  QC_Review:                STAGE_SLA_DAYS,
  Sample_Awaited:           SAMPLE_SLA_DAYS,
  CAPA_Pending:             STAGE_SLA_DAYS,
  Ops_Head_Approval:        STAGE_SLA_DAYS,
  Marketing_Review:         STAGE_SLA_DAYS,
  Marketing_Head_Approval:  STAGE_SLA_DAYS,
  MD_Approval:              2,   // MD gets 2 days
  Visit_Pending:            5,   // Visit team gets 5 days to complete visit
  Finance_Processing:       STAGE_SLA_DAYS,
};

// ── Escalation matrix (who to notify when a stage breaches) ───────────────
// Maps status → supervisor role name to escalate to
const ESCALATION_MAP = {
  Logged:                   "TS Head",
  TS_Review:                "QC Manager",
  QC_Review:                "Operations Head",
  Sample_Awaited:           "Operations Head",
  CAPA_Pending:             "Operations Head",
  Ops_Head_Approval:        "Marketing Head",
  Marketing_Review:         "Marketing Head",
  Marketing_Head_Approval:  "Managing Director",
  MD_Approval:              "Admin",
  Visit_Pending:            "Finance Officer",
  Finance_Processing:       "Admin",
};

// ── Terminal / side statuses (skip SLA checks) ────────────────────────────
const SKIP_STATUSES = new Set([
  "Draft", "Closed", "Auto_Closed", "Rejected",
]);

// ── SLA breach log (in-memory) ────────────────────────────────────────────
const slaBreaches = [];

function logBreach(entry) {
  slaBreaches.push({ ...entry, detectedAt: new Date().toISOString() });
}

function getAllBreaches() {
  return [...slaBreaches].reverse();
}

function getBreachesForComplaint(complaintNo) {
  return slaBreaches.filter((b) => b.complaintNo === complaintNo).reverse();
}

// ── Helpers ───────────────────────────────────────────────────────────────
function daysSince(isoDate) {
  const ms = Date.now() - new Date(isoDate).getTime();
  return ms / (1000 * 60 * 60 * 24);
}

function getSlaWindow(status) {
  return STATUS_SLA[status] ?? STAGE_SLA_DAYS;
}

function buildEscalationEmail(complaint, slaDays, daysElapsed, supervisorName) {
  return `
Dear ${supervisorName || "Management"},

This is an automated SLA breach alert from Orient Paper & Mill CCMS.

Complaint     : ${complaint.complaintNo}
Title         : ${complaint.title}
Customer      : ${complaint.customerName || complaint.customerId}
Current Stage : ${complaint.status}
SLA Window    : ${slaDays} day(s)
Days Elapsed  : ${daysElapsed.toFixed(1)} day(s)
Overdue By    : ${(daysElapsed - slaDays).toFixed(1)} day(s)

Immediate action is required. Please ensure the responsible team moves 
this complaint forward or provides a valid reason for delay.

Orient Paper & Mill CCMS — Automated SLA Monitor
  `.trim();
}

// ── Core SLA check function ───────────────────────────────────────────────
async function runSlaCheck() {
  const now = new Date().toISOString();
  console.log(`\n⏱  [SLA ENGINE] Running check at ${now}`);

  const allComplaints = complaintStore.getAll();
  let breachCount = 0;
  let autoClosedCount = 0;

  for (const complaint of allComplaints) {
    // Skip terminal/side states
    if (SKIP_STATUSES.has(complaint.status)) continue;

    const daysInStage = daysSince(complaint.updatedAt);

    // ── Auto-close for long-stale Clarification_Sought ─────────────────
    if (complaint.status === "Clarification_Sought") {
      if (daysInStage >= CLARIFY_SLA_DAYS) {
        complaintStore.update(complaint.complaintNo, { status: "Auto_Closed" });

        audit.log({
          complaintNo: complaint.complaintNo,
          fromStatus:  "Clarification_Sought",
          toStatus:    "Auto_Closed",
          action:      "Auto Close",
          actorType:   "System",
          actorId:     "SLA_ENGINE",
          actorRole:   "System",
          remarks:     `Auto-closed: no customer response in ${CLARIFY_SLA_DAYS} days (SLA breach).`,
        });

        logBreach({
          complaintNo:  complaint.complaintNo,
          status:       "Clarification_Sought",
          action:       "auto_closed",
          slaDays:      CLARIFY_SLA_DAYS,
          daysElapsed:  daysInStage,
        });

        // Notify stakeholders of auto-closure
        await notify.sendNotification({
          complaint:  { ...complaint, status: "Clarification_Sought" },
          newStatus:  "Auto_Closed",
          actorUser:  null,
          remarks:    `Auto-closed by SLA engine after ${CLARIFY_SLA_DAYS} days with no customer response.`,
        }).catch(() => {});

        autoClosedCount++;
        console.log(`   🔴 AUTO-CLOSED: ${complaint.complaintNo} (Clarification_Sought ${daysInStage.toFixed(1)}d)`);
      }
      continue;
    }

    // ── Stage SLA breach check ─────────────────────────────────────────
    const slaDays = getSlaWindow(complaint.status);
    if (daysInStage < slaDays) continue; // Within SLA — no action needed

    // Check if we already logged a breach for this complaint + status combo
    const alreadyLogged = slaBreaches.some(
      (b) => b.complaintNo === complaint.complaintNo &&
             b.status      === complaint.status &&
             b.action      === "breach_notified"
    );
    if (alreadyLogged) continue; // Don't spam repeated breach notifications

    // Log the breach
    logBreach({
      complaintNo:  complaint.complaintNo,
      status:       complaint.status,
      action:       "breach_notified",
      slaDays,
      daysElapsed:  daysInStage,
      overdueBy:    daysInStage - slaDays,
    });

    // Audit trail entry
    audit.log({
      complaintNo: complaint.complaintNo,
      fromStatus:  complaint.status,
      toStatus:    complaint.status, // status doesn't change — just flagged
      action:      "SLA Breach Flagged",
      actorType:   "System",
      actorId:     "SLA_ENGINE",
      actorRole:   "System",
      remarks:     `SLA breached: ${daysInStage.toFixed(1)} days in ${complaint.status} (limit: ${slaDays} days). Escalation notification sent.`,
    });

    // Mark complaint as SLA-breached
    complaintStore.update(complaint.complaintNo, {
      slaBreached:       true,
      slaBreachedAt:     now,
      slaBreachedStatus: complaint.status,
    });

    // Find supervisor to escalate to
    const supervisorRoleName = ESCALATION_MAP[complaint.status];
    const supervisorRole = md.roles.find((r) => r.roleName === supervisorRoleName);
    const supervisors = supervisorRole
      ? md.users.filter((u) => u.roleId === supervisorRole.roleId && u.active)
      : [];

    const emailBody = buildEscalationEmail(complaint, slaDays, daysInStage,
      supervisors[0]?.name || supervisorRoleName);

    // Send escalation notification
    if (supervisors.length > 0) {
      await notify.sendNotification({
        complaint,
        newStatus: `SLA_BREACH_${complaint.status}`,
        actorUser: null,
        remarks:   emailBody,
      }).catch(() => {});

      // Also log directly since the status key won't match the matrix
      const { getAllNotifications } = notify;
      console.log(`   🟡 SLA BREACH: ${complaint.complaintNo} at ${complaint.status} — ${daysInStage.toFixed(1)}d / ${slaDays}d limit — escalating to ${supervisorRoleName}`);
    }

    breachCount++;
  }

  console.log(`   ✅ SLA check complete — ${allComplaints.length} complaints checked, ${breachCount} breach(es) flagged, ${autoClosedCount} auto-closed\n`);

  return { checked: allComplaints.length, breaches: breachCount, autoClosed: autoClosedCount };
}

// ── Manual trigger endpoint data ──────────────────────────────────────────
async function triggerManualCheck() {
  return runSlaCheck();
}

// ── Start the engine ──────────────────────────────────────────────────────
let slaInterval = null;

function startSlaEngine() {
  if (!SLA_ENABLED) {
    console.log("⏱  [SLA ENGINE] Disabled (SLA_ENABLED=false)");
    return;
  }

  const tickMs = TICK_MINUTES * 60 * 1000;
  console.log(`⏱  [SLA ENGINE] Started — checking every ${TICK_MINUTES} minute(s)`);
  console.log(`   Stage SLA    : ${STAGE_SLA_DAYS} days`);
  console.log(`   Sample SLA   : ${SAMPLE_SLA_DAYS} days`);
  console.log(`   Clarify SLA  : ${CLARIFY_SLA_DAYS} days (auto-close)`);

  // Run once immediately on startup, then on interval
  runSlaCheck().catch(console.error);
  slaInterval = setInterval(() => runSlaCheck().catch(console.error), tickMs);
}

function stopSlaEngine() {
  if (slaInterval) clearInterval(slaInterval);
}

module.exports = {
  startSlaEngine,
  stopSlaEngine,
  triggerManualCheck,
  getAllBreaches,
  getBreachesForComplaint,
  runSlaCheck,
  STATUS_SLA,
  ESCALATION_MAP,
};
