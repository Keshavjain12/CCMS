const router = require("../utils/asyncRoute").safeRouter();
const masterData = require("../data/masterData");
const sap = require("../services/sapService");
const audit = require("../data/auditLog");
const { requireRoles } = require("../middleware/auth");

router.get("/invoice/:invoiceNo", async (req, res) => {
  try {
    const invoice = await sap.getInvoice(req.params.invoiceNo);
    res.json({ source: sap.USE_MOCK ? "MOCK" : "SAP", data: invoice });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.get("/customer/:customerId/invoices", (req, res) => {
  const { customerId } = req.params;
  const list = Object.values(masterData.invoices)
    .filter((inv) => inv.SoldToParty === customerId)
    .map((inv) => ({
      invoiceNumber: inv.BillingDocument,
      invoiceDate:   inv.BillingDocumentDate,
      netAmount:     inv.NetAmount,
      currency:      inv.TransactionCurrency,
      itemCount:     (inv.lineItems || []).length,
    }))
    .sort((a, b) => String(a.invoiceNumber).localeCompare(String(b.invoiceNumber)));
  res.json({ customerId, count: list.length, invoices: list });
});

router.post("/sap-sync", requireRoles(["R000"]), async (req, res, next) => {
  try {
    const result = await sap.runMasterDataBatchSync();

    await masterData.reload();
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
    next(err);
  }
});

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

router.get("/:entity", async (req, res) => {
  const map = {
    customers:      masterData.customers,

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
