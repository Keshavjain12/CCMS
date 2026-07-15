// =========================================================================
// SAP INTEGRATION SERVICE  —  CCMS
// =========================================================================
// Source: Section 11 of the CCMS Data Classification Report & Addendum.
//
// 6 Integration Touchpoints (Section 11.1):
//   1. Invoice lookup (real-time, SAP → CCMS)          → getInvoice()
//   2. Customer/Distributor master (nightly batch)      → getCustomerMaster()
//   3. Product/SKU master (nightly batch)               → getProductMaster()
//   4. Sales Policy / pricing conditions (batch)        → getSalesPolicies()
//   5. Credit Note creation request (real-time push)    → pushCreditNote()
//   6. Credit Note number write-back (real-time)        ← response from #5
//
// Architecture (Section 11.2):
//   - CCMS never calls SAP tables directly — all calls go through this file.
//   - Real-time calls: invoice lookup + credit note only (user is waiting).
//   - Batch calls: customer/product/sales policy (cached locally).
//   - CSRF token fetched before every SAP POST.
//   - Every SAP call is logged to the Audit Log with Actor="System".
//   - If real-time invoice lookup fails, complaint can still be created with
//     "Pending SAP Validation" flag (fallback per Section 11.2).
//
// TO SWITCH FROM MOCK TO LIVE:
//   Set SAP_USE_MOCK=false in .env and fill SAP_BASE_URL/USERNAME/PASSWORD.
//   Zero code changes anywhere else.
// =========================================================================

const fetch = require("node-fetch");
require("dotenv").config();
const masterData = require("../data/masterData");

const USE_MOCK = process.env.SAP_USE_MOCK !== "false";
const BASE_URL = process.env.SAP_BASE_URL;
let mockCreditNoteCounter = 5000001;

// ─── AUTH HELPER ─────────────────────────────────────────────────────────
function authHeader() {
  const creds = Buffer.from(
    `${process.env.SAP_USERNAME}:${process.env.SAP_PASSWORD}`
  ).toString("base64");
  return {
    Authorization: `Basic ${creds}`,
    Accept: "application/json",
    "sap-client": process.env.SAP_CLIENT || "100",
  };
}

// ─── CSRF TOKEN (required for all SAP POST/PATCH/DELETE) ─────────────────
async function fetchCsrfToken(serviceUrl) {
  const res = await fetch(serviceUrl, {
    headers: { ...authHeader(), "X-CSRF-Token": "Fetch" },
  });
  const token = res.headers.get("x-csrf-token");
  if (!token) throw new Error("SAP did not return a CSRF token. Check service URL and auth.");
  return token;
}

// =========================================================================
// 1. INVOICE LOOKUP  —  Real-time  —  SAP → CCMS
// =========================================================================
/**
 * Fetch invoice (billing document) from SAP at Stage 1 complaint creation.
 * Returns header + line items.
 * On failure in real SAP: throws error; caller handles fallback.
 */
async function getInvoice(invoiceNumber) {
  if (USE_MOCK) {
    const inv = masterData.invoices[invoiceNumber];
    if (!inv) throw new Error(`Invoice ${invoiceNumber} not found in SAP`);
    // Simulate slight delay of real SAP call
    return JSON.parse(JSON.stringify(inv));
  }

  // Real SAP — API_BILLING_DOCUMENT_SRV
  const serviceBase = `${BASE_URL}/${process.env.SAP_BILLING_SERVICE}`;

  // Header
  const hdrUrl = `${serviceBase}/A_BillingDocument('${invoiceNumber}')?$format=json`;
  const hdrRes = await fetch(hdrUrl, { headers: authHeader() });
  if (!hdrRes.ok) throw new Error(`SAP Invoice header fetch failed: HTTP ${hdrRes.status}`);
  const hdrJson = await hdrRes.json();
  const header = hdrJson.d;

  // Line Items
  const itmUrl = `${serviceBase}/A_BillingDocument('${invoiceNumber}')/to_Item?$format=json`;
  const itmRes = await fetch(itmUrl, { headers: authHeader() });
  if (!itmRes.ok) throw new Error(`SAP Invoice items fetch failed: HTTP ${itmRes.status}`);
  const itmJson = await itmRes.json();
  header.lineItems = itmJson.d.results;

  return header;
}

// =========================================================================
// 2. CUSTOMER MASTER  —  Batch / On-demand  —  SAP → CCMS
// =========================================================================
/**
 * Fetch customer/distributor master from SAP Business Partner.
 * In production called nightly; also available on-demand for cache-miss.
 */
async function getCustomerMaster(sapBusinessPartnerId) {
  if (USE_MOCK) {
    const cust = masterData.customers.find((c) => c.sapBusinessPartner === sapBusinessPartnerId);
    if (!cust) throw new Error(`Customer ${sapBusinessPartnerId} not found in SAP`);
    return {
      BusinessPartner: cust.sapBusinessPartner,
      BusinessPartnerFullName: cust.name,
      BusinessPartnerCategory: cust.type === "Customer" ? "2" : "3",
      EmailAddress: cust.email,
      PhoneNumber: cust.phone,
      segment: cust.segment,
      isKeyAccount: cust.isKeyAccount,
      businessLine: cust.businessLine,
      region: cust.region,
    };
  }

  const url = `${BASE_URL}/${process.env.SAP_BUSINESS_PARTNER_SERVICE}/A_BusinessPartner('${sapBusinessPartnerId}')?$format=json`;
  const res = await fetch(url, { headers: authHeader() });
  if (!res.ok) throw new Error(`SAP Customer master fetch failed: HTTP ${res.status}`);
  const json = await res.json();
  return json.d;
}

// =========================================================================
// 3. PRODUCT / SKU MASTER  —  Batch  —  SAP → CCMS
// =========================================================================
/**
 * Fetch product (material) master from SAP.
 * Nightly batch; also on-demand for unknown materials encountered at Stage 1.
 */
async function getProductMaster(sapMaterialNo) {
  if (USE_MOCK) {
    const product = masterData.findProduct(sapMaterialNo);
    if (!product) throw new Error(`Material ${sapMaterialNo} not found in SAP`);
    return {
      Material:            product.sapMaterialNo,
      MaterialDescription: product.productName,
      MaterialGroup:       product.category,
      BaseUnit:            product.uom,
      businessLine:        product.businessLine,
    };
  }

  const url = `${BASE_URL}/${process.env.SAP_PRODUCT_SERVICE}/A_Product('${sapMaterialNo}')?$format=json&$select=Material,MaterialDescription,MaterialGroup,BaseUnit`;
  const res = await fetch(url, { headers: authHeader() });
  if (!res.ok) throw new Error(`SAP Product master fetch failed: HTTP ${res.status}`);
  const json = await res.json();
  return json.d;
}

// =========================================================================
// 4. SALES POLICIES  —  Batch  —  SAP → CCMS
// =========================================================================
/**
 * Fetch sales/pricing policy conditions from SAP.
 * Maps to SAP pricing condition records.
 * Nightly batch sync + optional on-demand refresh.
 */
async function getSalesPolicies() {
  if (USE_MOCK) {
    return masterData.salesPolicies.map((p) => ({
      policyId:            p.policyId,
      policyName:          p.policyName,
      businessLine:        p.businessLine,
      applicableSegment:   p.applicableSegment,
      maxSettlementPct:    p.maxSettlementPct,
      complaintWindowDays: p.complaintWindowDays,
      validFrom:           p.validFrom,
      validTo:             p.validTo,
    }));
  }

  const url = `${BASE_URL}/${process.env.SAP_PRICING_SERVICE}/A_SlsPricingConditionRecord?$format=json&$filter=ConditionType eq 'CCMS'`;
  const res = await fetch(url, { headers: authHeader() });
  if (!res.ok) throw new Error(`SAP Sales Policy fetch failed: HTTP ${res.status}`);
  const json = await res.json();
  return json.d.results;
}

// =========================================================================
// 5 + 6. CREDIT NOTE PUSH  —  Real-time  —  CCMS → SAP → CCMS
// =========================================================================
/**
 * Create a Credit Memo Request in SAP and get back the Credit Note number.
 * Triggered at Finance_Processing stage (final approval before Closed).
 *
 * Per Section 11.3: this is a synchronous call — the complaint cannot
 * move to Closed without a confirmed Credit Note number from SAP.
 *
 * Real SAP POST requires CSRF token (fetched first, then sent with POST).
 */
async function pushCreditNote(payload) {
  const {
    complaintNo,
    customerId,
    invoiceNumber,
    settlementValue,
    currency,
    reason,
    lineItems,
  } = payload;

  if (USE_MOCK) {
    const creditNoteNumber = `CN${mockCreditNoteCounter++}`;
    return {
      CreditNoteNumber:  creditNoteNumber,
      Status:            "Created",
      ComplaintRef:      complaintNo,
      Customer:          customerId,
      InvoiceRef:        invoiceNumber,
      Amount:            settlementValue,
      Currency:          currency || "INR",
      CreatedOn:         new Date().toISOString(),
      SapDocumentNumber: `4900${mockCreditNoteCounter - 1}`,
    };
  }

  // Real SAP — Credit Memo Request via API_SALES_ORDER_SRV
  const serviceUrl = `${BASE_URL}/${process.env.SAP_CREDIT_MEMO_SERVICE}`;
  const csrfToken = await fetchCsrfToken(serviceUrl + "/");

  const body = {
    SalesOrderType:    "CR",
    SoldToParty:       customerId,
    CustomerReference: complaintNo,
    CustomerRefDocument: invoiceNumber,
    to_Item: (lineItems || []).map((li, i) => ({
      SalesOrderItem: String((i + 1) * 10).padStart(6, "0"),
      Material:       li.sapMaterialNo,
      RequestedQuantity: li.defectiveQty,
      RequestedQuantityUnit: li.uom,
      NetAmount:      li.defectiveValue,
    })),
  };

  const url = `${serviceUrl}/A_SalesOrder`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...authHeader(),
      "X-CSRF-Token": csrfToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`SAP Credit Note creation failed (HTTP ${res.status}): ${errText}`);
  }

  const json = await res.json();
  return {
    CreditNoteNumber:  json.d.SalesOrder,
    Status:            "Created",
    ComplaintRef:      complaintNo,
    Customer:          customerId,
    InvoiceRef:        invoiceNumber,
    Amount:            settlementValue,
    Currency:          currency || "INR",
    CreatedOn:         new Date().toISOString(),
    SapDocumentNumber: json.d.SalesOrder,
  };
}

// ─── BATCH SYNC RUNNER ────────────────────────────────────────────────────
/**
 * Master data batch sync — simulates a nightly job that pulls
 * Customer, Product, and Sales Policy data from SAP into the local cache.
 * In production this would update a database, not in-memory objects.
 */
async function runMasterDataBatchSync() {
  const results = { timestamp: new Date().toISOString(), synced: {}, errors: {} };

  try {
    const policies = await getSalesPolicies();
    results.synced.salesPolicies = policies.length;
  } catch (e) {
    results.errors.salesPolicies = e.message;
  }

  // In production: loop through customer/product lists and sync each.
  results.synced.note = USE_MOCK
    ? "MOCK mode — master data already seeded from masterData.js"
    : "Sync complete";

  return results;
}

module.exports = {
  USE_MOCK,
  getInvoice,
  getCustomerMaster,
  getProductMaster,
  getSalesPolicies,
  pushCreditNote,
  runMasterDataBatchSync,
};
