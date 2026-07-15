const express    = require("express");
const helmet     = require("helmet");
const rateLimit  = require("express-rate-limit");
const cors    = require("cors");
const morgan  = require("morgan");
const sap     = require("./services/sapService");
const { authenticate, requireRoles } = require("./middleware/auth");
const { paginate } = require("./utils/pagination");

const app = express();

// ── Company-wide oversight views (audit log, notification matrix, SLA board)
// expose data across every department. They must NOT be readable by every
// authenticated role — only Admin (R000) and the Managing Director (R009).
// This mirrors GLOBAL_VIEW_ROLES in the frontend js/roles.js.
const GLOBAL_VIEW_ROLES = ["R000", "R009"];
// Purely administrative surfaces (archive, rollout, manual engine triggers).
const ADMIN_ONLY = ["R000"];

// ── Section 12.6 — Security headers (HTTPS, XSS, MIME-sniff protection) ──
app.use(helmet({
  contentSecurityPolicy: false, // relax for API — frontend sets its own CSP
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// ── Section 12.6 — Rate limiting (concurrency/performance gate) ──────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      parseInt(process.env.RATE_LIMIT_MAX || "500"),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: "Too many requests — rate limit exceeded. Try again in 15 minutes." },
});
app.use(globalLimiter);

// Stricter limiter for auth endpoints (prevent brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      parseInt(process.env.AUTH_RATE_LIMIT_MAX || "20"),
  message:  { error: "Too many login attempts. Please wait 15 minutes before trying again." },
});

// CORS — lock to an explicit allow-list in production via CORS_ORIGIN
// (comma-separated origins). If unset, reflect any origin (fine for local dev
// since auth is a Bearer token, not a cookie, so CSRF isn't in play).
const corsOrigins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: corsOrigins.length ? corsOrigins : true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));
app.use(morgan("dev"));

// ── Public routes (no token needed) ──────────────────────────────────────
app.use("/api/auth", authLimiter, require("./routes/auth"));

// ── Protected routes (Bearer token required for all below) ───────────────
app.use("/api/master-data",  authenticate, require("./routes/masterData"));
app.use("/api/complaints",   authenticate, require("./routes/complaints"));

// Global audit log — restricted to Admin / MD (company-wide record).
app.get("/api/audit-log", authenticate, requireRoles(GLOBAL_VIEW_ROLES), (req, res) => {
  const all = require("./data/auditLog").getAll();
  const entries = Array.isArray(all) ? all : (all.entries || []);
  res.json(paginate(entries, req.query, "entries"));
});

// ── Notification log (Section 12.1) ──────────────────────────────────────
const notify = require("./services/notificationService");

// ── SLA Engine (Section 12.2) ─────────────────────────────────────────────
const sla = require("./services/slaEngine");

// GET /api/notifications — all notifications sent (most recent first).
// Restricted to Admin / MD: the global matrix contains the body of every
// queued email (incl. messages addressed to MD / Finance).
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

// GET /api/notifications/:complaintNo — notifications for one complaint
app.get("/api/notifications/:complaintNo", authenticate, (req, res) => {
  const list = notify.getForComplaint(req.params.complaintNo);
  res.json({ complaintNo: req.params.complaintNo, count: list.length, notifications: list });
});

// ── Root: API Discovery (public) ─────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    system:   "Orient Paper & Mill — CCMS",
    sapMode:  sap.USE_MOCK ? "MOCK (no real SAP connection needed)" : "LIVE SAP",
    auth: "JWT Bearer token — POST /api/auth/login to obtain a token",
    buildSpec: "Full spec — Sections 3-12 of CCMS Data Classification Report & Addendum",
    rbac: {
      description: "Section 12.3 — Role-Based Access Control enforced on all protected routes",
      defaultPassword: "Orient@123 (all users) | Admin@456 (admin@orientpaper.com)",
      loginEndpoint: "POST /api/auth/login  { email, password }",
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
    testUsers: [
      { email: "admin@orientpaper.com",          password: "Admin@456",   role: "Admin (full access)" },
      { email: "kiran.joshi@orientpaper.com",    password: "Orient@123",  role: "TS Head — approves at TS_Review" },
      { email: "neha.singh@orientpaper.com",     password: "Orient@123",  role: "QC Manager — approves at QC_Review" },
      { email: "sanjay.patel@orientpaper.com",   password: "Orient@123",  role: "Operations Head — approves at Ops_Head_Approval" },
      { email: "vikram.rao@orientpaper.com",     password: "Orient@123",  role: "Marketing Head — approves at Marketing_Head_Approval" },
      { email: "sumedha.iyer@orientpaper.com",   password: "Orient@123",  role: "Managing Director — approves at MD_Approval" },
      { email: "mohan.das@orientpaper.com",      password: "Orient@123",  role: "Finance Officer — raises Credit Note" },
    ],
  });
});

// GET /api/sla/breaches — all SLA breaches (company-wide board → Admin / MD).
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

// ── KPI Dashboard (Section 12.4) ─────────────────────────────────────────
const kpi = require("./services/kpiService");

// GET /api/kpi — full live dashboard
app.get("/api/kpi", authenticate, async (req, res) => {
  try {
    const data = await kpi.computeKPIs();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/kpi/summary — lightweight summary only (for quick health check)
app.get("/api/kpi/summary", authenticate, async (req, res) => {
  try {
    const data = await kpi.computeKPIs();
    res.json({
      generatedAt:    data.generatedAt,
      summary:        data.summary,
      slaCompliance:  data.slaCompliance,
      sapHealth:      data.sapHealth,
      topIssue:       data.pipeline[0] || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sla/breaches/:complaintNo — SLA breaches for one complaint
app.get("/api/sla/breaches/:complaintNo", authenticate, (req, res) => {
  const breaches = sla.getBreachesForComplaint(req.params.complaintNo);
  res.json({ complaintNo: req.params.complaintNo, count: breaches.length, breaches });
});

// POST /api/sla/check — manually trigger an SLA check (Admin only).
app.post("/api/sla/check", authenticate, requireRoles(ADMIN_ONLY), async (req, res) => {
  try {
    const result = await sla.triggerManualCheck();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Archival Engine (Section 12.7) ───────────────────────────────────────
const archive = require("./services/archivalService");

// Data-retention archive is an administrative surface → Admin only.
app.get("/api/archive", authenticate, requireRoles(ADMIN_ONLY), (req, res) => {
  res.json({ count: archive.getAllArchived().length, complaints: archive.getAllArchived() });
});

// GET /api/archive/policy — data retention policy details
app.get("/api/archive/policy", authenticate, requireRoles(ADMIN_ONLY), (req, res) => {
  res.json(archive.getPolicy());
});

// GET /api/archive/log — archival action log
app.get("/api/archive/log", authenticate, requireRoles(ADMIN_ONLY), (req, res) => {
  const log = archive.getAllArchivalLog();
  res.json({ count: log.length, log });
});

// GET /api/archive/:complaintNo — retrieve one archived complaint
app.get("/api/archive/:complaintNo", authenticate, requireRoles(ADMIN_ONLY), (req, res) => {
  const c = archive.getArchivedComplaint(req.params.complaintNo);
  if (!c) return res.status(404).json({ error: "Not found in archive" });
  res.json(c);
});

// POST /api/archive/run — manually trigger archival check (Admin only).
app.post("/api/archive/run", authenticate, requireRoles(ADMIN_ONLY), async (req, res) => {
  try {
    const result = await archive.runArchivalCheck();
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Rollout Config (Section 12.8) ─────────────────────────────────────────
const rollout = require("./config/rollout");

// GET /api/rollout — current rollout phase and feature flags (Admin only).
app.get("/api/rollout", authenticate, requireRoles(ADMIN_ONLY), (req, res) => {
  res.json(rollout.getRolloutStatus());
});

// GET /api/audit-log/verify — verify audit log integrity (Section 12.6).
// Part of the audit surface → same privileged roles as the log itself.
const auditModule = require("./data/auditLog");
app.get("/api/audit-log/verify", authenticate, requireRoles(GLOBAL_VIEW_ROLES), async (req, res) => {
  try {
    res.json(await auditModule.verifyIntegrity());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const db = require("./db/pool");
const masterData = require("./data/masterData");

// Master data is cached in memory, so it must be loaded BEFORE the server
// accepts traffic — otherwise early requests would see empty lookups and
// silently mis-route. A DB failure here is fatal by design: better to refuse
// to start than to serve a half-configured system.
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
    // Start SLA background engine after server is up
    sla.startSlaEngine();
    // Start Archival engine (Section 12.7)
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
