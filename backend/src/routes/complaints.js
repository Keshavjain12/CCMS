// =========================================================================
// COMPLAINT ROUTES  —  /api/complaints
// =========================================================================
// Full complaint transaction lifecycle:
//   Stage 1  → Create (invoice lookup from SAP + policy check + line items)
//   Stage 2  → TS Review
//   Stage 3  → QC Review + Sample gate
//   Stage 4  → CAPA + Ops Head Approval
//   Stage 5  → Marketing Review
//   Stage 6  → Marketing Head Approval (+ policy compliance display)
//   Stage 7  → MD Approval (conditional — settlement > 1L or policy breach)
//   [Visit]  → Customer Visit (conditional — key account or high value)
//   Stage 8  → Finance: SAP Credit Note push → Closed
// =========================================================================

const express = require("express");
const router = express.Router();
const {
  complaintStore,
  lineItemStore,
  attachmentStore,
  sampleStore,
  visitStore,
  capaStore,
  creditNoteStore,
  SAMPLE_STATUSES,
} = require("../data/transactionalStore");
const masterData = require("../data/masterData");
const sap = require("../services/sapService");
const workflow = require("../services/workflowService");
const audit = require("../data/auditLog");
const { requireRoles, canActOnStatus } = require("../middleware/auth");
const rollout = require("../config/rollout");
const notify = require("../services/notificationService");
const { paginate } = require("../utils/pagination");

// ─── HELPERS ─────────────────────────────────────────────────────────────

/** Enrich a complaint with its related records for a full-picture response. */
function enrich(complaint) {
  if (!complaint) return null;
  return {
    ...complaint,
    lineItems:  lineItemStore.getForComplaint(complaint.complaintNo),
    attachments: attachmentStore.getForComplaint(complaint.complaintNo),
    samples:    sampleStore.getForComplaint(complaint.complaintNo),
    visits:     visitStore.getForComplaint(complaint.complaintNo),
    capas:      capaStore.getForComplaint(complaint.complaintNo),
    creditNotes: creditNoteStore.getForComplaint(complaint.complaintNo),
    statusSequence: workflow.getEffectiveSequence(complaint),
  };
}

// =========================================================================
// READ SCOPING (Section 12.3 — least privilege on reads)
// -------------------------------------------------------------------------
// A junior role must not be able to read settlement values / customer data /
// MD approvals for the ENTIRE company. A complaint is visible to a user when:
//   • they are Admin (R000) or the Managing Director (R009) — full oversight;
//   • they reported/created it;
//   • it is currently in their role's action queue (their role may act on the
//     current status — or its prior status when parked in Clarification_Sought);
//   • they have personally acted on it at some point (per the audit trail,
//     whose actorId is now stamped from the JWT, so it can't be spoofed).
// The backend is the enforcer here; the frontend filters are only cosmetic.
// =========================================================================
function visibleToUser(user, complaint) {
  if (!complaint) return false;
  if (user.isAdmin || user.roleId === "R009") return true;
  if (complaint.reportedBy && complaint.reportedBy === user.userId) return true;
  if (canActOnStatus(user, complaint.status, null, complaint._priorStatus).allowed) return true;
  return audit.getForComplaint(complaint.complaintNo).some((e) => e.actorId === user.userId);
}

function denyIfHidden(req, res, complaint) {
  if (visibleToUser(req.user, complaint)) return false;
  res.status(403).json({ error: "You are not authorised to view this complaint." });
  return true;
}

// =========================================================================
// STAGE 1 — CREATE COMPLAINT
// POST /api/complaints
// =========================================================================
// 1a. Accepts invoice number → pulls invoice + line item data from SAP.
// 1b. Looks up customer master from SAP.
// 1c. Identifies applicable Sales Policy; checks complaint window.
// 1d. Creates complaint record + line items with auto-computed defective values.
// 1e. Determines sampleRequired flag from complaint types selected.
// =========================================================================
router.post("/", async (req, res) => {
  try {
    const {
      invoiceNumber,
      title,
      remarks,
      lineItemsInput = [],  // [{invoiceItemNo, sapMaterialNo, defectiveQty, complaintTypeId}]
      attachmentsInput = [], // [{fileReference, fileType, description}]
      reportedBy,           // userId of reporter
    } = req.body;

    if (!invoiceNumber) return res.status(400).json({ error: "invoiceNumber is required" });
    if (!lineItemsInput.length) return res.status(400).json({ error: "At least one line item (affected product) is required" });

    // ── 1a. Invoice lookup from SAP (real-time) ──────────────────────
    let invoice;
    let sapFallback = false;
    try {
      invoice = await sap.getInvoice(invoiceNumber);
    } catch (sapErr) {
      // Section 11.2: fallback — allow complaint creation with Pending SAP Validation
      sapFallback = true;
      invoice = {
        BillingDocument:     invoiceNumber,
        BillingDocumentDate: req.body.invoiceDate || new Date().toISOString().slice(0, 10),
        SoldToParty:         req.body.customerId || "UNKNOWN",
        NetAmount:           "0.00",
        TransactionCurrency: "INR",
        lineItems:           [],
      };
    }

    // ── 1b. Customer master lookup ───────────────────────────────────
    let customerRecord;
    let customerSapData;
    try {
      customerSapData = await sap.getCustomerMaster(invoice.SoldToParty);
      customerRecord  = masterData.findCustomer(invoice.SoldToParty) || {
        customerId:    invoice.SoldToParty,
        name:          customerSapData.BusinessPartnerFullName,
        segment:       customerSapData.segment || "Customer-Standard",
        isKeyAccount:  customerSapData.isKeyAccount || false,
        businessLine:  "Paper",
      };
    } catch (custErr) {
      customerRecord = {
        customerId:   invoice.SoldToParty,
        name:         "Unknown Customer",
        segment:      "Customer-Standard",
        isKeyAccount: false,
        businessLine: "Paper",
      };
    }

    // ── 1c. Sales Policy check (Section 9.2) ─────────────────────────
    // Identify business line from first line item's product
    const firstItem = lineItemsInput[0];
    const productInfo = firstItem.sapMaterialNo
      ? masterData.findProduct(firstItem.sapMaterialNo)
      : null;
    const businessLine = productInfo?.businessLine || customerRecord.businessLine || "Paper";

    const policy = masterData.findApplicablePolicy(businessLine, customerRecord.segment);

    // Compute total settlement value (sum of all defective values)
    // We need unit prices from invoice line items
    const invoiceItemMap = {};
    (invoice.lineItems || []).forEach((li) => {
      invoiceItemMap[li.BillingDocumentItem] = li;
    });

    let totalDefectiveValue = 0;
    let anyLineItemSampleRequired = false;
    const invalidItems = [];

    const createdLineItems = lineItemsInput.map((input) => {
      const invItem = invoiceItemMap[input.invoiceItemNo];

      // ── PRICE-TAMPERING GUARD (Section 12.6) ───────────────────────
      // When we have a validated SAP invoice, unitPrice and invoiceQty are
      // taken STRICTLY from SAP — never from the request body. A line item
      // that references an invoice item not present on the real invoice is
      // rejected, so a caller cannot invent a product or inflate a price by
      // editing the HTTP payload. Client-supplied money figures are only
      // trusted in the SAP-down fallback path (complaint is flagged
      // "pending validation" per Section 11.2).
      let unitPrice, invoiceQty, source;
      if (!sapFallback) {
        if (!invItem) { invalidItems.push(input.invoiceItemNo || "(missing invoiceItemNo)"); return null; }
        unitPrice  = parseFloat(invItem.NetPriceAmount || 0);
        invoiceQty = parseFloat(invItem.BillingQuantity || 0);
        source     = invItem;
      } else {
        unitPrice  = parseFloat(input.unitPrice  || 0);
        invoiceQty = parseFloat(input.invoiceQty || 0);
        source     = {};
      }

      const defectiveQty = parseFloat(input.defectiveQty || 0);
      const defectiveValue = +(unitPrice * defectiveQty).toFixed(2);

      totalDefectiveValue += defectiveValue;

      const cType = masterData.findComplaintType(input.complaintTypeId);
      if (cType?.sampleRequired) anyLineItemSampleRequired = true;

      return {
        invoiceNumber:    invoiceNumber,
        invoiceItemNo:    input.invoiceItemNo || source.BillingDocumentItem,
        // Prefer SAP-authoritative descriptors over anything the client sent.
        sapMaterialNo:    source.Material            || input.sapMaterialNo,
        productName:      source.MaterialDescription || input.productName,
        invoiceQty,
        unitPrice,
        defectiveQty,
        uom:              source.BillingQuantityUnit || input.uom || "Ream",
        complaintTypeId:  input.complaintTypeId,
        complaintTypeName: cType?.typeName,
        sampleRequired:   cType?.sampleRequired || false,
      };
    });

    if (invalidItems.length) {
      return res.status(400).json({
        error: `One or more line items do not match SAP invoice ${invoiceNumber}. ` +
               `Prices and quantities are taken from SAP, so only items on the invoice can be claimed.`,
        invalidInvoiceItemNos: invalidItems,
      });
    }

    // Policy compliance check
    const policyResult = masterData.checkPolicyCompliance(
      policy,
      invoice.BillingDocumentDate,
      totalDefectiveValue,
      parseFloat(invoice.NetAmount)
    );

    // ── 1d. Create complaint ──────────────────────────────────────────
    const complaint = complaintStore.create({
      title:                title || `Complaint for Invoice ${invoiceNumber}`,
      remarks:              remarks || "",
      invoiceNumber:        invoice.BillingDocument,
      invoiceDate:          invoice.BillingDocumentDate,
      invoiceValue:         parseFloat(invoice.NetAmount),
      currency:             invoice.TransactionCurrency,
      customerId:           customerRecord.customerId,
      customerName:         customerRecord.name,
      customerSegment:      customerRecord.segment,
      isKeyAccount:         customerRecord.isKeyAccount,
      businessLine,
      settlementValue:      totalDefectiveValue,
      policyId:             policy?.policyId || null,
      policyFlag:           policyResult.flag,
      policyCompliance:     policyResult.compliant ? "Within Policy" : "Breach",
      policyClauseBreached: policyResult.clauseBreached || null,
      policyForcesMdApproval: policyResult.forcesMdApproval || false,
      sampleRequired:       anyLineItemSampleRequired,
      // Attribution comes from the authenticated JWT, not the request body.
      reportedBy:           req.user.userId,
      _customer:            customerRecord,
      _sapFallback:         sapFallback,
    });

    // ── 1e. Persist line items ─────────────────────────────────────────
    createdLineItems.forEach((li) => {
      lineItemStore.create({ complaintNo: complaint.complaintNo, ...li });
    });

    // Persist attachments at creation (Stage 1 photos/videos)
    (attachmentsInput || []).forEach((att) => {
      attachmentStore.create({ complaintNo: complaint.complaintNo, ...att, uploadedBy: reportedBy });
    });

    // ── Audit log ─────────────────────────────────────────────────────
    audit.log({
      complaintNo: complaint.complaintNo,
      fromStatus:  null,
      toStatus:    "Logged",
      action:      "Complaint Created",
      actorType:   "User",
      actorId:     req.user.userId,
      actorRole:   req.user.roleName,
      remarks:     sapFallback ? "SAP invoice lookup failed — pending validation" : "Invoice and customer data fetched from SAP",
    });

    if (!policyResult.compliant) {
      audit.log({
        complaintNo: complaint.complaintNo,
        action:      `Policy Flag: ${policyResult.clauseBreached}`,
        actorType:   "System",
        actorId:     "SYSTEM",
        actorRole:   "Policy Engine",
      });
    }

    res.status(201).json({
      success:     true,
      complaint:   enrich(complaint),
      policyAlert: policyResult.compliant ? null : policyResult,
      warnings:    sapFallback ? ["SAP invoice lookup failed — complaint created with manual data, pending validation"] : [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// LIST COMPLAINTS
// GET /api/complaints?status=&customerId=&businessLine=
// =========================================================================
router.get("/", (req, res) => {
  // 1) store-level filters (status/customerId/businessLine)
  // 2) per-user visibility scoping — a user only receives complaints they are
  //    entitled to see (see visibleToUser). This is the real fix for the
  //    over-fetch / broken-access-control finding: the list no longer dumps
  //    every complaint to every authenticated role.
  // 3) ?limit/?offset bounding so the payload can't grow unbounded.
  const visible = complaintStore.getAll(req.query).filter((c) => visibleToUser(req.user, c));
  res.json(paginate(visible.map(enrich), req.query, "data"));
});

// =========================================================================
// GET SINGLE COMPLAINT
// GET /api/complaints/:complaintNo
// =========================================================================
router.get("/:complaintNo", (req, res) => {
  const complaint = complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: `Complaint ${req.params.complaintNo} not found` });
  // IDOR guard: enumerating complaint numbers must not reveal complaints the
  // caller isn't entitled to see.
  if (denyIfHidden(req, res, complaint)) return;
  res.json(enrich(complaint));
});

// =========================================================================
// UNIVERSAL WORKFLOW ACTION
// POST /api/complaints/:complaintNo/action
// Body: { action, actorId, actorRole, remarks }
// Actions: approve | reject | clarify | resolve_clarification | auto_close
// =========================================================================
router.post("/:complaintNo/action", (req, res) => {
  const complaint = complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  complaint._latestSample = sampleStore.getLatestForComplaint(complaint.complaintNo);

  const { action, remarks } = req.body;
  if (!action) return res.status(400).json({ error: "action is required" });

  // RBAC: check if logged-in user can act on current status
  const rbac = canActOnStatus(req.user, complaint.status, action, complaint._priorStatus);
  if (!rbac.allowed) {
    return res.status(403).json({ error: rbac.reason, yourRole: req.user.roleId });
  }

  const result = workflow.evaluateTransition(complaint, action);
  if (!result.allowed) {
    return res.status(422).json({ error: result.reason });
  }

  const oldStatus = complaint.status;
  const updates = { status: result.newStatus };
  if (result.newStatus === "Closed") updates.closedAt = new Date().toISOString();
  if (result.priorStatus) updates._priorStatus = result.priorStatus;

  complaintStore.update(complaint.complaintNo, updates);

  audit.log({
    complaintNo: complaint.complaintNo,
    fromStatus:  oldStatus,
    toStatus:    result.newStatus,
    action:      action.charAt(0).toUpperCase() + action.slice(1),
    actorType:   "User",
    actorId:     req.user.userId,
    actorRole:   req.user.roleName,
    remarks:     remarks || null,
  });

  // Fire notification async — does not block the response
  const updatedComplaint = complaintStore.getByNo(complaint.complaintNo);
  notify.sendNotification({
    complaint:  updatedComplaint,
    newStatus:  result.newStatus,
    actorUser:  req.user,
    remarks:    remarks || null,
  }).catch((err) => console.error("[NOTIFY] Error:", err.message));

  res.json({
    success:     true,
    complaintNo: complaint.complaintNo,
    fromStatus:  oldStatus,
    toStatus:    result.newStatus,
    notification: {
      mode:   notify.MODE,
      status: "queued",
      hint:   notify.MODE === "mock" ? "Check server console or GET /api/notifications" : "Emails dispatched",
    },
    complaint:   enrich(updatedComplaint),
  });
});

// =========================================================================
// ADD LINE ITEM (additional items to an existing complaint)
// POST /api/complaints/:complaintNo/line-items
// =========================================================================
router.post("/:complaintNo/line-items", async (req, res) => {
  const complaint = complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });
  if (!["Draft", "Logged"].includes(complaint.status)) {
    return res.status(422).json({ error: "Line items can only be added in Draft or Logged status" });
  }

  const { invoiceItemNo, sapMaterialNo, productName, uom, complaintTypeId, defectiveQty } = req.body;
  const parsedDefQty = parseFloat(defectiveQty || 0);
  const cType = masterData.findComplaintType(complaintTypeId);

  // ── PRICE-TAMPERING GUARD ──────────────────────────────────────────
  // unitPrice / invoiceQty are resolved from the SAP invoice, never from the
  // request body. An item that isn't on the invoice is rejected. Manual money
  // figures are accepted only when the complaint is already SAP-pending.
  let unitPrice = 0, invoiceQty = 0;
  let mat = sapMaterialNo, name = productName, unit = uom;
  try {
    const invoice = await sap.getInvoice(complaint.invoiceNumber);
    const invItem = (invoice.lineItems || []).find(
      (li) => String(li.BillingDocumentItem) === String(invoiceItemNo)
    );
    if (!invItem) {
      return res.status(400).json({
        error: `Invoice item ${invoiceItemNo || "(missing)"} is not on SAP invoice ${complaint.invoiceNumber}. ` +
               `Prices are taken from SAP, so only invoice items can be added.`,
      });
    }
    unitPrice  = parseFloat(invItem.NetPriceAmount || 0);
    invoiceQty = parseFloat(invItem.BillingQuantity || 0);
    mat  = invItem.Material            || sapMaterialNo;
    name = invItem.MaterialDescription || productName;
    unit = invItem.BillingQuantityUnit || uom || "Ream";
  } catch (sapErr) {
    if (!complaint.sapValidationPending) {
      return res.status(502).json({
        error: `Cannot validate this line item against SAP invoice ${complaint.invoiceNumber}: ${sapErr.message}`,
      });
    }
    unitPrice  = parseFloat(req.body.unitPrice  || 0);
    invoiceQty = parseFloat(req.body.invoiceQty || 0);
  }

  const li = lineItemStore.create({
    complaintNo:      complaint.complaintNo,
    invoiceNumber:    complaint.invoiceNumber,
    invoiceItemNo, sapMaterialNo: mat, productName: name,
    invoiceQty,
    unitPrice,
    defectiveQty:     parsedDefQty,
    uom:              unit || "Ream",
    complaintTypeId,
    complaintTypeName: cType?.typeName,
    sampleRequired:   cType?.sampleRequired || false,
  });

  // Recalculate settlement value
  const newTotal = lineItemStore.getTotalDefectiveValue(complaint.complaintNo);
  complaintStore.update(complaint.complaintNo, { settlementValue: newTotal });

  // Update sampleRequired flag if this line item needs it
  if (cType?.sampleRequired && !complaint.sampleRequired) {
    complaintStore.update(complaint.complaintNo, { sampleRequired: true });
  }

  res.status(201).json({ success: true, lineItem: li, newSettlementValue: newTotal });
});

// =========================================================================
// ADD ATTACHMENT
// POST /api/complaints/:complaintNo/attachments
// =========================================================================
router.post("/:complaintNo/attachments", (req, res) => {
  const complaint = complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  const att = attachmentStore.create({
    complaintNo: complaint.complaintNo,
    ...req.body,
  });
  res.status(201).json({ success: true, attachment: att });
});

// =========================================================================
// SAMPLE MANAGEMENT  —  Section 6.3
// POST /api/complaints/:complaintNo/samples        → Create sample record
// PUT  /api/complaints/:complaintNo/samples/:sampleId → Update status
// =========================================================================
router.post("/:complaintNo/samples", requireRoles(["R003","R004"]), (req, res) => {
  const complaint = complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  const sType = masterData.findSampleType(req.body.sampleTypeId);
  const sample = sampleStore.create({
    complaintNo:    complaint.complaintNo,
    sampleTypeName: sType?.sampleTypeName,
    ...req.body,
    createdBy:      req.user.userId, // authoritative — overrides any body value
  });

  // Update complaint's sample reference
  complaintStore.update(complaint.complaintNo, { _latestSample: sample });

  audit.log({
    complaintNo: complaint.complaintNo,
    action:      `Sample Created (${sType?.sampleTypeName || req.body.sampleTypeId}) — Status: Awaited`,
    actorType:   "User",
    actorId:     req.user.userId,
    actorRole:   req.user.roleName,
  });

  res.status(201).json({ success: true, sample });
});

router.put("/:complaintNo/samples/:sampleId", requireRoles(["R003","R004"]), (req, res) => {
  const complaint = complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  const { sampleStatus, receivedBy, receivedDate, testResult, testResultNotes, testReportReference, disposalDate } = req.body;

  if (sampleStatus && !SAMPLE_STATUSES.includes(sampleStatus)) {
    return res.status(400).json({ error: `Invalid sampleStatus. Valid: ${SAMPLE_STATUSES.join(", ")}` });
  }

  const updates = {};
  if (sampleStatus)         updates.sampleStatus = sampleStatus;
  // Who handled the sample is the authenticated QC user, not a body value.
  if (receivedDate || sampleStatus === "Received") updates.receivedBy = req.user.userId;
  if (receivedDate)         updates.receivedDate = receivedDate;
  if (testResult)           updates.testResult = testResult;
  if (testResultNotes)      updates.testResultNotes = testResultNotes;
  if (testReportReference)  updates.testReportReference = testReportReference;
  if (disposalDate)         updates.disposalDate = disposalDate;

  const sample = sampleStore.update(req.params.sampleId, updates);
  if (!sample) return res.status(404).json({ error: "Sample not found" });

  // Sync latest sample reference on complaint
  complaintStore.update(complaint.complaintNo, { _latestSample: sample });

  audit.log({
    complaintNo: complaint.complaintNo,
    action:      `Sample Updated — New Status: ${sampleStatus || "unchanged"}`,
    actorType:   "User",
    actorId:     req.user.userId,
    actorRole:   req.user.roleName,
    remarks:     testResult ? `Test Result: ${testResult}` : null,
  });

  res.json({ success: true, sample });
});

// =========================================================================
// VISIT MANAGEMENT  —  Section 7
// POST /api/complaints/:complaintNo/visits        → Schedule visit
// PUT  /api/complaints/:complaintNo/visits/:visitId → Update outcome
// =========================================================================
router.post("/:complaintNo/visits", requireRoles(["R010","R011"]), (req, res) => {
  const complaint = complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  // Determine visit type
  const isMandatory = workflow.requiresVisit(complaint);
  const visit = visitStore.create({
    complaintNo:   complaint.complaintNo,
    visitType:     req.body.visitType || (isMandatory ? "Mandatory" : "Optional"),
    triggerReason: req.body.triggerReason || (isMandatory ? "Settlement threshold / Key account" : "Sales discretion"),
    scheduledDate: req.body.scheduledDate,
    assignedTo:    req.body.assignedTo,
  });

  // Flag visit on complaint
  complaintStore.update(complaint.complaintNo, { visitRequested: true });

  audit.log({
    complaintNo: complaint.complaintNo,
    action:      `Customer Visit Scheduled — Type: ${visit.visitType}`,
    actorType:   "User",
    actorId:     req.user.userId,
    actorRole:   req.user.roleName,
    remarks:     `Scheduled: ${req.body.scheduledDate}`,
  });

  res.status(201).json({ success: true, visit });
});

router.put("/:complaintNo/visits/:visitId", requireRoles(["R010","R011"]), (req, res) => {
  const complaint = complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  const { visitStatus, visitDate, findings, customerAcknowledgement, outcome } = req.body;
  const visit = visitStore.update(req.params.visitId, {
    visitStatus, visitDate, findings, customerAcknowledgement, outcome,
  });
  if (!visit) return res.status(404).json({ error: "Visit not found" });

  audit.log({
    complaintNo: complaint.complaintNo,
    action:      `Customer Visit Updated — Status: ${visitStatus || "unchanged"}, Outcome: ${outcome || "TBD"}`,
    actorType:   "User",
    actorId:     req.user.userId,
    actorRole:   req.user.roleName,
  });

  res.json({ success: true, visit });
});

// =========================================================================
// CAPA MANAGEMENT  —  Section 4
// POST /api/complaints/:complaintNo/capa
// =========================================================================
router.post("/:complaintNo/capa", requireRoles(["R005","R006"]), (req, res) => {
  const complaint = complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });
  if (!["CAPA_Pending", "QC_Review", "Sample_Awaited"].includes(complaint.status)) {
    return res.status(422).json({ error: `CAPA can only be documented in QC_Review, Sample_Awaited, or CAPA_Pending status. Current: ${complaint.status}` });
  }
  if (!req.body.rootCauseDescription) return res.status(400).json({ error: "rootCauseDescription is required" });
  if (!req.body.correctiveAction)     return res.status(400).json({ error: "correctiveAction is required" });
  if (!req.body.preventiveAction)     return res.status(400).json({ error: "preventiveAction is required" });

  const capa = capaStore.create({
    complaintNo:          complaint.complaintNo,
    sampleTestReference:  req.body.sampleTestReference,
    ...req.body,
    // Authoritative attribution from the JWT — overrides any body value.
    documentedBy:         req.user.userId,
    documentedByName:     req.user.name,
  });

  audit.log({
    complaintNo: complaint.complaintNo,
    action:      "CAPA Documented",
    actorType:   "User",
    actorId:     req.user.userId,
    actorRole:   req.user.roleName,
    remarks:     `Root Cause: ${req.body.rootCauseDescription?.slice(0, 80)}...`,
  });

  res.status(201).json({ success: true, capa });
});

// =========================================================================
// FINANCE: RAISE CREDIT NOTE IN SAP  —  Section 11.1 Touchpoints 5 & 6
// POST /api/complaints/:complaintNo/credit-note
// Triggered at Finance_Processing status; pushes to SAP and writes back CN number.
// =========================================================================
router.post("/:complaintNo/credit-note", requireRoles(["R010"]), async (req, res) => {
  const complaint = complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  if (complaint.status !== "Finance_Processing") {
    return res.status(422).json({
      error: `Credit Note can only be raised at Finance_Processing stage. Current status: ${complaint.status}`,
    });
  }
  if (complaint.creditNoteNumber) {
    return res.status(400).json({ error: "Credit Note already raised for this complaint." });
  }

  try {
    const items = lineItemStore.getForComplaint(complaint.complaintNo);

    // SAP Call — Touchpoint 5: CCMS → SAP
    audit.log({
      complaintNo: complaint.complaintNo,
      action:      "SAP Credit Note Request Sent",
      actorType:   "System",
      actorId:     "SYSTEM",
      actorRole:   "SAP Integration",
      remarks:     `Amount: ${complaint.settlementValue} ${complaint.currency}`,
    });

    const sapResult = await sap.pushCreditNote({
      complaintNo:     complaint.complaintNo,
      customerId:      complaint.customerId,
      invoiceNumber:   complaint.invoiceNumber,
      settlementValue: complaint.settlementValue,
      currency:        complaint.currency,
      reason:          req.body.reason || "Customer complaint settlement",
      lineItems:       items,
    });

    // SAP Call — Touchpoint 6: Credit Note number written back to CCMS
    const cn = creditNoteStore.create({
      complaintNo:       complaint.complaintNo,
      creditNoteNumber:  sapResult.CreditNoteNumber,
      sapDocumentNumber: sapResult.SapDocumentNumber,
      amount:            complaint.settlementValue,
      currency:          complaint.currency,
      // Authoritative — the Finance officer is identified by their JWT.
      raisedBy:          req.user.userId,
      raisedByName:      req.user.name,
      notifiedTo:        ["Marketing Head", "KAM", "Customer"],  // Section 5 — post-closure notifications
    });

    // Update complaint with credit note number (enables Closed transition)
    complaintStore.update(complaint.complaintNo, {
      creditNoteNumber: sapResult.CreditNoteNumber,
    });

    audit.log({
      complaintNo: complaint.complaintNo,
      action:      `SAP Credit Note Created — ${sapResult.CreditNoteNumber}`,
      actorType:   "System",
      actorId:     "SYSTEM",
      actorRole:   "SAP Integration",
      remarks:     `SAP Document: ${sapResult.SapDocumentNumber}`,
    });

    audit.log({
      complaintNo: complaint.complaintNo,
      action:      "Credit Note Recorded by Finance",
      actorType:   "User",
      actorId:     req.user.userId,
      actorRole:   req.user.roleName,
    });

    res.status(201).json({
      success:    true,
      creditNote: cn,
      sapResponse: sapResult,
      message:    `Credit Note ${sapResult.CreditNoteNumber} raised in SAP. Complaint is ready to close — call POST /action with action=approve.`,
    });
  } catch (err) {
    audit.log({
      complaintNo: complaint.complaintNo,
      action:      `SAP Credit Note Push FAILED: ${err.message}`,
      actorType:   "System",
      actorId:     "SYSTEM",
      actorRole:   "SAP Integration",
    });
    res.status(500).json({ error: `SAP Credit Note creation failed: ${err.message}` });
  }
});

// =========================================================================
// AUDIT LOG
// GET /api/complaints/:complaintNo/audit-log
// =========================================================================
router.get("/:complaintNo/audit-log", (req, res) => {
  const complaint = complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });
  if (denyIfHidden(req, res, complaint)) return;
  const audit_data = require("../data/auditLog");
  res.json({
    complaintNo: complaint.complaintNo,
    currentStatus: complaint.status,
    entries: audit_data.getForComplaint(complaint.complaintNo),
  });
});

// =========================================================================
// WORKFLOW STATUS SEQUENCE
// GET /api/complaints/:complaintNo/status-sequence
// =========================================================================
router.get("/:complaintNo/status-sequence", (req, res) => {
  const complaint = complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });
  if (denyIfHidden(req, res, complaint)) return;
  res.json({
    complaintNo:    complaint.complaintNo,
    currentStatus:  complaint.status,
    statusSequence: workflow.getEffectiveSequence(complaint),
    gates: {
      sampleRequired:       complaint.sampleRequired,
      mdApprovalRequired:   workflow.requiresMdApproval(complaint),
      visitRequired:        workflow.requiresVisit(complaint),
      sampleGatePassed:     workflow.sampleGatePassed(complaint),
    },
  });
});

module.exports = router;
