// =========================================================================
// MASTER DATA  —  Orient Paper & Mill CCMS
// =========================================================================
// Source: Section 3 (Customers, Users, Roles, Products, Invoices,
//         Complaint Types, Departments), Section 6.2 (Sample Types),
//         Section 9.1 (Sales Policies) of the CCMS Data Classification
//         Report & Addendum.
//
// In production these are seeded/synced from SAP (nightly batch for
// Customer, Product, Sales Policy per Section 11.1). Invoice data is
// fetched in real-time at complaint creation.
// =========================================================================

// ─── 1. CUSTOMERS / DISTRIBUTORS ─────────────────────────────────────────
// Synced nightly from SAP Business Partner (API_BUSINESS_PARTNER).
// Each customer sees ONLY their own invoices (data-isolation rule, Section 5).
const customers = [
  {
    customerId: "1000123",
    name: "Shree Distributors Pvt Ltd",
    type: "Distributor",                // Customer | Distributor
    region: "Central India",
    segment: "Distributor-Standard",    // Used for Sales Policy match
    businessLine: "Paper",
    contactPerson: "Ramesh Sharma",
    email: "accounts@shreedist.example.com",
    phone: "9876543210",
    city: "Bhopal",
    state: "Madhya Pradesh",
    gstNumber: "23AAACS1234A1Z5",
    isKeyAccount: false,
    sapBusinessPartner: "1000123",
    appAccess: "mobile",
    active: true,
  },
  {
    customerId: "1000456",
    name: "Anand Traders",
    type: "Customer",
    region: "Western India",
    segment: "Customer-KeyAccount",
    businessLine: "Paper",
    contactPerson: "Suresh Anand",
    email: "finance@anandtraders.example.com",
    phone: "9988776655",
    city: "Surat",
    state: "Gujarat",
    gstNumber: "24AAAAA0000A1Z5",
    isKeyAccount: true,
    sapBusinessPartner: "1000456",
    appAccess: "mobile",
    active: true,
  },
  {
    customerId: "2000001",
    name: "PetroChemicals Ltd",
    type: "Customer",
    region: "Northern India",
    segment: "Customer-Standard",
    businessLine: "Chemical",
    contactPerson: "Anil Kumar",
    email: "purchase@petrochemicals.example.com",
    phone: "9112233445",
    city: "Noida",
    state: "Uttar Pradesh",
    gstNumber: "09AABCP1234R1ZC",
    isKeyAccount: false,
    sapBusinessPartner: "2000001",
    appAccess: "mobile",
    active: true,
  },
  {
    customerId: "2000002",
    name: "National Packaging Co.",
    type: "Distributor",
    region: "Eastern India",
    segment: "Distributor-Premium",
    businessLine: "Paper",
    contactPerson: "Debashish Roy",
    email: "info@natpack.example.com",
    phone: "9033445566",
    city: "Kolkata",
    state: "West Bengal",
    gstNumber: "19AABCN9876Q1ZD",
    isKeyAccount: true,
    sapBusinessPartner: "2000002",
    appAccess: "mobile",
    active: true,
  },
];

// ─── 2. USERS ─────────────────────────────────────────────────────────────
// Internal staff. Web App access. Role determines workflow authority.
// Passwords are bcrypt hashes. Plain-text for dev/testing shown in comments.
// Default password for all users: Orient@123
// Admin (U000): Admin@456
const users = [
  { userId: "U001", name: "Priya Mehta",    department: "D001", roleId: "R001", email: "priya.mehta@orientpaper.com",    password: "$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a", active: true },
  { userId: "U002", name: "Kiran Joshi",    department: "D001", roleId: "R002", email: "kiran.joshi@orientpaper.com",    password: "$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a", active: true },
  { userId: "U003", name: "Amit Verma",     department: "D002", roleId: "R003", email: "amit.verma@orientpaper.com",     password: "$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a", active: true },
  { userId: "U004", name: "Neha Singh",     department: "D002", roleId: "R004", email: "neha.singh@orientpaper.com",     password: "$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a", active: true },
  { userId: "U005", name: "Rajesh Gupta",   department: "D003", roleId: "R005", email: "rajesh.gupta@orientpaper.com",   password: "$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a", active: true },
  { userId: "U006", name: "Sanjay Patel",   department: "D003", roleId: "R006", email: "sanjay.patel@orientpaper.com",   password: "$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a", active: true },
  { userId: "U007", name: "Deepa Nair",     department: "D004", roleId: "R007", email: "deepa.nair@orientpaper.com",     password: "$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a", active: true },
  { userId: "U008", name: "Vikram Rao",     department: "D004", roleId: "R008", email: "vikram.rao@orientpaper.com",     password: "$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a", active: true },
  { userId: "U009", name: "Sumedha Iyer",   department: "D005", roleId: "R009", email: "sumedha.iyer@orientpaper.com",   password: "$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a", active: true },
  { userId: "U010", name: "Anand Kulkarni", department: "D006", roleId: "R010", email: "anand.kulkarni@orientpaper.com", password: "$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a", active: true },
  { userId: "U011", name: "Mohan Das",      department: "D007", roleId: "R011", email: "mohan.das@orientpaper.com",      password: "$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a", active: true },
  // Admin user — full access, no department restriction
  { userId: "U000", name: "CCMS Admin",     department: null,   roleId: "R000", email: "admin@orientpaper.com",          password: "$2a$10$LGAEcXXIqJUjC9t1kFFdaOhUuvZyXf4vjIvTjI.l2VYmv.TpTgNnK", active: true },
];

// ─── 3. ROLES ─────────────────────────────────────────────────────────────
// Role determines which status transitions a user can execute (RBAC).
const roles = [
  { roleId: "R000", roleName: "Admin",                  department: null,   canApprove: true,  canForward: true,  canReject: true,  level: 99 },
  { roleId: "R001", roleName: "TS Officer",             department: "D001", canApprove: false, canForward: true,  canReject: true,  level: 1 },
  { roleId: "R002", roleName: "TS Head",                department: "D001", canApprove: true,  canForward: true,  canReject: true,  level: 2 },
  { roleId: "R003", roleName: "QC Analyst",             department: "D002", canApprove: false, canForward: true,  canReject: true,  level: 1 },
  { roleId: "R004", roleName: "QC Manager",             department: "D002", canApprove: true,  canForward: true,  canReject: true,  level: 2 },
  { roleId: "R005", roleName: "Operations Analyst",     department: "D003", canApprove: false, canForward: true,  canReject: true,  level: 1 },
  { roleId: "R006", roleName: "Operations Head",        department: "D003", canApprove: true,  canForward: true,  canReject: true,  level: 3 },
  { roleId: "R007", roleName: "Product Manager",        department: "D004", canApprove: false, canForward: true,  canReject: true,  level: 1 },
  { roleId: "R008", roleName: "Marketing Head",         department: "D004", canApprove: true,  canForward: true,  canReject: true,  level: 3 },
  { roleId: "R009", roleName: "Managing Director",      department: "D005", canApprove: true,  canForward: true,  canReject: true,  level: 4 },
  { roleId: "R010", roleName: "Finance Officer",        department: "D006", canApprove: true,  canForward: true,  canReject: true,  level: 2 },
  { roleId: "R011", roleName: "Sales/KAM",              department: "D007", canApprove: false, canForward: true,  canReject: false, level: 1 },
];

// ─── 4. DEPARTMENTS ──────────────────────────────────────────────────────
const departments = [
  { departmentId: "D001", departmentName: "Technical Services (TS)", code: "TS" },
  { departmentId: "D002", departmentName: "Quality Control (QC)",    code: "QC" },
  { departmentId: "D003", departmentName: "Operations",              code: "OPS" },
  { departmentId: "D004", departmentName: "Marketing",               code: "MKT" },
  { departmentId: "D005", departmentName: "Managing Director Office", code: "MD" },
  { departmentId: "D006", departmentName: "Finance",                 code: "FIN" },
  { departmentId: "D007", departmentName: "Sales",                   code: "SLS" },
];

// ─── 5. PRODUCTS / SKUs ──────────────────────────────────────────────────
// Synced nightly from SAP Material Master (API_PRODUCT_SRV).
// Product category drives routing to the correct Product Manager at Stage 5.
const products = [
  { productId: "P001", productName: "Maplitho Paper 70 GSM A4",      category: "Paper",    uom: "Ream",  businessLine: "Paper",    sapMaterialNo: "MAT-1001", active: true },
  { productId: "P002", productName: "Copier Paper 80 GSM A4",        category: "Paper",    uom: "Ream",  businessLine: "Paper",    sapMaterialNo: "MAT-1002", active: true },
  { productId: "P003", productName: "Kraft Paper Roll 110 GSM",      category: "Paper",    uom: "Tonne", businessLine: "Paper",    sapMaterialNo: "MAT-1003", active: true },
  { productId: "P004", productName: "Newsprint Roll 45 GSM",         category: "Paper",    uom: "Tonne", businessLine: "Paper",    sapMaterialNo: "MAT-1004", active: true },
  { productId: "P005", productName: "Caustic Soda Lye 48% (IBC)",    category: "Chemical", uom: "MT",    businessLine: "Chemical", sapMaterialNo: "MAT-2001", active: true },
  { productId: "P006", productName: "Chlorine Gas (Cylinder)",        category: "Chemical", uom: "Cylinder", businessLine: "Chemical", sapMaterialNo: "MAT-2002", active: true },
  { productId: "P007", productName: "Sodium Hypochlorite 12% (Drum)","category": "Chemical", uom: "Drum", businessLine: "Chemical", sapMaterialNo: "MAT-2003", active: true },
];

// ─── 6. INVOICES ─────────────────────────────────────────────────────────
// In production: fetched real-time from SAP (API_BILLING_DOCUMENT_SRV).
// This mock mirrors the exact OData field structure SAP returns.
const invoices = {
  "90001234": {
    BillingDocument:     "90001234",
    BillingDocumentDate: "2026-05-12",
    SoldToParty:         "1000123",
    PaymentTerms:        "NT30",
    NetAmount:           "45000.00",
    TransactionCurrency: "INR",
    lineItems: [
      { BillingDocumentItem: "10", Material: "MAT-1002", MaterialDescription: "Copier Paper 80 GSM A4", BillingQuantity: 500, BillingQuantityUnit: "Ream", NetAmount: "45000.00", NetPriceAmount: "90.00" },
    ],
  },
  "90005678": {
    BillingDocument:     "90005678",
    BillingDocumentDate: "2026-06-02",
    SoldToParty:         "1000456",
    PaymentTerms:        "NT45",
    NetAmount:           "128500.00",
    TransactionCurrency: "INR",
    lineItems: [
      { BillingDocumentItem: "10", Material: "MAT-1001", MaterialDescription: "Maplitho Paper 70 GSM A4", BillingQuantity: 1000, BillingQuantityUnit: "Ream", NetAmount: "80000.00", NetPriceAmount: "80.00" },
      { BillingDocumentItem: "20", Material: "MAT-1004", MaterialDescription: "Newsprint Roll 45 GSM",    BillingQuantity: 2,    BillingQuantityUnit: "Tonne", NetAmount: "48500.00", NetPriceAmount: "24250.00" },
    ],
  },
  "90009999": {
    BillingDocument:     "90009999",
    BillingDocumentDate: "2026-04-20",
    SoldToParty:         "2000001",
    PaymentTerms:        "NT60",
    NetAmount:           "175000.00",
    TransactionCurrency: "INR",
    lineItems: [
      { BillingDocumentItem: "10", Material: "MAT-2001", MaterialDescription: "Caustic Soda Lye 48%", BillingQuantity: 5, BillingQuantityUnit: "MT", NetAmount: "175000.00", NetPriceAmount: "35000.00" },
    ],
  },
};

// ─── 7. COMPLAINT TYPES ───────────────────────────────────────────────────
// Nature of complaint options selectable per line item (Stage 1).
const complaintTypes = [
  { typeId: "CT01", typeName: "Quality Defect",          businessLine: "Both",     sampleRequired: true,  defaultSampleType: "ST01" },
  { typeId: "CT02", typeName: "Size / Dimension Mismatch", businessLine: "Paper",   sampleRequired: false, defaultSampleType: null },
  { typeId: "CT03", typeName: "Torn / Damaged",          businessLine: "Paper",     sampleRequired: true,  defaultSampleType: "ST02" },
  { typeId: "CT04", typeName: "Short Supply",            businessLine: "Both",      sampleRequired: false, defaultSampleType: null },
  { typeId: "CT05", typeName: "Wrong Product Supplied",  businessLine: "Both",      sampleRequired: true,  defaultSampleType: "ST01" },
  { typeId: "CT06", typeName: "Contamination",           businessLine: "Chemical",  sampleRequired: true,  defaultSampleType: "ST03" },
  { typeId: "CT07", typeName: "Packing Defect",          businessLine: "Both",      sampleRequired: true,  defaultSampleType: "ST04" },
  { typeId: "CT08", typeName: "Moisture / Dampness",     businessLine: "Paper",     sampleRequired: true,  defaultSampleType: "ST01" },
  { typeId: "CT09", typeName: "Colour / Shade Variation","businessLine": "Paper",   sampleRequired: true,  defaultSampleType: "ST02" },
  { typeId: "CT10", typeName: "Billing Error",           businessLine: "Both",      sampleRequired: false, defaultSampleType: null },
];

// ─── 8. SAMPLE TYPES ─────────────────────────────────────────────────────
// Section 6.2 — New master data entity.
const sampleTypes = [
  { sampleTypeId: "ST01", sampleTypeName: "Paper Roll Cutting",       applicableBusinessLine: "Paper",    defaultRequired: true  },
  { sampleTypeId: "ST02", sampleTypeName: "Ream Sample",              applicableBusinessLine: "Paper",    defaultRequired: true  },
  { sampleTypeId: "ST03", sampleTypeName: "Chemical Drum Sample",     applicableBusinessLine: "Chemical", defaultRequired: true  },
  { sampleTypeId: "ST04", sampleTypeName: "Packaging Sample",         applicableBusinessLine: "Both",     defaultRequired: true  },
  { sampleTypeId: "ST05", sampleTypeName: "Lab Reference Sample",     applicableBusinessLine: "Chemical", defaultRequired: false },
];

// ─── 9. SALES POLICIES ───────────────────────────────────────────────────
// Section 9.1 — New master data entity. Synced nightly from SAP pricing
// condition records (API_SLSPRICINGCONDITIONRECORD_SRV).
const salesPolicies = [
  {
    policyId: "SP01",
    policyName: "Standard Paper Return Policy 2026",
    businessLine: "Paper",
    applicableSegment: "Customer-Standard",
    applicableRegion: "All",
    maxSettlementPct: 80,           // % of invoice value that can be credited without override
    complaintWindowDays: 30,        // days from invoice date to raise complaint
    linkedDiscountScheme: null,
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    approvalOverrideOnBreach: true, // forces MD approval if policy breached regardless of settlement amount
  },
  {
    policyId: "SP02",
    policyName: "Key Account Premium Policy 2026",
    businessLine: "Paper",
    applicableSegment: "Customer-KeyAccount",
    applicableRegion: "All",
    maxSettlementPct: 100,
    complaintWindowDays: 45,
    linkedDiscountScheme: "KA-SCHEME-2026",
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    approvalOverrideOnBreach: true,
  },
  {
    policyId: "SP03",
    policyName: "Chemical Standard Policy 2026",
    businessLine: "Chemical",
    applicableSegment: "Customer-Standard",
    applicableRegion: "All",
    maxSettlementPct: 75,
    complaintWindowDays: 21,
    linkedDiscountScheme: null,
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    approvalOverrideOnBreach: true,
  },
  {
    policyId: "SP04",
    policyName: "Distributor Standard Policy 2026",
    businessLine: "Both",
    applicableSegment: "Distributor-Standard",
    applicableRegion: "All",
    maxSettlementPct: 85,
    complaintWindowDays: 30,
    linkedDiscountScheme: "DIST-REBATE-2026",
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    approvalOverrideOnBreach: false,
  },
  {
    policyId: "SP05",
    policyName: "Distributor Premium Policy 2026",
    businessLine: "Both",
    applicableSegment: "Distributor-Premium",
    applicableRegion: "All",
    maxSettlementPct: 100,
    complaintWindowDays: 60,
    linkedDiscountScheme: "DIST-PREMIUM-2026",
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    approvalOverrideOnBreach: false,
  },
];

// ─── LOOKUP HELPERS ───────────────────────────────────────────────────────

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
  customers, users, roles, departments, products, invoices,
  complaintTypes, sampleTypes, salesPolicies,
  findCustomer, findProduct, findProductById,
  findComplaintType, findSampleType, findUser,
  findUserByEmail, findRole,
  findApplicablePolicy, checkPolicyCompliance,
};
