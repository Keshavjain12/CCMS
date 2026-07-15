// =========================================================================
// WORKFLOW ENGINE  —  CCMS Status State Machine
// =========================================================================
// Source: Section 8 of the CCMS Data Classification Report & Addendum.
//
// 13 complaint statuses + universal transition rules.
// All gate logic (sample required, MD threshold, visit trigger, policy
// breach) is evaluated here — never scattered across route handlers.
// =========================================================================

require("dotenv").config();

// ─── STATUS SEQUENCE ──────────────────────────────────────────────────────
// Ordered list. The engine moves forward/backward along this sequence.
const STATUSES = [
  "Draft",
  "Logged",
  "TS_Review",
  "QC_Review",
  "Sample_Awaited",        // Conditional gate — skipped if sampleRequired=false
  "CAPA_Pending",
  "Ops_Head_Approval",
  "Marketing_Review",
  "Marketing_Head_Approval",
  "MD_Approval",           // Conditional gate — settlement > threshold OR policy breach
  "Visit_Pending",         // Conditional gate — high value or key account
  "Finance_Processing",
  "Closed",
];

// Side-states — reachable from any active status
const SIDE_STATES = ["Rejected", "Clarification_Sought", "Auto_Closed"];

const MD_THRESHOLD    = parseInt(process.env.MD_APPROVAL_THRESHOLD || "100000", 10);
const VISIT_THRESHOLD = parseInt(process.env.VISIT_THRESHOLD       || "50000",  10);

// ─── GATE EVALUATION ─────────────────────────────────────────────────────

/**
 * Should MD_Approval status be included for this complaint?
 */
function requiresMdApproval(complaint) {
  if (complaint.settlementValue > MD_THRESHOLD) return true;
  if (complaint.policyFlag === "Breach" && complaint.policyForcesMdApproval) return true;
  return false;
}

/**
 * Should Visit_Pending status be included for this complaint?
 */
function requiresVisit(complaint) {
  if (complaint.visitRequested === true) return true;
  const customer = complaint._customer;
  if (!customer) return false;
  if (complaint.settlementValue > VISIT_THRESHOLD) return true;
  if (customer.isKeyAccount) return true;
  return false;
}

/**
 * Can QC approve and forward? Only if sample is received (when required).
 * Gate: Section 6.4.
 */
function sampleGatePassed(complaint) {
  if (!complaint.sampleRequired) return true;
  const sample = complaint._latestSample;
  if (!sample) return false;
  return ["Received", "Under Testing", "Tested"].includes(sample.sampleStatus);
}

// ─── SEQUENCE NAVIGATION ─────────────────────────────────────────────────

/**
 * Get the effective status sequence for a specific complaint, applying gates.
 */
function getEffectiveSequence(complaint) {
  return STATUSES.filter((s) => {
    if (s === "Sample_Awaited" && !complaint.sampleRequired) return false;
    if (s === "MD_Approval"    && !requiresMdApproval(complaint)) return false;
    if (s === "Visit_Pending"  && !requiresVisit(complaint)) return false;
    return true;
  });
}

/**
 * Get the next status in the effective sequence.
 * Returns null if already at the end.
 */
function getNextStatus(complaint) {
  const seq = getEffectiveSequence(complaint);
  const idx = seq.indexOf(complaint.status);
  if (idx === -1 || idx >= seq.length - 1) return null;
  return seq[idx + 1];
}

/**
 * Get the previous status in the effective sequence.
 * Returns null if already at the beginning.
 */
function getPreviousStatus(complaint) {
  const seq = getEffectiveSequence(complaint);
  const idx = seq.indexOf(complaint.status);
  if (idx <= 0) return null;
  return seq[idx - 1];
}

// ─── UNIVERSAL TRANSITION RULE (Section 8.2) ─────────────────────────────

/**
 * Apply an action to a complaint.
 *
 * Supported actions:
 *   approve   → moves to next status (or blocked by sample gate at QC_Review)
 *   reject    → returns to previous status
 *   clarify   → moves to Clarification_Sought (side-state)
 *   resolve_clarification → returns from Clarification_Sought to prior status
 *   auto_close → marks as Auto_Closed with remarks
 *
 * Returns { allowed, newStatus, reason }
 */
function evaluateTransition(complaint, action) {
  const current = complaint.status;

  // ── side-state: clarification return ──────────────────────────────
  if (action === "resolve_clarification") {
    if (current !== "Clarification_Sought") {
      return { allowed: false, reason: "Complaint is not in Clarification_Sought status" };
    }
    return { allowed: true, newStatus: complaint._priorStatus || "Logged" };
  }

  // ── Closed is terminal ─────────────────────────────────────────────
  if (current === "Closed") {
    return { allowed: false, reason: "Complaint is already closed" };
  }
  if (current === "Auto_Closed") {
    return { allowed: false, reason: "Complaint has been auto-closed" };
  }
  if (current === "Rejected" && action !== "approve") {
    return { allowed: false, reason: "Rejected complaint can only be re-submitted (approve)" };
  }

  // ── APPROVE ────────────────────────────────────────────────────────
  if (action === "approve") {
    // Sample gate: QC_Review cannot approve if sample not yet received
    if (current === "QC_Review" && complaint.sampleRequired && !sampleGatePassed(complaint)) {
      return {
        allowed: false,
        reason: "Cannot proceed from QC_Review: physical sample has not been received yet. Update sample status to Received before approving.",
      };
    }

    // Finance_Processing → Closed requires a credit note number
    if (current === "Finance_Processing") {
      if (!complaint.creditNoteNumber) {
        return { allowed: false, reason: "Credit Note must be raised in SAP before complaint can be closed." };
      }
      return { allowed: true, newStatus: "Closed" };
    }

    const next = getNextStatus(complaint);
    if (!next) return { allowed: false, reason: "No further status available in sequence." };
    return { allowed: true, newStatus: next };
  }

  // ── REJECT ────────────────────────────────────────────────────────
  if (action === "reject") {
    const prev = getPreviousStatus(complaint);
    if (!prev) return { allowed: false, reason: "Already at initial status; cannot reject further." };
    return { allowed: true, newStatus: prev };
  }

  // ── CLARIFY ───────────────────────────────────────────────────────
  if (action === "clarify") {
    return { allowed: true, newStatus: "Clarification_Sought", priorStatus: current };
  }

  // ── AUTO_CLOSE ────────────────────────────────────────────────────
  if (action === "auto_close") {
    return { allowed: true, newStatus: "Auto_Closed" };
  }

  return { allowed: false, reason: `Unknown action: ${action}` };
}

module.exports = {
  STATUSES,
  SIDE_STATES,
  getEffectiveSequence,
  getNextStatus,
  getPreviousStatus,
  evaluateTransition,
  requiresMdApproval,
  requiresVisit,
  sampleGatePassed,
  MD_THRESHOLD,
  VISIT_THRESHOLD,
};
