// =========================================================================
// TRANSACTIONAL DATA STORE  —  CCMS
// =========================================================================
// Source: Section 4 (Transactional Data), Section 6.3 (Sample Records),
//         Section 7.1 (Visit Records), Section 4 (CAPA, Credit Note).
//
// In-memory for development/demo.
// Swap this file for a real DB (MySQL / PostgreSQL / MongoDB) — nothing
// else in the project needs to change.
//
// Entities:
//   1. Complaints
//   2. Complaint Line Items   (per invoice × affected product)
//   3. Complaint Attachments  (photos / videos per line item)
//   4. Sample Records         (physical sample tracking — Section 6.3)
//   5. Visit Records          (customer location visits — Section 7.1)
//   6. CAPA Records           (corrective & preventive actions — Section 4)
//   7. Credit Notes           (SAP credit note — Section 4, 11.1)
// =========================================================================

const { v4: uuidv4 } = require("uuid");

// ──────────────────────────────────────────────────────────────────────────
// 1. COMPLAINTS
// ──────────────────────────────────────────────────────────────────────────
let complaints = [];
let complaintCounter = 1;

function generateComplaintNo() {
  return `COMP-${new Date().getFullYear()}-${String(complaintCounter++).padStart(5, "0")}`;
}

const complaintStore = {
  create(data) {
    const complaint = {
      complaintNo:          generateComplaintNo(),
      title:                data.title || "",
      remarks:              data.remarks || "",
      status:               "Logged",
      businessLine:         data.businessLine || null,
      invoiceNumber:        data.invoiceNumber,
      invoiceDate:          data.invoiceDate,
      invoiceValue:         parseFloat(data.invoiceValue || 0),
      currency:             data.currency || "INR",
      customerId:           data.customerId,
      customerName:         data.customerName || null,
      customerSegment:      data.customerSegment || null,
      isKeyAccount:         data.isKeyAccount || false,
      settlementValue:      parseFloat(data.settlementValue || 0),
      policyId:             data.policyId || null,
      policyFlag:           data.policyFlag || null,
      policyCompliance:     data.policyCompliance || null,
      policyClauseBreached: data.policyClauseBreached || null,
      policyForcesMdApproval: data.policyForcesMdApproval || false,
      sampleRequired:       data.sampleRequired || false,
      visitRequested:       data.visitRequested || false,
      reportedBy:           data.reportedBy || null,
      sapValidationPending: data._sapFallback || false,
      creditNoteNumber:     null,
      _priorStatus:         null,
      _customer:            data._customer || null,
      _latestSample:        null,
      createdAt:            new Date().toISOString(),
      updatedAt:            new Date().toISOString(),
      closedAt:             null,
    };
    complaints.push(complaint);
    return complaint;
  },

  getAll(filters = {}) {
    let list = complaints;
    if (filters.status)       list = list.filter((c) => c.status === filters.status);
    if (filters.customerId)   list = list.filter((c) => c.customerId === filters.customerId);
    if (filters.businessLine) list = list.filter((c) => c.businessLine === filters.businessLine);
    return list;
  },

  getByNo(complaintNo) {
    return complaints.find((c) => c.complaintNo === complaintNo) || null;
  },

  update(complaintNo, updates) {
    const c = this.getByNo(complaintNo);
    if (!c) return null;
    Object.assign(c, updates, { updatedAt: new Date().toISOString() });
    return c;
  },
};

// ──────────────────────────────────────────────────────────────────────────
// 2. COMPLAINT LINE ITEMS
// ──────────────────────────────────────────────────────────────────────────
let lineItems = [];

const lineItemStore = {
  create(data) {
    const item = {
      lineItemId:         uuidv4(),
      complaintNo:        data.complaintNo,
      invoiceNumber:      data.invoiceNumber,
      invoiceItemNo:      data.invoiceItemNo || null,
      sapMaterialNo:      data.sapMaterialNo || null,
      productName:        data.productName   || null,
      invoiceQty:         parseFloat(data.invoiceQty   || 0),
      unitPrice:          parseFloat(data.unitPrice     || 0),
      defectiveQty:       parseFloat(data.defectiveQty || 0),
      uom:                data.uom || "Ream",
      defectiveValue:     parseFloat(data.defectiveQty || 0) * parseFloat(data.unitPrice || 0), // auto-computed
      complaintTypeId:    data.complaintTypeId || null,
      complaintTypeName:  data.complaintTypeName || null,
      sampleRequired:     data.sampleRequired || false,
      createdAt:          new Date().toISOString(),
    };
    lineItems.push(item);
    return item;
  },

  getForComplaint(complaintNo) {
    return lineItems.filter((li) => li.complaintNo === complaintNo);
  },

  getById(lineItemId) {
    return lineItems.find((li) => li.lineItemId === lineItemId) || null;
  },

  getTotalDefectiveValue(complaintNo) {
    return lineItems
      .filter((li) => li.complaintNo === complaintNo)
      .reduce((sum, li) => sum + li.defectiveValue, 0);
  },
};

// ──────────────────────────────────────────────────────────────────────────
// 3. COMPLAINT ATTACHMENTS
// ──────────────────────────────────────────────────────────────────────────
let attachments = [];

const attachmentStore = {
  create(data) {
    const att = {
      attachmentId:  uuidv4(),
      complaintNo:   data.complaintNo,
      lineItemId:    data.lineItemId || null,
      fileReference: data.fileReference,
      fileType:      data.fileType || "photo",   // photo | video | document
      description:   data.description || "",
      uploadedBy:    data.uploadedBy || null,
      uploadedAt:    new Date().toISOString(),
      purged:        false,
      purgedAt:      null,
    };
    attachments.push(att);
    return att;
  },

  getForComplaint(complaintNo) {
    return attachments.filter((a) => a.complaintNo === complaintNo);
  },

  getForLineItem(lineItemId) {
    return attachments.filter((a) => a.lineItemId === lineItemId);
  },

  // Flag an attachment's file as purged (metadata retained for audit).
  // Used by the archival engine after the retention window elapses.
  markPurged(attachmentId) {
    const att = attachments.find((a) => a.attachmentId === attachmentId);
    if (!att) return null;
    att.purged = true;
    att.purgedAt = new Date().toISOString();
    return att;
  },
};

// ──────────────────────────────────────────────────────────────────────────
// 4. SAMPLE RECORDS  —  Section 6.3
// ──────────────────────────────────────────────────────────────────────────
let samples = [];

const SAMPLE_STATUSES = ["Awaited", "Received", "Under Testing", "Tested", "Disposed"];

const sampleStore = {
  create(data) {
    const sample = {
      sampleId:           uuidv4(),
      complaintNo:        data.complaintNo,
      lineItemId:         data.lineItemId || null,
      sampleTypeId:       data.sampleTypeId,
      sampleTypeName:     data.sampleTypeName || null,
      dispatchMode:       data.dispatchMode || "Courier",   // Courier | Hand Delivery | Field Pickup
      dispatchedDate:     data.dispatchedDate || null,
      receivedDate:       null,
      receivedBy:         null,
      sampleStatus:       "Awaited",
      testResult:         null,                             // Pass | Fail | Inconclusive
      testResultNotes:    null,
      testReportReference: null,
      disposalDate:       null,
      createdAt:          new Date().toISOString(),
      updatedAt:          new Date().toISOString(),
    };
    samples.push(sample);
    return sample;
  },

  getForComplaint(complaintNo) {
    return samples.filter((s) => s.complaintNo === complaintNo);
  },

  getById(sampleId) {
    return samples.find((s) => s.sampleId === sampleId) || null;
  },

  getLatestForComplaint(complaintNo) {
    const list = this.getForComplaint(complaintNo);
    return list.length ? list[list.length - 1] : null;
  },

  update(sampleId, updates) {
    const s = this.getById(sampleId);
    if (!s) return null;
    Object.assign(s, updates, { updatedAt: new Date().toISOString() });
    return s;
  },
};

// ──────────────────────────────────────────────────────────────────────────
// 5. VISIT RECORDS  —  Section 7.1
// ──────────────────────────────────────────────────────────────────────────
let visits = [];

const VISIT_STATUSES = ["Planned", "Completed", "Cancelled"];

const visitStore = {
  create(data) {
    const visit = {
      visitId:                    uuidv4(),
      complaintNo:                data.complaintNo,
      visitType:                  data.visitType || "Optional",   // Mandatory | Optional
      triggerReason:              data.triggerReason || null,
      scheduledDate:              data.scheduledDate || null,
      assignedTo:                 data.assignedTo || null,        // userId
      visitStatus:                "Planned",
      visitDate:                  null,
      findings:                   null,
      customerAcknowledgement:    null,
      outcome:                    null,                           // Resolved On-Site | Escalation Confirmed | No Further Action
      createdAt:                  new Date().toISOString(),
      updatedAt:                  new Date().toISOString(),
    };
    visits.push(visit);
    return visit;
  },

  getForComplaint(complaintNo) {
    return visits.filter((v) => v.complaintNo === complaintNo);
  },

  getById(visitId) {
    return visits.find((v) => v.visitId === visitId) || null;
  },

  update(visitId, updates) {
    const v = this.getById(visitId);
    if (!v) return null;
    Object.assign(v, updates, { updatedAt: new Date().toISOString() });
    return v;
  },
};

// ──────────────────────────────────────────────────────────────────────────
// 6. CAPA RECORDS  —  Section 4
// ──────────────────────────────────────────────────────────────────────────
let capas = [];

const capaStore = {
  create(data) {
    const capa = {
      capaId:              uuidv4(),
      complaintNo:         data.complaintNo,
      rootCauseDescription: data.rootCauseDescription || "",
      correctiveAction:    data.correctiveAction || "",
      preventiveAction:    data.preventiveAction || "",
      documentedBy:        data.documentedBy || null,   // Operations user ID
      documentedByName:    data.documentedByName || null,
      documentedDate:      new Date().toISOString(),
      sampleTestReference: data.sampleTestReference || null,
    };
    capas.push(capa);
    return capa;
  },

  getForComplaint(complaintNo) {
    return capas.filter((c) => c.complaintNo === complaintNo);
  },

  getById(capaId) {
    return capas.find((c) => c.capaId === capaId) || null;
  },
};

// ──────────────────────────────────────────────────────────────────────────
// 7. CREDIT NOTES  —  Section 4 + SAP Integration touchpoints 5 & 6
// ──────────────────────────────────────────────────────────────────────────
let creditNotes = [];

const creditNoteStore = {
  create(data) {
    const cn = {
      creditNoteId:       uuidv4(),
      complaintNo:        data.complaintNo,
      creditNoteNumber:   data.creditNoteNumber,      // from SAP
      sapDocumentNumber:  data.sapDocumentNumber || data.creditNoteNumber,
      amount:             parseFloat(data.amount || 0),
      currency:           data.currency || "INR",
      raisedBy:           data.raisedBy || null,      // Finance user ID
      raisedByName:       data.raisedByName || null,
      raisedDate:         new Date().toISOString(),
      notifiedTo:         data.notifiedTo || [],      // [Marketing Head, KAM, Customer]
    };
    creditNotes.push(cn);
    return cn;
  },

  getForComplaint(complaintNo) {
    return creditNotes.filter((cn) => cn.complaintNo === complaintNo);
  },
};

module.exports = {
  complaintStore,
  lineItemStore,
  attachmentStore,
  sampleStore,
  visitStore,
  capaStore,
  creditNoteStore,
  SAMPLE_STATUSES,
  VISIT_STATUSES,
};
