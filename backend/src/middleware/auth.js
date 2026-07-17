


























require("dotenv").config();
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const md  = require("../data/masterData");

const DEV_FALLBACK_SECRET = "opm-ccms-dev-secret-change-in-prod";
const JWT_SECRET  = process.env.JWT_SECRET  || DEV_FALLBACK_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || "8h";





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










const revokedJtis = new Map();

function revokeToken(token) {
  if (!token) return;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.jti) revokedJtis.set(decoded.jti, (decoded.exp || 0) * 1000 || Date.now());
  } catch (_) {  }
}

function isTokenRevoked(decoded) {
  const exp = decoded && decoded.jti != null ? revokedJtis.get(decoded.jti) : undefined;
  if (exp == null) return false;
  if (Date.now() >= exp) { revokedJtis.delete(decoded.jti); return false; }
  return true;
}


setInterval(() => {
  const now = Date.now();
  for (const [jti, exp] of revokedJtis) if (now >= exp) revokedJtis.delete(jti);
}, 60 * 60 * 1000).unref();



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



const ROUTE_PERMISSIONS = {

  createComplaint:    ["R001", "R002", "R011"],

  manageSamples:      ["R003", "R004"],

  manageCapa:         ["R005", "R006"],

  manageVisits:       ["R010", "R011"],

  creditNote:         ["R010"],

  masterDataWrite:    ["R000"],

  readOnly:           "*",
};










const AUTH_COOKIE = "ccms_token";

function cookieOptions() {
  const hours = parseInt(String(process.env.JWT_EXPIRES || "8h"), 10) || 8;
  return {
    httpOnly: true,
    sameSite: process.env.COOKIE_SAMESITE || "lax",
    secure:   process.env.NODE_ENV === "production",
    maxAge:   hours * 60 * 60 * 1000,
    path:     "/",
  };
}

function signToken(user) {
  return jwt.sign(
    {
      userId:     user.userId,
      email:      user.email,
      roleId:     user.roleId,
      name:       user.name,
      department: user.department,

      jti:        crypto.randomUUID(),
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}







function authenticate(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token =
    (req.cookies && req.cookies[AUTH_COOKIE]) ||
    (header.startsWith("Bearer ") ? header.slice(7) : null);

  if (!token) {
    return res.status(401).json({
      error: "Not authenticated. Login via POST /api/auth/login.",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);



    if (isTokenRevoked(decoded)) {
      return res.status(401).json({ error: "Session ended. Please login again." });
    }


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



function requireRoles(allowedRoles) {
  return (req, res, next) => {
    if (req.user.isAdmin) return next();
    if (allowedRoles.includes(req.user.roleId)) return next();
    return res.status(403).json({
      error: `Access denied. This action requires one of: ${allowedRoles.join(", ")}. Your role: ${req.user.roleId} (${req.user.roleName}).`,
      yourRole: req.user.roleId,
      requiredRoles: allowedRoles,
    });
  };
}




function canActOnStatus(user, complaintStatus, action, priorStatus) {
  if (user.isAdmin) return { allowed: true };




  let effectiveStatus = complaintStatus;
  if (complaintStatus === "Clarification_Sought") {
    effectiveStatus = priorStatus || null;
    if (!effectiveStatus) {

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
  revokeToken,
  ROUTE_PERMISSIONS,
  STATUS_ALLOWED_ROLES,
  JWT_SECRET,
  JWT_EXPIRES,
  AUTH_COOKIE,
  cookieOptions,
};
