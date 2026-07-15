// =========================================================================
// AUTH MIDDLEWARE  —  Orient Paper & Mill CCMS
// Section 12.3 — Role-Based Access Control (RBAC)
//
// Every protected route gets req.user = { userId, email, roleId, roleName,
// department, canApprove, canForward, canReject, level }
//
// RBAC Matrix (who can do what at which status):
// ─────────────────────────────────────────────
// Status           → Allowed roleIds to approve/forward from this stage
// ─────────────────────────────────────────────
// Logged           → R001, R002 (TS Officer / TS Head)
// TS_Review        → R002      (TS Head — canApprove)
// QC_Review        → R003, R004(QC Analyst forward, QC Manager approve)
// Sample_Awaited   → R003, R004(QC updates sample; QC Manager moves on)
// CAPA_Pending     → R005, R006(Ops Analyst documents CAPA, Ops Head approves)
// Ops_Head_Approval→ R006      (Operations Head)
// Marketing_Review → R007, R008(Product Manager forward, Mktg Head approve)
// Marketing_Head_Approval → R008 (Marketing Head)
// MD_Approval      → R009      (Managing Director)
// Visit_Pending    → R010, R011(Sales/KAM logs visit; Finance forwards)
// Finance_Processing→ R010     (Finance Officer — raises Credit Note)
// Closed           → read-only (no transitions from Closed)
// ─────────────────────────────────────────────
// Admin (R000)     → can do everything, bypass all role checks
// =========================================================================

require("dotenv").config();
const jwt = require("jsonwebtoken");
const md  = require("../data/masterData");

const DEV_FALLBACK_SECRET = "opm-ccms-dev-secret-change-in-prod";
const JWT_SECRET  = process.env.JWT_SECRET  || DEV_FALLBACK_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || "8h";

// ── JWT secret hardening ──────────────────────────────────────────────────
// A weak or default signing secret means anyone can forge a valid token for
// any user/role. Refuse to boot in production with such a secret; warn loudly
// in development so it's never mistaken for production-ready.
(function guardJwtSecret() {
  const s = process.env.JWT_SECRET || "";
  const isWeak =
    !s ||
    s === DEV_FALLBACK_SECRET ||
    s.length < 32 ||
    /change|example|placeholder|dev-secret|your[-_]?secret/i.test(s);

  if (process.env.NODE_ENV === "production" && isWeak) {
    throw new Error(
      "[CCMS] Refusing to start: JWT_SECRET is missing, default, or weak. " +
      "Set a long (32+ char) random JWT_SECRET in the environment before deploying."
    );
  }
  if (isWeak) {
    console.warn(
      "[CCMS] WARNING: JWT_SECRET is weak or default. Tokens are forgeable. " +
      "This is only acceptable for local development."
    );
  }
})();

// ── Per-status allowed roles ──────────────────────────────────────────────
// Maps complaint status → which roles are allowed to call /action on it.
const STATUS_ALLOWED_ROLES = {
  Logged:                    ["R001", "R002"],
  TS_Review:                 ["R002"],
  QC_Review:                 ["R003", "R004"],
  Sample_Awaited:            ["R003", "R004"],
  CAPA_Pending:              ["R005", "R006"],
  Ops_Head_Approval:         ["R006"],
  Marketing_Review:          ["R007", "R008"],
  Marketing_Head_Approval:   ["R008"],
  MD_Approval:               ["R009"],
  Visit_Pending:             ["R010", "R011"],
  Finance_Processing:        ["R010"],
};

// ── Route-level permission map ─────────────────────────────────────────────
// Maps endpoint category → minimum required capabilities or allowed roles.
const ROUTE_PERMISSIONS = {
  // Complaint creation — Sales/KAM (R011), TS (R001/R002), or Admin
  createComplaint:    ["R001", "R002", "R011"],
  // Sample management — QC only
  manageSamples:      ["R003", "R004"],
  // CAPA — Operations only
  manageCapa:         ["R005", "R006"],
  // Visit scheduling — Sales/KAM + Finance
  manageVisits:       ["R010", "R011"],
  // Credit note — Finance only
  creditNote:         ["R010"],
  // Master data writes — Admin only
  masterDataWrite:    ["R000"],
  // Read-only — any authenticated user
  readOnly:           "*",
};

// ── Token helpers ─────────────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    {
      userId:     user.userId,
      email:      user.email,
      roleId:     user.roleId,
      name:       user.name,
      department: user.department,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

// ── Core verify middleware ────────────────────────────────────────────────
function authenticate(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      error: "No token provided. Login via POST /api/auth/login to get a Bearer token.",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Attach full role details from live master data
    const role = md.findRole(decoded.roleId) || {};
    req.user = {
      ...decoded,
      roleName:   role.roleName   || decoded.roleId,
      canApprove: role.canApprove || false,
      canForward: role.canForward || false,
      canReject:  role.canReject  || false,
      level:      role.level      || 0,
      isAdmin:    decoded.roleId === "R000",
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token. Please login again." });
  }
}

// ── Role-gate middleware factory ───────────────────────────────────────────
// Usage: router.post("/credit-note", authenticate, requireRoles(["R010"]), handler)
function requireRoles(allowedRoles) {
  return (req, res, next) => {
    if (req.user.isAdmin) return next(); // Admin bypasses all role gates
    if (allowedRoles.includes(req.user.roleId)) return next();
    return res.status(403).json({
      error: `Access denied. This action requires one of: ${allowedRoles.join(", ")}. Your role: ${req.user.roleId} (${req.user.roleName}).`,
      yourRole: req.user.roleId,
      requiredRoles: allowedRoles,
    });
  };
}

// ── Status-action gate ────────────────────────────────────────────────────
// Call this INSIDE a route handler after fetching the complaint.
// Returns { allowed: true } or { allowed: false, reason }
function canActOnStatus(user, complaintStatus, action, priorStatus) {
  if (user.isAdmin) return { allowed: true };

  // Side-state: a complaint parked in Clarification_Sought is resolved by
  // whoever was authorised to act at the stage the clarification was raised
  // from. Without this, no non-admin role could ever resolve a clarification.
  let effectiveStatus = complaintStatus;
  if (complaintStatus === "Clarification_Sought") {
    effectiveStatus = priorStatus || null;
    if (!effectiveStatus) {
      // No recorded prior stage — fall back to any staff able to move work on.
      if (user.canForward || user.canApprove) return { allowed: true };
      return { allowed: false, reason: "Only staff with forward permission can resolve a clarification." };
    }
  }

  const allowed = STATUS_ALLOWED_ROLES[effectiveStatus];
  if (!allowed) return { allowed: false, reason: `No roles defined for status: ${complaintStatus}` };

  if (!allowed.includes(user.roleId)) {
    return {
      allowed: false,
      reason: `Status '${complaintStatus}' can only be actioned by: ${allowed.join(", ")}. Your role: ${user.roleId} (${user.roleName}).`,
    };
  }

  // Action-level check using role flags
  if (action === "approve") {
    if (!user.canApprove && !user.canForward) {
      return { allowed: false, reason: `Your role (${user.roleName}) does not have approve/forward permission.` };
    }
  }
  if (action === "reject") {
    if (!user.canReject) {
      return { allowed: false, reason: `Your role (${user.roleName}) does not have reject permission.` };
    }
  }

  return { allowed: true };
}

module.exports = {
  signToken,
  authenticate,
  requireRoles,
  canActOnStatus,
  ROUTE_PERMISSIONS,
  STATUS_ALLOWED_ROLES,
  JWT_SECRET,
  JWT_EXPIRES,
};
