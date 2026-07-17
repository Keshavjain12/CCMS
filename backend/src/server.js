const express    = require("express");
const helmet     = require("helmet");
const rateLimit  = require("express-rate-limit");
const cors    = require("cors");
const morgan  = require("morgan");
const sap     = require("./services/sapService");
const { authenticate, requireRoles } = require("./middleware/auth");
const { paginate } = require("./utils/pagination");





const app = require("./utils/asyncRoute").protect(express());





const GLOBAL_VIEW_ROLES = ["R000", "R009"];

const ADMIN_ONLY = ["R000"];




if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);


app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },



  hsts: process.env.NODE_ENV === "production"
    ? { maxAge: 15552000, includeSubDomains: true }
    : false,
}));



if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    if (req.secure || req.headers["x-forwarded-proto"] === "https") return next();
    res.status(403).json({ error: "HTTPS is required." });
  });
}


const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX || "500"),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: "Too many requests — rate limit exceeded. Try again in 15 minutes." },
});
app.use(globalLimiter);


const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      parseInt(process.env.AUTH_RATE_LIMIT_MAX || "20"),
  message:  { error: "Too many login attempts. Please wait 15 minutes before trying again." },
});






const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));

app.use(require("cookie-parser")());
app.use(morgan("dev"));


app.use("/api/auth", authLimiter, require("./routes/auth"));


app.use("/api/master-data",  authenticate, require("./routes/masterData"));
app.use("/api/complaints",   authenticate, require("./routes/complaints"));


app.get("/api/audit-log", authenticate, requireRoles(GLOBAL_VIEW_ROLES), async (req, res, next) => {
  try {
    const entries = await require("./data/auditLog").getAll();
    res.json(paginate(entries, req.query, "entries"));
  } catch (err) {
    next(err);
  }
});


const notify = require("./services/notificationService");


const sla = require("./services/slaEngine");




app.get("/api/notifications", authenticate, requireRoles(GLOBAL_VIEW_ROLES), (req, res) => {
  const all = notify.getAllNotifications();
  const page = paginate(all, req.query, "notifications");
  res.json({
    mode:  notify.MODE,
    count: page.count,
    total: page.total,
    hasMore: page.hasMore,
    hint:  notify.MODE === "mock" ? "NOTIFY_MODE=mock — no real emails sent. Set NOTIFY_MODE=live + SMTP config to send real emails." : "NOTIFY_MODE=live — real emails are being sent.",
    notifications: page.notifications,
  });
});


app.get("/api/notifications/:complaintNo", authenticate, (req, res) => {
  const list = notify.getForComplaint(req.params.complaintNo);
  res.json({ complaintNo: req.params.complaintNo, count: list.length, notifications: list });
});


app.get("/", (req, res) => {
  res.json({
    system:   "Orient Paper & Mill — CCMS",
    sapMode:  sap.USE_MOCK ? "MOCK (no real SAP connection needed)" : "LIVE SAP",
    auth: "JWT in an httpOnly cookie — POST /api/auth/login to sign in",
    buildSpec: "Full spec — Sections 3-12 of CCMS Data Classification Report & Addendum",
    rbac: {
      description: "Section 12.3 — Role-Based Access Control enforced on all protected routes",
      loginEndpoint: "POST /api/auth/login  { email, password }",




      ...(process.env.NODE_ENV === "production"
        ? {}
        : { demoCredentials: "Development build — see README.md for the seeded sandbox logins." }),
    },
    entities: {
      masterData:    ["Customer/Distributor", "User", "Role", "Department", "Product/SKU", "Invoice", "Complaint Type", "Sample Type", "Sales Policy"],
      transactional: ["Complaint", "Line Item", "Attachment", "Sample Record", "Visit Record", "CAPA Record", "Credit Note"],
    },
    sapIntegrationTouchpoints: {
      "1_invoice_lookup":        "GET  /api/master-data/invoice/:invoiceNo  (real-time, SAP→CCMS)",
      "2_customer_master_batch": "POST /api/master-data/sap-sync             (nightly batch)",
      "3_product_master_batch":  "POST /api/master-data/sap-sync             (nightly batch)",
      "4_sales_policy_batch":    "POST /api/master-data/sap-sync             (nightly batch)",
      "5_credit_note_push":      "POST /api/complaints/:no/credit-note       (real-time, CCMS→SAP)",
      "6_credit_note_writeback": "Response from touchpoint 5                 (real-time, SAP→CCMS)",
    },
    workflowStatusSequence: [
      "Draft → Logged → TS_Review → QC_Review",
      "→ [Sample_Awaited if sample required]",
      "→ CAPA_Pending → Ops_Head_Approval → Marketing_Review → Marketing_Head_Approval",
      "→ [MD_Approval if settlement > ₹1L or policy breach]",
      "→ [Visit_Pending if key account or settlement > ₹50K]",
      "→ Finance_Processing → Closed",
    ],
    endpoints: {
      auth: {
        "POST /api/auth/login":  "Login — returns JWT token  { email, password }",
        "GET  /api/auth/me":     "Who am I? — returns current user + permissions",
        "POST /api/auth/logout": "Logout hint (discard token client-side)",
      },
      masterData: {
        "GET  /api/master-data/:entity":            "customers | users | roles | departments | products | complaintTypes | sampleTypes | salesPolicies",
        "GET  /api/master-data/invoice/:invoiceNo": "Real-time SAP invoice lookup",
        "POST /api/master-data/sap-sync":           "Trigger nightly master data batch sync (Admin only)",
        "GET  /api/master-data/policy-check":       "Check Sales Policy compliance for given params",
      },
      complaints: {
        "POST /api/complaints":                     "Stage 1: Create complaint — TS / Sales / Admin",
        "GET  /api/complaints":                     "List all complaints — any authenticated user",
        "GET  /api/complaints/:no":                 "Full complaint detail — any authenticated user",
        "POST /api/complaints/:no/action":          "Workflow action — role enforced per status (approve | reject | clarify | resolve_clarification | auto_close)",
        "POST /api/complaints/:no/line-items":      "Add line item",
        "POST /api/complaints/:no/attachments":     "Upload attachment",
        "POST /api/complaints/:no/samples":         "Create sample record — QC only",
        "PUT  /api/complaints/:no/samples/:id":     "Update sample status — QC only",
        "POST /api/complaints/:no/capa":            "Document CAPA — Operations only",
        "POST /api/complaints/:no/visits":          "Schedule visit — Sales/KAM or Finance",
        "PUT  /api/complaints/:no/visits/:id":      "Update visit outcome — Sales/KAM or Finance",
        "POST /api/complaints/:no/credit-note":     "Raise Credit Note in SAP — Finance only",
        "GET  /api/complaints/:no/audit-log":       "Audit trail — any authenticated user",
        "GET  /api/complaints/:no/status-sequence": "Status sequence & gate state — any authenticated user",
      },
    },




    testUsers: (process.env.NODE_ENV === "production" ? [
      { email: "admin@orientpaper.com",          role: "Admin (full access)" },
      { email: "kiran.joshi@orientpaper.com",    role: "TS Head — approves at TS_Review" },
      { email: "neha.singh@orientpaper.com",     role: "QC Manager — approves at QC_Review" },
      { email: "sanjay.patel@orientpaper.com",   role: "Operations Head — approves at Ops_Head_Approval" },
      { email: "vikram.rao@orientpaper.com",     role: "Marketing Head — approves at Marketing_Head_Approval" },
      { email: "sumedha.iyer@orientpaper.com",   role: "Managing Director — approves at MD_Approval" },
      { email: "mohan.das@orientpaper.com",      role: "Finance Officer — raises Credit Note" },
    ] : [
      { email: "admin@orientpaper.com",          password: "Admin@456",   role: "Admin (full access)" },
      { email: "kiran.joshi@orientpaper.com",    password: "Orient@123",  role: "TS Head — approves at TS_Review" },
      { email: "neha.singh@orientpaper.com",     password: "Orient@123",  role: "QC Manager — approves at QC_Review" },
      { email: "sanjay.patel@orientpaper.com",   password: "Orient@123",  role: "Operations Head — approves at Ops_Head_Approval" },
      { email: "vikram.rao@orientpaper.com",     password: "Orient@123",  role: "Marketing Head — approves at Marketing_Head_Approval" },
      { email: "sumedha.iyer@orientpaper.com",   password: "Orient@123",  role: "Managing Director — approves at MD_Approval" },
      { email: "mohan.das@orientpaper.com",      password: "Orient@123",  role: "Finance Officer — raises Credit Note" },
    ]),
  });
});


app.get("/api/sla/breaches", authenticate, requireRoles(GLOBAL_VIEW_ROLES), (req, res) => {
  const breaches = sla.getAllBreaches();
  res.json({
    count: breaches.length,
    slaConfig: {
      stageSLADays:   parseInt(process.env.STAGE_SLA_DAYS || "3"),
      sampleSLADays:  parseInt(process.env.SAMPLE_SLA_DAYS || "7"),
      clarifySLADays: parseInt(process.env.CLARIFY_SLA_DAYS || "30"),
    },
    breaches,
  });
});


const kpi = require("./services/kpiService");


app.get("/api/kpi", authenticate, async (req, res, next) => {
  try {
    const data = await kpi.computeKPIs(req.user);
    res.json(data);
  } catch (err) {
    next(err);
  }
});


app.get("/api/kpi/summary", authenticate, async (req, res, next) => {
  try {
    const data = await kpi.computeKPIs(req.user);
    res.json({
      generatedAt:    data.generatedAt,
      summary:        data.summary,
      slaCompliance:  data.slaCompliance,
      sapHealth:      data.sapHealth,
      topIssue:       data.pipeline[0] || null,
    });
  } catch (err) {
    next(err);
  }
});


app.get("/api/sla/breaches/:complaintNo", authenticate, (req, res) => {
  const breaches = sla.getBreachesForComplaint(req.params.complaintNo);
  res.json({ complaintNo: req.params.complaintNo, count: breaches.length, breaches });
});


app.post("/api/sla/check", authenticate, requireRoles(ADMIN_ONLY), async (req, res, next) => {
  try {
    const result = await sla.triggerManualCheck();
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});


const archive = require("./services/archivalService");


app.get("/api/archive", authenticate, requireRoles(ADMIN_ONLY), async (req, res) => {
  const complaints = await archive.getAllArchived();
  res.json({ count: complaints.length, complaints });
});


app.get("/api/archive/policy", authenticate, requireRoles(ADMIN_ONLY), async (req, res) => {
  res.json(await archive.getPolicy());
});


app.get("/api/archive/log", authenticate, requireRoles(ADMIN_ONLY), (req, res) => {
  const log = archive.getAllArchivalLog();
  res.json({ count: log.length, log });
});


app.get("/api/archive/:complaintNo", authenticate, requireRoles(ADMIN_ONLY), async (req, res) => {
  const c = await archive.getArchivedComplaint(req.params.complaintNo);
  if (!c) return res.status(404).json({ error: "Not found in archive" });
  res.json(c);
});


app.post("/api/archive/run", authenticate, requireRoles(ADMIN_ONLY), async (req, res, next) => {
  try {
    const result = await archive.runArchivalCheck();
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});


const rollout = require("./config/rollout");


app.get("/api/rollout", authenticate, requireRoles(ADMIN_ONLY), (req, res) => {
  res.json(rollout.getRolloutStatus());
});



const auditModule = require("./data/auditLog");
app.get("/api/audit-log/verify", authenticate, requireRoles(GLOBAL_VIEW_ROLES), async (req, res, next) => {
  try {
    res.json(await auditModule.verifyIntegrity());
  } catch (err) {
    next(err);
  }
});






app.use((err, req, res, next) => {
  console.error(`[API] ${req.method} ${req.originalUrl} — ${err.message}`);
  if (res.headersSent) return next(err);



  const inProd = process.env.NODE_ENV === "production";
  res.status(err.status || 500).json({
    error: err.publicMessage || (inProd ? "Internal server error" : err.message),
  });
});


const PORT = process.env.PORT || 3000;
const db = require("./db/pool");
const masterData = require("./data/masterData");





(async () => {
  try {
    const health = await db.healthcheck();
    const counts = await masterData.load();
    console.log(`\n🗄️  [DB] connected → ${health.database} (${health.version})`);
    console.log(`   master data loaded: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  } catch (err) {
    console.error("\n❌ [DB] startup failed:", err.message);
    console.error("   Check PGHOST/PGDATABASE/PGUSER/PGPASSWORD in .env, and that");
    console.error("   the schema is loaded:  psql -U postgres -d ccms -f db/schema.sql\n");
    process.exit(1);
  }

  app.listen(PORT, () => {

    sla.startSlaEngine();

    archive.startArchivalEngine();
    console.log(`\n╔══════════════════════════════════════════════════════╗`);
    console.log(`║  Orient Paper & Mill — CCMS                          ║`);
    console.log(`║  http://localhost:${PORT}                               ║`);
    console.log(`║  SAP Mode : ${sap.USE_MOCK ? "MOCK (safe to test)              " : "LIVE SAP                        "}║`);
    console.log(`║  Store    : PostgreSQL (persistent)                  ║`);
    console.log(`║  Auth     : JWT — POST /api/auth/login               ║`);
    console.log(`╚══════════════════════════════════════════════════════╝\n`);
  });
})();
