const express = require("express");
const fs = require("fs");
const router = require("../utils/asyncRoute").safeRouter();
const db = require("../db/pool");
const fileStore = require("../utils/fileStore");
const {
  complaintStore,
  lineItemStore,
  attachmentStore,
  sampleStore,
  visitStore,
  capaStore,
  creditNoteStore,
  SAMPLE_STATUSES,
  VISIT_STATUSES,
  VISIT_OUTCOMES,
} = require("../data/transactionalStore");
const masterData = require("../data/masterData");
const sap = require("../services/sapService");
const workflow = require("../services/workflowService");
const audit = require("../data/auditLog");
const { requireRoles, canActOnStatus } = require("../middleware/auth");
const rollout = require("../config/rollout");
const notify = require("../services/notificationService");
const { paginate } = require("../utils/pagination");

async function enrich(complaint) {
  if (!complaint) return null;
  const [lineItems, attachments, samples, visits, capas, creditNotes] = await Promise.all([
    lineItemStore.getForComplaint(complaint.complaintNo),
    attachmentStore.getForComplaint(complaint.complaintNo),
    sampleStore.getForComplaint(complaint.complaintNo),
    visitStore.getForComplaint(complaint.complaintNo),
    capaStore.getForComplaint(complaint.complaintNo),
    creditNoteStore.getForComplaint(complaint.complaintNo),
  ]);
  return {
    ...complaint,
    lineItems, attachments, samples, visits, capas, creditNotes,
    statusSequence: workflow.getEffectiveSequence(complaint),
  };
}

async function enrichMany(complaints) {
  if (!complaints.length) return [];
  const nos = complaints.map((c) => c.complaintNo);
  const [lineItems, attachments, samples, visits, capas, creditNotes] = await Promise.all([
    lineItemStore.getForComplaints(nos),
    attachmentStore.getForComplaints(nos),
    sampleStore.getForComplaints(nos),
    visitStore.getForComplaints(nos),
    capaStore.getForComplaints(nos),
    creditNoteStore.getForComplaints(nos),
  ]);
  const groupBy = (rows) => rows.reduce((m, r) => {
    (m[r.complaintNo] = m[r.complaintNo] || []).push(r); return m;
  }, {});
  const li = groupBy(lineItems), at = groupBy(attachments), sa = groupBy(samples),
        vi = groupBy(visits), ca = groupBy(capas), cn = groupBy(creditNotes);
  return complaints.map((c) => ({
    ...c,
    lineItems:   li[c.complaintNo] || [],
    attachments: at[c.complaintNo] || [],
    samples:     sa[c.complaintNo] || [],
    visits:      vi[c.complaintNo] || [],
    capas:       ca[c.complaintNo] || [],
    creditNotes: cn[c.complaintNo] || [],
    statusSequence: workflow.getEffectiveSequence(c),
  }));
}

const { visibleToUser, filterVisible } = require("../services/visibility");

async function denyIfHidden(req, res, complaint) {
  if (await visibleToUser(req.user, complaint)) return false;
  res.status(403).json({ error: "You are not authorised to view this complaint." });
  return true;
}

router.post("/", async (req, res, next) => {
  try {
    const {
      invoiceNumber,
      title,
      remarks,
      lineItemsInput = [],
      attachmentsInput = [],
      reportedBy,
    } = req.body;

    if (!invoiceNumber) return res.status(400).json({ error: "invoiceNumber is required" });
    if (!lineItemsInput.length) return res.status(400).json({ error: "At least one line item (affected product) is required" });

    const badAttachment = (attachmentsInput || []).find((a) => a.fileType && !fileStore.EXT_BY_TYPE[a.fileType]);
    if (badAttachment) {
      return res.status(400).json({
        error: `Invalid attachment fileType '${badAttachment.fileType}'. Valid: ${Object.keys(fileStore.EXT_BY_TYPE).join(", ")}.`,
      });
    }

    let invoice;
    let sapFallback = false;
    try {
      invoice = await sap.getInvoice(invoiceNumber);
    } catch (sapErr) {

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

    const firstItem = lineItemsInput[0];
    const productInfo = firstItem.sapMaterialNo
      ? masterData.findProduct(firstItem.sapMaterialNo)
      : null;
    const businessLine = productInfo?.businessLine || customerRecord.businessLine || "Paper";

    const gate = rollout.checkRolloutGate(businessLine, customerRecord.region);
    if (!gate.allowed) {
      return res.status(403).json({ error: gate.reason, phase: gate.phase, hint: gate.hint });
    }

    const policy = masterData.findApplicablePolicy(businessLine, customerRecord.segment);

    const invoiceItemMap = {};
    (invoice.lineItems || []).forEach((li) => {
      invoiceItemMap[li.BillingDocumentItem] = li;
    });

    let totalDefectiveValue = 0;
    let anyLineItemSampleRequired = false;
    const invalidItems = [];

    const createdLineItems = lineItemsInput.map((input) => {
      const invItem = invoiceItemMap[input.invoiceItemNo];

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

    const overclaimed = createdLineItems
      .filter(Boolean)
      .filter((li) => li.defectiveQty > li.invoiceQty);
    if (overclaimed.length) {
      return res.status(400).json({
        error: "Defective quantity cannot exceed the invoiced quantity for a line item.",
        overclaimedItems: overclaimed.map((li) => ({
          invoiceItemNo: li.invoiceItemNo, invoiceQty: li.invoiceQty, defectiveQty: li.defectiveQty,
        })),
      });
    }

    const itemBusinessLines = [...new Set(
      createdLineItems
        .filter(Boolean)
        .map((li) => masterData.findProduct(li.sapMaterialNo)?.businessLine)
        .filter(Boolean)
    )];
    if (itemBusinessLines.length > 1) {
      return res.status(400).json({
        error: `All affected products in one complaint must belong to the same business line — ` +
               `found ${itemBusinessLines.join(" and ")}. Please file a separate complaint per business line.`,
        businessLines: itemBusinessLines,
      });
    }

    const policyResult = masterData.checkPolicyCompliance(
      policy,
      invoice.BillingDocumentDate,
      totalDefectiveValue,
      parseFloat(invoice.NetAmount)
    );

    const knownCustomerId = masterData.findCustomer(customerRecord.customerId)
      ? customerRecord.customerId : null;

    const complaint = await db.tx(async (client) => {
      const c = await complaintStore.create({
        title:                title || `Complaint for Invoice ${invoiceNumber}`,
        remarks:              remarks || "",
        invoiceNumber:        invoice.BillingDocument,
        invoiceDate:          invoice.BillingDocumentDate,
        invoiceValue:         parseFloat(invoice.NetAmount),
        currency:             invoice.TransactionCurrency,
        customerId:           knownCustomerId,
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

        reportedBy:           req.user.userId,
        _customer:            customerRecord,
        _sapFallback:         sapFallback,
      }, client);

      for (const li of createdLineItems) {
        await lineItemStore.create({ complaintNo: c.complaintNo, ...li }, client);
      }

      for (const att of (attachmentsInput || [])) {
        await attachmentStore.create({ complaintNo: c.complaintNo, ...att, uploadedBy: req.user.userId }, client);
      }
      return c;
    });

    await audit.log({
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
      await audit.log({
        complaintNo: complaint.complaintNo,
        action:      `Policy Flag: ${policyResult.clauseBreached}`,
        actorType:   "System",
        actorId:     "SYSTEM",
        actorRole:   "Policy Engine",
      });
    }

    notify.sendCustomerNotification({ complaint, event: "acknowledgement" })
      .catch((err) => console.error("[NOTIFY] Customer acknowledgement error:", err.message));

    res.status(201).json({
      success:     true,
      complaint:   await enrich(complaint),
      policyAlert: policyResult.compliant ? null : policyResult,
      warnings:    sapFallback ? ["SAP invoice lookup failed — complaint created with manual data, pending validation"] : [],
      acknowledgement: {
        channel: "customer-email",
        to:      notify.resolveCustomerEmail(complaint),
        mode:    notify.MODE,
        status:  "Logged",
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res) => {

  const all = await complaintStore.getAll({ ...req.query, archived: false });
  const visible = await filterVisible(req.user, all);

  const page = paginate(visible, req.query, "data");
  page.data = await enrichMany(page.data);
  res.json(page);
});

router.get("/:complaintNo", async (req, res) => {
  const complaint = await complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: `Complaint ${req.params.complaintNo} not found` });

  if (await denyIfHidden(req, res, complaint)) return;
  res.json(await enrich(complaint));
});

router.post("/:complaintNo/action", async (req, res) => {
  const complaint = await complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  complaint._latestSample = await sampleStore.getLatestForComplaint(complaint.complaintNo);

  const { action, remarks } = req.body;
  if (!action) return res.status(400).json({ error: "action is required" });

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

  await complaintStore.update(complaint.complaintNo, updates);

  await audit.log({
    complaintNo: complaint.complaintNo,
    fromStatus:  oldStatus,
    toStatus:    result.newStatus,
    action:      action.charAt(0).toUpperCase() + action.slice(1),
    actorType:   "User",
    actorId:     req.user.userId,
    actorRole:   req.user.roleName,
    remarks:     remarks || null,
  });

  const updatedComplaint = await complaintStore.getByNo(complaint.complaintNo);
  notify.sendNotification({
    complaint:  updatedComplaint,
    newStatus:  result.newStatus,
    actorUser:  req.user,
    remarks:    remarks || null,
  }).catch((err) => console.error("[NOTIFY] Error:", err.message));

  const customerEvent = notify.customerEventForStatus(result.newStatus);
  if (customerEvent) {
    notify.sendCustomerNotification({ complaint: updatedComplaint, event: customerEvent })
      .catch((err) => console.error("[NOTIFY] Customer update error:", err.message));
  }

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
    customerNotification: customerEvent
      ? { event: customerEvent, to: notify.resolveCustomerEmail(updatedComplaint), mode: notify.MODE }
      : null,
    complaint:   await enrich(updatedComplaint),
  });
});

router.post("/:complaintNo/line-items", async (req, res) => {
  const complaint = await complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  if (await denyIfHidden(req, res, complaint)) return;
  if (!["Draft", "Logged"].includes(complaint.status)) {
    return res.status(422).json({ error: "Line items can only be added in Draft or Logged status" });
  }

  const { invoiceItemNo, sapMaterialNo, productName, uom, complaintTypeId, defectiveQty } = req.body;
  const parsedDefQty = parseFloat(defectiveQty || 0);
  const cType = masterData.findComplaintType(complaintTypeId);

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

  const newItemBusinessLine = masterData.findProduct(mat)?.businessLine;
  if (newItemBusinessLine && complaint.businessLine && newItemBusinessLine !== complaint.businessLine) {
    return res.status(400).json({
      error: `This product is a ${newItemBusinessLine} product, but complaint ${complaint.complaintNo} ` +
             `is a ${complaint.businessLine} complaint. All line items must share one business line — ` +
             `please file a separate complaint for ${newItemBusinessLine} products.`,
    });
  }

  if (parsedDefQty > invoiceQty) {
    return res.status(400).json({
      error: "Defective quantity cannot exceed the invoiced quantity.",
      invoiceQty, defectiveQty: parsedDefQty,
    });
  }

  const li = await lineItemStore.create({
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

  const newTotal = await lineItemStore.getTotalDefectiveValue(complaint.complaintNo);
  await complaintStore.update(complaint.complaintNo, { settlementValue: newTotal });

  if (cType?.sampleRequired && !complaint.sampleRequired) {
    await complaintStore.update(complaint.complaintNo, { sampleRequired: true });
  }

  await audit.log({
    complaintNo: complaint.complaintNo,
    action:      "Line Item Added",
    actorType:   "User",
    actorId:     req.user.userId,
    actorRole:   req.user.roleName,
    remarks:     `${name || mat || "item"} — defective ${parsedDefQty}; settlement now ${newTotal}`,
  });

  res.status(201).json({ success: true, lineItem: li, newSettlementValue: newTotal });
});

router.post("/:complaintNo/attachments", async (req, res) => {
  const complaint = await complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  if (await denyIfHidden(req, res, complaint)) return;

  if (req.body.fileType && !fileStore.EXT_BY_TYPE[req.body.fileType]) {
    return res.status(400).json({
      error: `Invalid fileType '${req.body.fileType}'. Valid: ${Object.keys(fileStore.EXT_BY_TYPE).join(", ")}.`,
    });
  }

  const att = await attachmentStore.create({
    complaintNo: complaint.complaintNo,
    ...req.body,
    uploadedBy: req.user.userId,
  });

  await audit.log({
    complaintNo: complaint.complaintNo,
    action:      `Attachment Added (${att.fileType || "file"})`,
    actorType:   "User",
    actorId:     req.user.userId,
    actorRole:   req.user.roleName,
    remarks:     att.description || att.fileReference || null,
  });

  res.status(201).json({ success: true, attachment: att });
});

router.post(
  "/:complaintNo/attachments/upload",
  express.raw({ type: () => true, limit: fileStore.MAX_BYTES }),
  async (req, res) => {
    const complaint = await complaintStore.getByNo(req.params.complaintNo);
    if (!complaint) return res.status(404).json({ error: "Complaint not found" });
    if (await denyIfHidden(req, res, complaint)) return;

    const fileType = String(req.query.fileType || "photo");
    if (!fileStore.EXT_BY_TYPE[fileType]) {
      return res.status(400).json({ error: `Invalid fileType. Valid: ${Object.keys(fileStore.EXT_BY_TYPE).join(", ")}` });
    }
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buf || !buf.length) {
      return res.status(400).json({ error: "Empty upload — send the file bytes as the request body (Content-Type must not be application/json)." });
    }

    const fileName   = String(req.query.fileName || "upload");
    const storedName = fileStore.newStoredName(fileType, fileName);
    fileStore.write(storedName, buf);

    const att = await attachmentStore.create({
      complaintNo:   complaint.complaintNo,
      fileReference: storedName,
      fileType,
      description:   req.query.description ? String(req.query.description) : fileName,
      uploadedBy:    req.user.userId,
    });

    await audit.log({
      complaintNo: complaint.complaintNo,
      action:      `Attachment Uploaded (${fileType}, ${buf.length} bytes)`,
      actorType:   "User",
      actorId:     req.user.userId,
      actorRole:   req.user.roleName,
      remarks:     fileName,
    });

    res.status(201).json({
      success: true,
      attachment: att,
      bytes: buf.length,
      downloadUrl: `/api/complaints/${complaint.complaintNo}/attachments/${att.attachmentId}/file`,
    });
  }
);

router.get("/:complaintNo/attachments/:attachmentId/file", async (req, res) => {
  const complaint = await complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });
  if (await denyIfHidden(req, res, complaint)) return;

  const att = await attachmentStore.getById(req.params.attachmentId);
  if (!att || att.complaintNo !== complaint.complaintNo) {
    return res.status(404).json({ error: "Attachment not found" });
  }
  if (att.purged) {
    return res.status(410).json({ error: "This attachment file was purged under the retention policy; metadata is retained." });
  }
  const filePath = fileStore.resolveStored(att.fileReference);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: "No stored file for this attachment (it may be a reference only)." });
  }
  res.setHeader("Content-Type", fileStore.contentTypeFor(att.fileReference));
  res.setHeader("Content-Disposition", `inline; filename="${String(att.description || "file").replace(/[^\w.\-]/g, "_")}"`);
  fs.createReadStream(filePath).pipe(res);
});

router.post("/:complaintNo/samples", requireRoles(["R003","R004"]), async (req, res) => {
  const complaint = await complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  const sType = masterData.findSampleType(req.body.sampleTypeId);
  const sample = await sampleStore.create({
    complaintNo:    complaint.complaintNo,
    sampleTypeName: sType?.sampleTypeName,
    ...req.body,
    createdBy:      req.user.userId,
  });

  await audit.log({
    complaintNo: complaint.complaintNo,
    action:      `Sample Created (${sType?.sampleTypeName || req.body.sampleTypeId}) — Status: Awaited`,
    actorType:   "User",
    actorId:     req.user.userId,
    actorRole:   req.user.roleName,
  });

  res.status(201).json({ success: true, sample });
});

router.put("/:complaintNo/samples/:sampleId", requireRoles(["R003","R004"]), async (req, res) => {
  const complaint = await complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  const { sampleStatus, receivedBy, receivedDate, testResult, testResultNotes, testReportReference, disposalDate } = req.body;

  if (sampleStatus && !SAMPLE_STATUSES.includes(sampleStatus)) {
    return res.status(400).json({ error: `Invalid sampleStatus. Valid: ${SAMPLE_STATUSES.join(", ")}` });
  }

  const updates = {};
  if (sampleStatus)         updates.sampleStatus = sampleStatus;

  if (receivedDate || sampleStatus === "Received") updates.receivedBy = req.user.userId;
  if (receivedDate)         updates.receivedDate = receivedDate;
  if (testResult)           updates.testResult = testResult;
  if (testResultNotes)      updates.testResultNotes = testResultNotes;
  if (testReportReference)  updates.testReportReference = testReportReference;
  if (disposalDate)         updates.disposalDate = disposalDate;

  const sample = await sampleStore.update(req.params.sampleId, updates);
  if (!sample) return res.status(404).json({ error: "Sample not found" });

  await audit.log({
    complaintNo: complaint.complaintNo,
    action:      `Sample Updated — New Status: ${sampleStatus || "unchanged"}`,
    actorType:   "User",
    actorId:     req.user.userId,
    actorRole:   req.user.roleName,
    remarks:     testResult ? `Test Result: ${testResult}` : null,
  });

  res.json({ success: true, sample });
});

router.post("/:complaintNo/visits", requireRoles(["R010","R011"]), async (req, res) => {
  const complaint = await complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  const isMandatory = workflow.requiresVisit(complaint);
  const visit = await visitStore.create({
    complaintNo:   complaint.complaintNo,
    visitType:     req.body.visitType || (isMandatory ? "Mandatory" : "Optional"),
    triggerReason: req.body.triggerReason || (isMandatory ? "Settlement threshold / Key account" : "Sales discretion"),
    scheduledDate: req.body.scheduledDate,
    assignedTo:    req.body.assignedTo,
  });

  await complaintStore.update(complaint.complaintNo, { visitRequested: true });

  await audit.log({
    complaintNo: complaint.complaintNo,
    action:      `Customer Visit Scheduled — Type: ${visit.visitType}`,
    actorType:   "User",
    actorId:     req.user.userId,
    actorRole:   req.user.roleName,
    remarks:     `Scheduled: ${req.body.scheduledDate}`,
  });

  res.status(201).json({ success: true, visit });
});

router.put("/:complaintNo/visits/:visitId", requireRoles(["R010","R011"]), async (req, res) => {
  const complaint = await complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  const { visitStatus, visitDate, findings, customerAcknowledgement, outcome } = req.body;

  if (visitStatus && !VISIT_STATUSES.includes(visitStatus)) {
    return res.status(400).json({ error: `Invalid visitStatus. Valid: ${VISIT_STATUSES.join(", ")}` });
  }
  if (outcome && !VISIT_OUTCOMES.includes(outcome)) {
    return res.status(400).json({ error: `Invalid outcome. Valid: ${VISIT_OUTCOMES.join(", ")}` });
  }

  const updates = {};
  if (visitStatus)            updates.visitStatus = visitStatus;
  if (visitDate)              updates.visitDate = visitDate;
  if (findings)               updates.findings = findings;
  if (customerAcknowledgement) updates.customerAcknowledgement = customerAcknowledgement;
  if (outcome)                updates.outcome = outcome;

  const visit = await visitStore.update(req.params.visitId, updates);
  if (!visit) return res.status(404).json({ error: "Visit not found" });

  await audit.log({
    complaintNo: complaint.complaintNo,
    action:      `Customer Visit Updated — Status: ${visitStatus || "unchanged"}, Outcome: ${outcome || "TBD"}`,
    actorType:   "User",
    actorId:     req.user.userId,
    actorRole:   req.user.roleName,
  });

  res.json({ success: true, visit });
});

router.delete("/:complaintNo/visits/:visitId", requireRoles(["R010", "R011"]), async (req, res) => {
  const complaint = await complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  const visit = await visitStore.getById(req.params.visitId);

  if (!visit || visit.complaintNo !== complaint.complaintNo) {
    return res.status(404).json({ error: "Visit not found" });
  }

  if (visit.visitDate || visit.findings || visit.outcome || visit.customerAcknowledgement) {
    return res.status(409).json({
      error: "This visit has recorded work and cannot be removed. Set its status to Cancelled instead.",
    });
  }

  await visitStore.remove(visit.visitId);

  await audit.log({
    complaintNo: complaint.complaintNo,
    action:      "Customer Visit Removed",
    actorType:   "User",
    actorId:     req.user.userId,
    actorRole:   req.user.roleName,
    remarks:     `Scheduled ${visit.visitType} visit removed before it took place. No visit record existed to retain.`,
  });

  res.json({ success: true, removed: visit.visitId });
});

router.post("/:complaintNo/capa", requireRoles(["R005","R006"]), async (req, res) => {
  const complaint = await complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });
  if (!["CAPA_Pending", "QC_Review", "Sample_Awaited"].includes(complaint.status)) {
    return res.status(422).json({ error: `CAPA can only be documented in QC_Review, Sample_Awaited, or CAPA_Pending status. Current: ${complaint.status}` });
  }
  if (!req.body.rootCauseDescription) return res.status(400).json({ error: "rootCauseDescription is required" });
  if (!req.body.correctiveAction)     return res.status(400).json({ error: "correctiveAction is required" });
  if (!req.body.preventiveAction)     return res.status(400).json({ error: "preventiveAction is required" });

  const capa = await capaStore.create({
    complaintNo:          complaint.complaintNo,
    sampleTestReference:  req.body.sampleTestReference,
    ...req.body,

    documentedBy:         req.user.userId,
    documentedByName:     req.user.name,
  });

  await audit.log({
    complaintNo: complaint.complaintNo,
    action:      "CAPA Documented",
    actorType:   "User",
    actorId:     req.user.userId,
    actorRole:   req.user.roleName,
    remarks:     `Root Cause: ${req.body.rootCauseDescription?.slice(0, 80)}...`,
  });

  res.status(201).json({ success: true, capa });
});

router.post("/:complaintNo/credit-note", requireRoles(["R010"]), async (req, res, next) => {
  const complaint = await complaintStore.getByNo(req.params.complaintNo);
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
    const items = await lineItemStore.getForComplaint(complaint.complaintNo);

    await audit.log({
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

    const cn = await creditNoteStore.create({
      complaintNo:       complaint.complaintNo,
      creditNoteNumber:  sapResult.CreditNoteNumber,
      sapDocumentNumber: sapResult.SapDocumentNumber,
      amount:            complaint.settlementValue,
      currency:          complaint.currency,

      raisedBy:          req.user.userId,
      raisedByName:      req.user.name,
      notifiedTo:        ["Marketing Head", "KAM", "Customer"],
    });

    await complaintStore.update(complaint.complaintNo, {
      creditNoteNumber: sapResult.CreditNoteNumber,
    });

    await audit.log({
      complaintNo: complaint.complaintNo,
      action:      `SAP Credit Note Created — ${sapResult.CreditNoteNumber}`,
      actorType:   "System",
      actorId:     "SYSTEM",
      actorRole:   "SAP Integration",
      remarks:     `SAP Document: ${sapResult.SapDocumentNumber}`,
    });

    await audit.log({
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
    await audit.log({
      complaintNo: complaint.complaintNo,
      action:      `SAP Credit Note Push FAILED: ${err.message}`,
      actorType:   "System",
      actorId:     "SYSTEM",
      actorRole:   "SAP Integration",
    });

    err.status = 502;
    err.publicMessage = "Credit note could not be raised in SAP. Please retry; if it persists, contact support.";
    next(err);
  }
});

router.get("/:complaintNo/audit-log", async (req, res) => {
  const complaint = await complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });
  if (await denyIfHidden(req, res, complaint)) return;
  const audit_data = require("../data/auditLog");
  res.json({
    complaintNo: complaint.complaintNo,
    currentStatus: complaint.status,
    entries: await audit_data.getForComplaint(complaint.complaintNo),
  });
});

router.get("/:complaintNo/status-sequence", async (req, res) => {
  const complaint = await complaintStore.getByNo(req.params.complaintNo);
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });
  if (await denyIfHidden(req, res, complaint)) return;
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
