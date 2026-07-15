// =========================================================================
// AUTH ROUTES  —  /api/auth
// POST /api/auth/login   — get a JWT token
// GET  /api/auth/me      — who am I?
// POST /api/auth/logout  — client-side logout hint
// =========================================================================
const express  = require("express");
const bcrypt   = require("bcryptjs");
const router   = express.Router();
const md       = require("../data/masterData");
const { signToken, authenticate } = require("../middleware/auth");

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

  res.json({
    message:  `Welcome, ${user.name}!`,
    token,
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
// JWT is stateless — actual invalidation happens on the client by
// discarding the token. This endpoint exists for completeness and to
// support future token blacklist / refresh-token patterns.
router.post("/logout", authenticate, (req, res) => {
  res.json({
    message: `Logged out successfully. Discard your token on the client side.`,
    userId: req.user.userId,
  });
});

module.exports = router;
