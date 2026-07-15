// =========================================================================
// KPI DASHBOARD SERVICE  —  Orient Paper & Mill CCMS
// Section 12.4 — KPI Dashboard
//
// Calculates all live KPIs from the in-memory complaint store.
// No caching — every GET /api/kpi returns fresh numbers.
//
// KPIs provided:
//  1. Complaint Volume        — total, open, closed, today
//  2. Status Distribution     — count per status (pipeline view)
//  3. Average Resolution Time — overall + per business line
//  4. Stage Cycle Times       — avg days spent per stage (from audit log)
//  5. Settlement Analytics    — total value, avg, by business line, by month
//  6. SLA Compliance Rate     — % complaints resolved within total SLA window
//  7. Rejection / Clarify Rate — how often complaints get sent back
//  8. Repeat Complaint Flag   — same customer + product + type within 90 days
//  9. Top Customers by Volume — which customers raise the most complaints
// 10. SAP Integration Health  — credit note issuance rate
// =========================================================================

const { complaintStore } = require("../data/transactionalStore");
const audit              = require("../data/auditLog");
const sla                = require("./slaEngine");
const md                 = require("../data/masterData");
const workflow           = require("./workflowService");

// ── Helpers ───────────────────────────────────────────────────────────────
function daysBetween(d1, d2) {
  return (new Date(d2) - new Date(d1)) / (1000 * 60 * 60 * 24);
}

function isToday(isoDate) {
  const d = new Date(isoDate);
  const now = new Date();
  return d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
}

function isThisMonth(isoDate) {
  const d = new Date(isoDate);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function monthKey(isoDate) {
  const d = new Date(isoDate);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const TERMINAL = new Set(["Closed", "Auto_Closed"]);
const NEGATIVE_ACTIONS = new Set(["Reject", "Clarify"]);

// ── Main KPI Calculator ───────────────────────────────────────────────────
async function computeKPIs() {
  const all       = await complaintStore.getAll();
  const auditAll  = await audit.getAll();
  const breaches  = sla.getAllBreaches();
  const now       = new Date().toISOString();

  // ── 1. Complaint Volume ────────────────────────────────────────────────
  const total       = all.length;
  const open        = all.filter((c) => !TERMINAL.has(c.status)).length;
  const closed      = all.filter((c) => c.status === "Closed").length;
  const autoClosed  = all.filter((c) => c.status === "Auto_Closed").length;
  const today       = all.filter((c) => isToday(c.createdAt)).length;
  const thisMonth   = all.filter((c) => isThisMonth(c.createdAt)).length;

  // ── 2. Status Distribution ─────────────────────────────────────────────
  const statusDist = {};
  for (const c of all) {
    statusDist[c.status] = (statusDist[c.status] || 0) + 1;
  }
  const pipeline = Object.entries(statusDist)
    .map(([status, count]) => ({ status, count, pct: total ? +((count / total) * 100).toFixed(1) : 0 }))
    .sort((a, b) => b.count - a.count);

  // ── 3. Average Resolution Time ─────────────────────────────────────────
  const resolvedComplaints = all.filter((c) => c.status === "Closed" && c.closedAt);
  const resolutionTimes    = resolvedComplaints.map((c) => daysBetween(c.createdAt, c.closedAt));

  const avgResolutionDays = resolutionTimes.length
    ? +(resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length).toFixed(1)
    : null;

  const minResolutionDays = resolutionTimes.length ? +Math.min(...resolutionTimes).toFixed(1) : null;
  const maxResolutionDays = resolutionTimes.length ? +Math.max(...resolutionTimes).toFixed(1) : null;

  // By business line
  const byLine = {};
  for (const c of resolvedComplaints) {
    const line = c.businessLine || "Unknown";
    if (!byLine[line]) byLine[line] = [];
    byLine[line].push(daysBetween(c.createdAt, c.closedAt));
  }
  const avgResolutionByLine = Object.fromEntries(
    Object.entries(byLine).map(([line, times]) => [
      line,
      +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1),
    ])
  );

  // ── 4. Stage Cycle Times (from audit log) ──────────────────────────────
  // Group audit entries by complaintNo, then for each transition measure time
  const stageTimesMap = {};
  const auditByComplaint = {};
  for (const entry of auditAll) {
    if (!entry.complaintNo || entry.complaintNo === "SYSTEM") continue;
    if (!auditByComplaint[entry.complaintNo]) auditByComplaint[entry.complaintNo] = [];
    auditByComplaint[entry.complaintNo].push(entry);
  }

  for (const [no, entries] of Object.entries(auditByComplaint)) {
    const sorted = entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (!prev.toStatus || !curr.timestamp || !prev.timestamp) continue;
      const days = daysBetween(prev.timestamp, curr.timestamp);
      if (!stageTimesMap[prev.toStatus]) stageTimesMap[prev.toStatus] = [];
      stageTimesMap[prev.toStatus].push(days);
    }
  }

  const stageCycleTimes = Object.fromEntries(
    Object.entries(stageTimesMap).map(([stage, times]) => [
      stage,
      { avgDays: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2), samples: times.length },
    ])
  );

  // ── 5. Settlement Analytics ────────────────────────────────────────────
  const withSettlement = all.filter((c) => c.settlementValue > 0);
  const totalSettlement = withSettlement.reduce((s, c) => s + c.settlementValue, 0);
  const avgSettlement   = withSettlement.length ? +(totalSettlement / withSettlement.length).toFixed(0) : 0;

  // By business line
  const settlByLine = {};
  for (const c of withSettlement) {
    const line = c.businessLine || "Unknown";
    if (!settlByLine[line]) settlByLine[line] = { count: 0, total: 0 };
    settlByLine[line].count++;
    settlByLine[line].total += c.settlementValue;
  }
  const settlementByLine = Object.fromEntries(
    Object.entries(settlByLine).map(([line, d]) => [
      line, { count: d.count, totalValue: d.total, avgValue: +(d.total / d.count).toFixed(0) },
    ])
  );

  // By month
  const settlByMonth = {};
  for (const c of withSettlement) {
    const mk = monthKey(c.createdAt);
    if (!settlByMonth[mk]) settlByMonth[mk] = { count: 0, total: 0 };
    settlByMonth[mk].count++;
    settlByMonth[mk].total += c.settlementValue;
  }
  const settlementByMonth = Object.fromEntries(
    Object.entries(settlByMonth).sort(([a], [b]) => a.localeCompare(b))
  );

  // MD Approval triggered (high-value / policy breach)
  // Derived from the same workflow gate logic used by the engine — these flags
  // are not stored on the complaint, so compute them live here.
  const mdApprovalTriggered = all.filter((c) => workflow.requiresMdApproval(c)).length;
  const visitTriggered       = all.filter((c) => workflow.requiresVisit(c)).length;

  // ── 6. SLA Compliance Rate ─────────────────────────────────────────────
  const totalSLADays = parseInt(process.env.STAGE_SLA_DAYS || "3") * 11; // 11 stages × default SLA
  const withinSLA    = resolvedComplaints.filter((c) => daysBetween(c.createdAt, c.closedAt) <= totalSLADays).length;
  const slaComplianceRate = resolvedComplaints.length
    ? +((withinSLA / resolvedComplaints.length) * 100).toFixed(1)
    : null;

  const totalBreaches     = breaches.length;
  const uniqueBreached    = new Set(breaches.map((b) => b.complaintNo)).size;

  // ── 7. Rejection & Clarify Rate ───────────────────────────────────────
  const rejectEvents  = auditAll.filter((e) => e.action === "Reject").length;
  const clarifyEvents = auditAll.filter((e) => e.action === "Clarify").length;
  const totalActions  = auditAll.filter((e) => e.actorType === "User").length;

  const rejectionRate = totalActions ? +((rejectEvents / totalActions) * 100).toFixed(1) : 0;
  const clarifyRate   = totalActions ? +((clarifyEvents / totalActions) * 100).toFixed(1) : 0;

  // ── 8. Repeat Complaint Detection ─────────────────────────────────────
  const REPEAT_WINDOW_DAYS = 90;
  const repeatFlags = [];
  const sorted = [...all].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]; const b = sorted[j];
      if (daysBetween(a.createdAt, b.createdAt) > REPEAT_WINDOW_DAYS) break;
      if (a.customerId === b.customerId) {
        repeatFlags.push({
          originalComplaint: a.complaintNo,
          repeatComplaint:   b.complaintNo,
          customerId:        a.customerId,
          daysBetween:       +daysBetween(a.createdAt, b.createdAt).toFixed(1),
          note:              `Same customer filed again within ${REPEAT_WINDOW_DAYS} days — verify CAPA effectiveness`,
        });
      }
    }
  }

  // ── 9. Top Customers by Volume ─────────────────────────────────────────
  const custVolume = {};
  for (const c of all) {
    const key = c.customerId || "Unknown";
    if (!custVolume[key]) custVolume[key] = { customerId: key, count: 0, totalSettlement: 0 };
    custVolume[key].count++;
    custVolume[key].totalSettlement += c.settlementValue || 0;
  }
  const topCustomers = Object.values(custVolume)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((c) => {
      const customer = md.findCustomer(c.customerId.replace("CUST-", ""));
      return { ...c, customerName: customer ? customer.name : c.customerId };
    });

  // ── 10. SAP Integration Health ─────────────────────────────────────────
  const withCreditNote    = all.filter((c) => c.creditNoteNumber).length;
  const creditNoteRate    = closed ? +((withCreditNote / closed) * 100).toFixed(1) : null;
  const pendingSAPValidation = all.filter((c) => c.sapValidationPending).length;

  // ── Final KPI object ───────────────────────────────────────────────────
  return {
    generatedAt: now,
    summary: {
      total, open, closed, autoClosed, today, thisMonth,
      closureRate: total ? +((closed / total) * 100).toFixed(1) : 0,
    },
    pipeline,
    resolutionTime: {
      avgDays: avgResolutionDays,
      minDays: minResolutionDays,
      maxDays: maxResolutionDays,
      basedOn: resolvedComplaints.length,
      byBusinessLine: avgResolutionByLine,
    },
    stageCycleTimes,
    settlement: {
      totalValue:       totalSettlement,
      avgValue:         avgSettlement,
      mdApprovalTriggered,
      visitTriggered,
      byBusinessLine:   settlementByLine,
      byMonth:          settlementByMonth,
    },
    slaCompliance: {
      complianceRate:   slaComplianceRate,
      withinSLA,
      totalResolved:    resolvedComplaints.length,
      totalBreaches,
      uniqueComplaintsBreached: uniqueBreached,
    },
    quality: {
      rejectionRate,
      clarifyRate,
      rejectEvents,
      clarifyEvents,
      totalActions,
      repeatComplaints: repeatFlags,
    },
    topCustomers,
    sapHealth: {
      creditNoteIssuanceRate: creditNoteRate,
      closedWithCreditNote:   withCreditNote,
      totalClosed:            closed,
      pendingSAPValidation,
    },
  };
}

module.exports = { computeKPIs };
