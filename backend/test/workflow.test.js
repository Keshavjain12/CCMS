


const { test } = require("node:test");
const assert = require("node:assert/strict");
const wf = require("../src/services/workflowService");

const MD = wf.MD_THRESHOLD;
const VISIT = wf.VISIT_THRESHOLD;

test("requiresMdApproval: settlement over threshold or forced policy breach", () => {
  assert.equal(wf.requiresMdApproval({ settlementValue: MD + 1 }), true);
  assert.equal(wf.requiresMdApproval({ settlementValue: MD - 1 }), false);
  assert.equal(wf.requiresMdApproval({ settlementValue: 0, policyFlag: "Breach", policyForcesMdApproval: true }), true);
  assert.equal(wf.requiresMdApproval({ settlementValue: 0, policyFlag: "Breach", policyForcesMdApproval: false }), false);
});

test("requiresVisit (L-6): threshold and snapshot key-account, no _customer dependency", () => {

  assert.equal(wf.requiresVisit({ settlementValue: VISIT + 1, isKeyAccount: false, _customer: null }), true);

  assert.equal(wf.requiresVisit({ settlementValue: 1, isKeyAccount: true, _customer: { isKeyAccount: false } }), true);

  assert.equal(wf.requiresVisit({ settlementValue: 1, isKeyAccount: false, visitRequested: true }), true);

  assert.equal(wf.requiresVisit({ settlementValue: 1, isKeyAccount: false, _customer: null }), false);
});

test("sampleGatePassed: only when required and Received+", () => {
  assert.equal(wf.sampleGatePassed({ sampleRequired: false }), true);
  assert.equal(wf.sampleGatePassed({ sampleRequired: true, _latestSample: null }), false);
  assert.equal(wf.sampleGatePassed({ sampleRequired: true, _latestSample: { sampleStatus: "Awaited" } }), false);
  assert.equal(wf.sampleGatePassed({ sampleRequired: true, _latestSample: { sampleStatus: "Received" } }), true);
  assert.equal(wf.sampleGatePassed({ sampleRequired: true, _latestSample: { sampleStatus: "Tested" } }), true);
});

test("getEffectiveSequence (L-5): no Draft, conditional stages filtered", () => {
  const simple = { status: "Logged", sampleRequired: false, settlementValue: 0, isKeyAccount: false };
  const seq = wf.getEffectiveSequence(simple);
  assert.equal(seq[0], "Logged", "Draft must not lead the sequence");
  assert.ok(!seq.includes("Draft"));
  assert.ok(!seq.includes("Sample_Awaited"));
  assert.ok(!seq.includes("MD_Approval"));
  assert.ok(!seq.includes("Visit_Pending"));
  assert.equal(seq[seq.length - 1], "Closed");
});

test("getEffectiveSequence: full path when all gates apply", () => {
  const full = { status: "Logged", sampleRequired: true, settlementValue: MD + 1, isKeyAccount: true };
  const seq = wf.getEffectiveSequence(full);
  ["Sample_Awaited", "MD_Approval", "Visit_Pending"].forEach((s) => assert.ok(seq.includes(s), `${s} should be present`));
});

test("getEffectiveSequence: a genuine Draft complaint still shows Draft (no regression)", () => {
  const draft = { status: "Draft", sampleRequired: false, settlementValue: 0, isKeyAccount: false };
  assert.equal(wf.getEffectiveSequence(draft)[0], "Draft");
  assert.equal(wf.getNextStatus(draft), "Logged");
});

test("evaluateTransition: approve advances", () => {
  const r = wf.evaluateTransition({ status: "Logged", sampleRequired: false, settlementValue: 0, isKeyAccount: false }, "approve");
  assert.deepEqual([r.allowed, r.newStatus], [true, "TS_Review"]);
});

test("evaluateTransition: reject at Logged is refused (L-5, no Draft limbo)", () => {
  const r = wf.evaluateTransition({ status: "Logged", sampleRequired: false, settlementValue: 0, isKeyAccount: false }, "reject");
  assert.equal(r.allowed, false);
  assert.match(r.reason, /initial status/i);
});

test("evaluateTransition: QC_Review sample gate blocks approve", () => {
  const c = { status: "QC_Review", sampleRequired: true, _latestSample: null, settlementValue: 0, isKeyAccount: false };
  const r = wf.evaluateTransition(c, "approve");
  assert.equal(r.allowed, false);
  assert.match(r.reason, /sample has not been received/i);
});

test("evaluateTransition: Finance_Processing needs a credit note to close", () => {
  const blocked = wf.evaluateTransition({ status: "Finance_Processing" }, "approve");
  assert.equal(blocked.allowed, false);
  const ok = wf.evaluateTransition({ status: "Finance_Processing", creditNoteNumber: "CN1" }, "approve");
  assert.deepEqual([ok.allowed, ok.newStatus], [true, "Closed"]);
});

test("evaluateTransition: clarify / resolve / auto_close / terminal", () => {
  const clr = wf.evaluateTransition({ status: "TS_Review" }, "clarify");
  assert.deepEqual([clr.allowed, clr.newStatus, clr.priorStatus], [true, "Clarification_Sought", "TS_Review"]);
  const res = wf.evaluateTransition({ status: "Clarification_Sought", _priorStatus: "TS_Review" }, "resolve_clarification");
  assert.deepEqual([res.allowed, res.newStatus], [true, "TS_Review"]);
  const ac = wf.evaluateTransition({ status: "QC_Review" }, "auto_close");
  assert.deepEqual([ac.allowed, ac.newStatus], [true, "Auto_Closed"]);
  assert.equal(wf.evaluateTransition({ status: "Closed" }, "approve").allowed, false);
});
