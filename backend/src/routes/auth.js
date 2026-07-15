// =========================================================================
// AUTH ROUTES  —  /api/auth
// POST /api/auth/login   — get a JWT token
// GET  /api/auth/me      — who am I?
// POST /api/auth/logout  — client-side logout hint
// =========================================================================
const express  = require("express");
const bcrypt   = require("bcryptjs");
const router   = require("../utils/asyncRoute").safeRouter();
const md       = require("../data/masterData");
const { signToken, authenticate, AUTH_COOKIE, cookieOptions } = require("../middleware/auth");

// ── POST /api/auth/login ─────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Both email and password are required." });
  }

  const user = md.findUserByEmail(email);
  if (!user || !user.active) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const passwordMatch = await bcrypt.compare(password, user.password);
  if (!passwordMatch) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const role = md.findRole(user.roleId) || {};
  const token = signToken(user);

  // The token goes back as an httpOnly cookie ONLY — deliberately not in the
  // response body. Putting it in the JSON would hand it to page JavaScript
  // (and therefore to any XSS on the page). The browser will attach the
  // cookie to subsequent requests on its own.
  res.cookie(AUTH_COOKIE, token, cookieOptions());

  res.json({
    message:  `Welcome, ${user.name}!`,
    expiresIn: process.env.JWT_EXPIRES || "8h",
    user: {
      userId:     user.userId,
      name:       user.name,
      email:      user.email,
      roleId:     user.roleId,
      roleName:   role.roleName,
      department: user.department,
      canApprove: role.canApprove,
      canForward: role.canForward,
      canReject:  role.canReject,
    },
  });
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────
router.get("/me", authenticate, (req, res) => {
  const role = md.findRole(req.user.roleId) || {};
  const dept = md.departments.find((d) => d.departmentId === req.user.department);
  res.json({
    userId:         req.user.userId,
    name:           req.user.name,
    email:          req.user.email,
    roleId:         req.user.roleId,
    roleName:       req.user.roleName,
    department:     req.user.department,
    departmentName: dept ? dept.departmentName : "N/A",
    permissions: {
      canApprove: req.user.canApprove,
      canForward: req.user.canForward,
      canReject:  req.user.canReject,
      isAdmin:    req.user.isAdmin,
    },
  });
});

// ── POST /api/auth/logout ────────────────────────────────────────────────
// Clears the auth cookie server-side. The client can no longer "forget" the
// token itself (it never had it), so logout must happen here.
//
// Note: the JWT stays cryptographically valid until it expires — clearing the
// cookie only removes the browser's copy. Revoking a live token would need a
// denylist or short-lived tokens plus refresh; out of scope for now.
router.post("/logout", (req, res) => {
  const opts = cookieOptions();
  delete opts.maxAge;
  res.clearCookie(AUTH_COOKIE, opts);
  res.json({ message: "Logged out successfully." });
});

module.exports = router;
