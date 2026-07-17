



















const { complaintStore } = require("../data/transactionalStore");
const audit              = require("../data/auditLog");
const sla                = require("./slaEngine");
const md                 = require("../data/masterData");
const workflow           = require("./workflowService");
const visibility         = require("./visibility");
const sap                = require("./sapService");


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







const KPI_CACHE_MS = parseInt(process.env.KPI_CACHE_MS || "10000", 10);
const kpiCache = new Map();

async function computeKPIs(user) {
  const key = user && user.userId;
  if (KPI_CACHE_MS > 0 && key) {
    const hit = kpiCache.get(key);
    if (hit && Date.now() - hit.at < KPI_CACHE_MS) return hit.data;
  }
  const data = await computeFresh(user);
  if (KPI_CACHE_MS > 0 && key) kpiCache.set(key, { at: Date.now(), data });
  return data;
}



async function computeFresh(user) {
  const everything = await complaintStore.getAll();
  const all        = await visibility.filterVisible(user, everything);



  const visibleNos = new Set(all.map((c) => c.complaintNo));
  const auditEvery = await audit.getAll();
  const auditAll   = auditEvery.filter((e) => !e.complaintNo || visibleNos.has(e.complaintNo));

  const breaches   = (sla.getAllBreaches() || []).filter(
    (b) => !b.complaintNo || visibleNos.has(b.complaintNo)
  );
  const now        = new Date().toISOString();


  const total       = all.length;
  const open        = all.filter((c) => !TERMINAL.has(c.status)).length;
  const closed      = all.filter((c) => c.status === "Closed").length;
  const autoClosed  = all.filter((c) => c.status === "Auto_Closed").length;
  const today       = all.filter((c) => isToday(c.createdAt)).length;
  const thisMonth   = all.filter((c) => isThisMonth(c.createdAt)).length;


  const statusDist = {};
  for (const c of all) {
    statusDist[c.status] = (statusDist[c.status] || 0) + 1;
  }
  const pipeline = Object.entries(statusDist)
    .map(([status, count]) => ({ status, count, pct: total ? +((count / total) * 100).toFixed(1) : 0 }))
    .sort((a, b) => b.count - a.count);


  const resolvedComplaints = all.filter((c) => c.status === "Closed" && c.closedAt);
  const resolutionTimes    = resolvedComplaints.map((c) => daysBetween(c.createdAt, c.closedAt));

  const avgResolutionDays = resolutionTimes.length
    ? +(resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length).toFixed(1)
    : null;

  const minResolutionDays = resolutionTimes.length ? +Math.min(...resolutionTimes).toFixed(1) : null;
  const maxResolutionDays = resolutionTimes.length ? +Math.max(...resolutionTimes).toFixed(1) : null;


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


  const withSettlement = all.filter((c) => c.settlementValue > 0);
  const totalSettlement = withSettlement.reduce((s, c) => s + c.settlementValue, 0);
  const avgSettlement   = withSettlement.length ? +(totalSettlement / withSettlement.length).toFixed(0) : 0;


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




  const mdApprovalTriggered = all.filter((c) => workflow.requiresMdApproval(c)).length;
  const visitTriggered       = all.filter((c) => workflow.requiresVisit(c)).length;


  const totalSLADays = parseInt(process.env.STAGE_SLA_DAYS || "3") * 11;
  const withinSLA    = resolvedComplaints.filter((c) => daysBetween(c.createdAt, c.closedAt) <= totalSLADays).length;
  const slaComplianceRate = resolvedComplaints.length
    ? +((withinSLA / resolvedComplaints.length) * 100).toFixed(1)
    : null;

  const totalBreaches     = breaches.length;
  const uniqueBreached    = new Set(breaches.map((b) => b.complaintNo)).size;


  const rejectEvents  = auditAll.filter((e) => e.action === "Reject").length;
  const clarifyEvents = auditAll.filter((e) => e.action === "Clarify").length;
  const totalActions  = auditAll.filter((e) => e.actorType === "User").length;

  const rejectionRate = totalActions ? +((rejectEvents / totalActions) * 100).toFixed(1) : 0;
  const clarifyRate   = totalActions ? +((clarifyEvents / totalActions) * 100).toFixed(1) : 0;







  const REPEAT_WINDOW_DAYS = 90;
  const repeatFlags = [];
  const byCustomerForRepeat = {};
  for (const c of all) {
    const key = c.customerId || "Unknown";
    (byCustomerForRepeat[key] = byCustomerForRepeat[key] || []).push(c);
  }
  for (const [custId, list] of Object.entries(byCustomerForRepeat)) {
    if (list.length < 2) continue;
    const sorted = list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const gap = daysBetween(sorted[i].createdAt, sorted[j].createdAt);
        if (gap > REPEAT_WINDOW_DAYS) break;
        repeatFlags.push({
          originalComplaint: sorted[i].complaintNo,
          repeatComplaint:   sorted[j].complaintNo,
          customerId:        custId,
          daysBetween:       +gap.toFixed(1),
          note:              `Same customer filed again within ${REPEAT_WINDOW_DAYS} days — verify CAPA effectiveness`,
        });
      }
    }
  }


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


  const withCreditNote    = all.filter((c) => c.creditNoteNumber).length;
  const creditNoteRate    = closed ? +((withCreditNote / closed) * 100).toFixed(1) : null;
  const pendingSAPValidation = all.filter((c) => c.sapValidationPending).length;


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
      mode:                   sap.USE_MOCK ? "MOCK" : "LIVE SAP",
      creditNoteIssuanceRate: creditNoteRate,
      closedWithCreditNote:   withCreditNote,
      totalClosed:            closed,
      pendingSAPValidation,
    },
  };
}

module.exports = { computeKPIs };
