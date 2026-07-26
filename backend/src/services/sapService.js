const fetch = require("node-fetch");
require("dotenv").config();
const masterData = require("../data/masterData");

const USE_MOCK = process.env.SAP_USE_MOCK !== "false";
const BASE_URL = process.env.SAP_BASE_URL;
let mockCreditNoteCounter = 5000001;

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

async function fetchCsrfToken(serviceUrl) {
  const res = await fetch(serviceUrl, {
    headers: { ...authHeader(), "X-CSRF-Token": "Fetch" },
  });
  const token = res.headers.get("x-csrf-token");
  if (!token) throw new Error("SAP did not return a CSRF token. Check service URL and auth.");
  return token;
}

async function getInvoice(invoiceNumber) {
  if (USE_MOCK) {
    const inv = masterData.invoices[invoiceNumber];
    if (!inv) throw new Error(`Invoice ${invoiceNumber} not found in SAP`);

    return JSON.parse(JSON.stringify(inv));
  }

  const serviceBase = `${BASE_URL}/${process.env.SAP_BILLING_SERVICE}`;

  const hdrUrl = `${serviceBase}/A_BillingDocument('${invoiceNumber}')?$format=json`;
  const hdrRes = await fetch(hdrUrl, { headers: authHeader() });
  if (!hdrRes.ok) throw new Error(`SAP Invoice header fetch failed: HTTP ${hdrRes.status}`);
  const hdrJson = await hdrRes.json();
  const header = hdrJson.d;

  const itmUrl = `${serviceBase}/A_BillingDocument('${invoiceNumber}')/to_Item?$format=json`;
  const itmRes = await fetch(itmUrl, { headers: authHeader() });
  if (!itmRes.ok) throw new Error(`SAP Invoice items fetch failed: HTTP ${itmRes.status}`);
  const itmJson = await itmRes.json();
  header.lineItems = itmJson.d.results;

  return header;
}

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

async function runMasterDataBatchSync() {
  const results = { timestamp: new Date().toISOString(), synced: {}, errors: {} };

  try {
    const policies = await getSalesPolicies();
    results.synced.salesPolicies = policies.length;
  } catch (e) {
    results.errors.salesPolicies = e.message;
  }

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
