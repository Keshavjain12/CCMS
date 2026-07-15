// =========================================================================
// MASTER DATA  —  CCMS
// =========================================================================
// Source: Section 3 (Master Data), Section 6.2 (Sample Types),
//         Section 9.1 (Sales Policies).
//
// Backed by PostgreSQL, cached in memory.
//
// Why a cache: master data is small (a few hundred rows), changes only via
// the nightly SAP sync, and is read on virtually every request. Loading it
// once at boot keeps every accessor SYNCHRONOUS, so the policy engine, SAP
// service and RBAC layer stay exactly as they were. Postgres remains the
// source of truth; call reload() after a SAP sync to refresh.
//
// Entities:
//   1. Customers / Distributors   2. Users        3. Roles
//   4. Departments                5. Products     6. Invoices
//   7. Complaint Types            8. Sample Types 9. Sales Policies
// =========================================================================

const db = require("../db/pool");

// Exported containers are mutated IN PLACE on load — never reassigned —
// so modules that captured a reference at require() time stay correct.
const customers      = [];
const users          = [];
const roles          = [];
const departments    = [];
const products       = [];
const complaintTypes = [];
const sampleTypes    = [];
const salesPolicies  = [];
const invoices       = {};   // keyed by invoice number, in SAP OData shape

let loaded = false;

function refill(target, rows) {
  target.length = 0;
  rows.forEach((r) => target.push(r));
}

/**
 * Hydrate every master entity from Postgres. Called once at boot (see
 * server.js) and again after a SAP master-data sync.
 */
async function load() {
  refill(departments, await db.many(`
    SELECT department_id AS "departmentId", department_name AS "departmentName", code
    FROM departments ORDER BY department_id`));

  refill(roles, await db.many(`
    SELECT role_id AS "roleId", role_name AS "roleName", department_id AS "department",
           can_approve AS "canApprove", can_forward AS "canForward",
           can_reject AS "canReject", level
    FROM roles ORDER BY role_id`));

  refill(users, await db.many(`
    SELECT user_id AS "userId", name, department_id AS "department", role_id AS "roleId",
           email, password_hash AS "password", active
    FROM users ORDER BY user_id`));

  refill(customers, await db.many(`
    SELECT customer_id AS "customerId", name, type, region, segment,
           business_line AS "businessLine", contact_person AS "contactPerson",
           email, phone, city, state, gst_number AS "gstNumber",
           is_key_account AS "isKeyAccount", sap_business_partner AS "sapBusinessPartner",
           app_access AS "appAccess", active
    FROM customers ORDER BY customer_id`));

  refill(products, await db.many(`
    SELECT product_id AS "productId", product_name AS "productName", category, uom,
           business_line AS "businessLine", sap_material_no AS "sapMaterialNo", active
    FROM products ORDER BY product_id`));

  refill(sampleTypes, await db.many(`
    SELECT sample_type_id AS "sampleTypeId", sample_type_name AS "sampleTypeName",
           applicable_business_line AS "applicableBusinessLine",
           default_required AS "defaultRequired"
    FROM sample_types ORDER BY sample_type_id`));

  refill(complaintTypes, await db.many(`
    SELECT type_id AS "typeId", type_name AS "typeName", business_line AS "businessLine",
           sample_required AS "sampleRequired", default_sample_type_id AS "defaultSampleType"
    FROM complaint_types ORDER BY type_id`));

  refill(salesPolicies, await db.many(`
    SELECT policy_id AS "policyId", policy_name AS "policyName",
           business_line AS "businessLine", applicable_segment AS "applicableSegment",
           applicable_region AS "applicableRegion", max_settlement_pct AS "maxSettlementPct",
           complaint_window_days AS "complaintWindowDays",
           linked_discount_scheme AS "linkedDiscountScheme",
           valid_from AS "validFrom", valid_to AS "validTo",
           approval_override_on_breach AS "approvalOverrideOnBreach"
    FROM sales_policies ORDER BY policy_id`));

  // Invoices are rebuilt into the exact SAP OData shape sapService expects,
  // keyed by invoice number, with line items nested under `lineItems`.
  const invRows = await db.many(`
    SELECT invoice_number, to_char(invoice_date, 'YYYY-MM-DD') AS invoice_date,
           sold_to_party, payment_terms, net_amount, currency
    FROM invoices ORDER BY invoice_number`);
  const itemRows = await db.many(`
    SELECT invoice_number, invoice_item_no, sap_material_no, material_description,
           billing_qty, uom, net_amount, unit_price
    FROM invoice_line_items ORDER BY invoice_number, invoice_item_no`);

  Object.keys(invoices).forEach((k) => delete invoices[k]);
  for (const r of invRows) {
    invoices[r.invoice_number] = {
      BillingDocument:     r.invoice_number,
      BillingDocumentDate: r.invoice_date,
      SoldToParty:         r.sold_to_party,
      PaymentTerms:        r.payment_terms,
      NetAmount:           r.net_amount.toFixed(2),
      TransactionCurrency: r.currency,
      lineItems: [],
    };
  }
  for (const it of itemRows) {
    const inv = invoices[it.invoice_number];
    if (!inv) continue;
    inv.lineItems.push({
      BillingDocumentItem:  it.invoice_item_no,
      Material:             it.sap_material_no,
      MaterialDescription:  it.material_description,
      BillingQuantity:      it.billing_qty,
      BillingQuantityUnit:  it.uom,
      NetAmount:            it.net_amount.toFixed(2),
      NetPriceAmount:       it.unit_price.toFixed(2),
    });
  }

  loaded = true;
  return {
    customers: customers.length, users: users.length, roles: roles.length,
    departments: departments.length, products: products.length,
    invoices: Object.keys(invoices).length, complaintTypes: complaintTypes.length,
    sampleTypes: sampleTypes.length, salesPolicies: salesPolicies.length,
  };
}

function isLoaded() { return loaded; }

// ─── LOOKUP HELPERS ───────────────────────────────────────────────────────
// All synchronous — they read the in-memory cache.

function findCustomer(customerId) {
  return customers.find((c) => c.customerId === customerId) || null;
}

function findProduct(sapMaterialNo) {
  return products.find((p) => p.sapMaterialNo === sapMaterialNo) || null;
}

function findProductById(productId) {
  return products.find((p) => p.productId === productId) || null;
}

function findComplaintType(typeId) {
  return complaintTypes.find((c) => c.typeId === typeId) || null;
}

function findSampleType(sampleTypeId) {
  return sampleTypes.find((s) => s.sampleTypeId === sampleTypeId) || null;
}

function findUser(userId) {
  return users.find((u) => u.userId === userId) || null;
}

function findUserByEmail(email) {
  if (!email) return null;
  const target = String(email).toLowerCase();
  return users.find((u) => u.email.toLowerCase() === target) || null;
}

function findRole(roleId) {
  return roles.find((r) => r.roleId === roleId) || null;
}

/**
 * Find the applicable Sales Policy for a complaint at Stage 1.
 * Matches on businessLine + customer segment. Returns best match.
 */
function findApplicablePolicy(businessLine, customerSegment) {
  return salesPolicies.find(
    (p) =>
      (p.businessLine === businessLine || p.businessLine === "Both") &&
      p.applicableSegment === customerSegment
  ) || null;
}

/**
 * Check policy compliance for a given settlement value and invoice date.
 * Returns { compliant, flag, clauseBreached }
 */
function checkPolicyCompliance(policy, invoiceDate, settlementValue, invoiceValue) {
  if (!policy) return { compliant: true, flag: "No Policy Found", clauseBreached: null };

  const invoiceDays = Math.floor((Date.now() - new Date(invoiceDate)) / 86400000);
  if (invoiceDays > policy.complaintWindowDays) {
    return {
      compliant: false,
      flag: "Breach",
      clauseBreached: `Complaint filed ${invoiceDays} days after invoice; policy window is ${policy.complaintWindowDays} days`,
      forcesMdApproval: policy.approvalOverrideOnBreach,
    };
  }

  const settlementPct = (settlementValue / invoiceValue) * 100;
  if (settlementPct > policy.maxSettlementPct) {
    return {
      compliant: false,
      flag: "Breach",
      clauseBreached: `Settlement ${settlementPct.toFixed(1)}% of invoice exceeds policy ceiling of ${policy.maxSettlementPct}%`,
      forcesMdApproval: policy.approvalOverrideOnBreach,
    };
  }

  return { compliant: true, flag: "Within Policy", clauseBreached: null, forcesMdApproval: false };
}

module.exports = {
  load, reload: load, isLoaded,
  customers, users, roles, departments, products, invoices,
  complaintTypes, sampleTypes, salesPolicies,
  findCustomer, findProduct, findProductById,
  findComplaintType, findSampleType, findUser,
  findUserByEmail, findRole,
  findApplicablePolicy, checkPolicyCompliance,
};
