
const { test } = require("node:test");
const assert = require("node:assert/strict");
const md = require("../src/data/masterData");

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const POLICY = { complaintWindowDays: 30, maxSettlementPct: 80, approvalOverrideOnBreach: true };

test("checkPolicyCompliance: no policy → compliant, flagged 'No Policy Found'", () => {
  const r = md.checkPolicyCompliance(null, daysAgo(1), 10, 100);
  assert.equal(r.compliant, true);
  assert.equal(r.flag, "No Policy Found");
});

test("checkPolicyCompliance: within window and ceiling → compliant", () => {
  const r = md.checkPolicyCompliance(POLICY, daysAgo(5), 50, 100);
  assert.equal(r.compliant, true);
});

test("checkPolicyCompliance: filed after the window → breach, forces MD", () => {
  const r = md.checkPolicyCompliance(POLICY, daysAgo(40), 10, 100);
  assert.equal(r.compliant, false);
  assert.equal(r.flag, "Breach");
  assert.equal(r.forcesMdApproval, true);
  assert.match(r.clauseBreached, /window/i);
});

test("checkPolicyCompliance: settlement over the ceiling → breach", () => {
  const r = md.checkPolicyCompliance(POLICY, daysAgo(1), 90, 100);
  assert.equal(r.compliant, false);
  assert.match(r.clauseBreached, /exceeds policy ceiling/i);
});



function rolloutForPhase(phase) {
  const prev = process.env.ROLLOUT_PHASE;
  process.env.ROLLOUT_PHASE = String(phase);
  delete require.cache[require.resolve("../src/config/rollout")];
  const mod = require("../src/config/rollout");
  process.env.ROLLOUT_PHASE = prev;
  delete require.cache[require.resolve("../src/config/rollout")];
  return mod;
}

test("rollout phase 3: everything allowed", () => {
  const r = rolloutForPhase(3);
  assert.equal(r.checkRolloutGate("Chemical", "South India").allowed, true);
});

test("rollout phase 1: Chemical blocked, Paper/North allowed (region aliasing)", () => {
  const r = rolloutForPhase(1);
  assert.equal(r.checkRolloutGate("Chemical", "North India").allowed, false);
  assert.equal(r.checkRolloutGate("Paper", "Northern India").allowed, true, "'Northern' should normalise to 'north'");
  assert.equal(r.checkRolloutGate("Paper", "South India").allowed, false);
});
