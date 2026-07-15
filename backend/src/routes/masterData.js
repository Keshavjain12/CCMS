// =========================================================================
// MASTER DATA ROUTES  —  /api/master-data
// =========================================================================
const express = require("express");
const router = express.Router();
const masterData = require("../data/masterData");
const sap = require("../services/sapService");
const audit = require("../data/auditLog");
const { requireRoles } = require("../middleware/auth");

// ── GET /api/master-data/invoice/:invoiceNo ──────────────────────────────
// Real-time invoice lookup from SAP (or mock).
router.get("/invoice/:invoiceNo", async (req, res) => {
  try {
    const invoice = await sap.getInvoice(req.params.invoiceNo);
    res.json({ source: sap.USE_MOCK ? "MOCK" : "SAP", data: invoice });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ── POST /api/master-data/sap-sync ──────────────────────────────────────
// Trigger the nightly batch master data sync manually. Admin only — this is a
// privileged, write-heavy integration action, not something any authenticated
// user should be able to kick off.
router.post("/sap-sync", requireRoles(["R000"]), async (req, res) => {
  try {
    const result = await sap.runMasterDataBatchSync();
    await audit.log({
      complaintNo: "SYSTEM",
      action:      "SAP Master Data Batch Sync",
      actorType:   "System",
      actorId:     req.user.userId,
      actorRole:   req.user.roleName,
      remarks:     JSON.stringify(result.synced),
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/master-data/policy-check ───────────────────────────────────
// Check if a complaint would comply with the applicable Sales Policy.
// Query params: businessLine, customerSegment, invoiceDate, settlementValue, invoiceValue
router.get("/policy-check", async (req, res) => {
  const { businessLine, customerSegment, invoiceDate, settlementValue, invoiceValue } = req.query;
  if (!businessLine || !customerSegment || !invoiceDate || !settlementValue || !invoiceValue) {
    return res.status(400).json({ error: "Required: businessLine, customerSegment, invoiceDate, settlementValue, invoiceValue" });
  }
  const policy = masterData.findApplicablePolicy(businessLine, customerSegment);
  const result = masterData.checkPolicyCompliance(
    policy,
    invoiceDate,
    parseFloat(settlementValue),
    parseFloat(invoiceValue)
  );
  res.json({ policy: policy || "No policy found", compliance: result });
});

// ── GET /api/master-data/:entity ─────────────────────────────────────────
// Supported entities: customers, users, roles, departments, products,
//                     complaintTypes, sampleTypes, salesPolicies
// NOTE: This wildcard route must stay LAST — Express matches routes in
// registration order, and "/:entity" would otherwise swallow requests meant
// for /invoice/:invoiceNo, /sap-sync, and /policy-check above.
router.get("/:entity", async (req, res) => {
  const map = {
    customers:      masterData.customers,
    // Never expose password hashes over the API (Section 12.6).
    users:          masterData.users.map(({ password, ...safe }) => safe),
    roles:          masterData.roles,
    departments:    masterData.departments,
    products:       masterData.products,
    complaintTypes: masterData.complaintTypes,
    sampleTypes:    masterData.sampleTypes,
    salesPolicies:  masterData.salesPolicies,
  };

  const entity = req.params.entity;
  if (!map[entity]) {
    return res.status(404).json({
      error: `Unknown master data entity: '${entity}'`,
      available: Object.keys(map),
    });
  }

  res.json({
    entity,
    count: map[entity].length,
    data: map[entity],
  });
});

module.exports = router;
