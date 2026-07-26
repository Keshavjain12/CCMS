





const bcrypt   = require("bcryptjs");
const router   = require("../utils/asyncRoute").safeRouter();
const md       = require("../data/masterData");
const { signToken, authenticate, revokeToken, AUTH_COOKIE, cookieOptions } = require("../middleware/auth");


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






router.post("/logout", (req, res) => {
  const header = req.headers["authorization"] || "";
  const token =
    (req.cookies && req.cookies[AUTH_COOKIE]) ||
    (header.startsWith("Bearer ") ? header.slice(7) : null);
  revokeToken(token);

  const opts = cookieOptions();
  delete opts.maxAge;
  res.clearCookie(AUTH_COOKIE, opts);
  res.json({ message: "Logged out successfully." });
});

module.exports = router;
