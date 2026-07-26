

const { test } = require("node:test");
const assert = require("node:assert/strict");
const auth = require("../src/middleware/auth");

test("canActOnStatus: admin bypasses all gates", () => {
  assert.equal(auth.canActOnStatus({ isAdmin: true }, "Logged", "approve").allowed, true);
});

test("canActOnStatus: right role at its stage", () => {
  const tsHead = { roleId: "R002", roleName: "TS Head", canApprove: true, canForward: true, canReject: true };
  assert.equal(auth.canActOnStatus(tsHead, "TS_Review", "approve").allowed, true);
});

test("canActOnStatus: wrong role at a stage is refused", () => {
  const finance = { roleId: "R010", roleName: "Finance Officer", canApprove: true };
  assert.equal(auth.canActOnStatus(finance, "Logged", "approve").allowed, false);
});

test("canActOnStatus: clarification resolves against the prior stage", () => {
  const tsHead = { roleId: "R002", roleName: "TS Head", canApprove: true, canForward: true };
  assert.equal(auth.canActOnStatus(tsHead, "Clarification_Sought", "approve", "TS_Review").allowed, true);
  const qc = { roleId: "R004", roleName: "QC Manager", canApprove: true };
  assert.equal(auth.canActOnStatus(qc, "Clarification_Sought", "approve", "TS_Review").allowed, false);
});

test("canActOnStatus: reject needs canReject", () => {
  const noReject = { roleId: "R011", roleName: "Sales/KAM", canForward: true, canReject: false };
  const r = auth.canActOnStatus(noReject, "Visit_Pending", "reject");
  assert.equal(r.allowed, false);
});


function mockRes() {
  return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
function callAuth(token) {
  const req = { headers: { authorization: "Bearer " + token }, cookies: {} };
  const res = mockRes();
  let nexted = false;
  auth.authenticate(req, res, () => { nexted = true; });
  return { req, res, nexted };
}

test("revokeToken: a valid token authenticates, then is rejected after logout", () => {
  const token = auth.signToken({ userId: "U1", email: "u1@x.com", roleId: "R000", name: "T", department: "D005" });

  const before = callAuth(token);
  assert.equal(before.nexted, true, "fresh token should pass");
  assert.equal(before.req.user.userId, "U1");

  auth.revokeToken(token);

  const after = callAuth(token);
  assert.equal(after.nexted, false, "revoked token must not pass");
  assert.equal(after.res.code, 401);
});

test("authenticate: missing token → 401", () => {
  const res = mockRes();
  let nexted = false;
  auth.authenticate({ headers: {}, cookies: {} }, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res.code, 401);
});
