









require("dotenv").config();



const STATUSES = [
  "Draft",
  "Logged",
  "TS_Review",
  "QC_Review",
  "Sample_Awaited",
  "CAPA_Pending",
  "Ops_Head_Approval",
  "Marketing_Review",
  "Marketing_Head_Approval",
  "MD_Approval",
  "Visit_Pending",
  "Finance_Processing",
  "Closed",
];


const SIDE_STATES = ["Rejected", "Clarification_Sought", "Auto_Closed"];

const MD_THRESHOLD    = parseInt(process.env.MD_APPROVAL_THRESHOLD || "100000", 10);
const VISIT_THRESHOLD = parseInt(process.env.VISIT_THRESHOLD       || "50000",  10);




function requiresMdApproval(complaint) {
  if (complaint.settlementValue > MD_THRESHOLD) return true;
  if (complaint.policyFlag === "Breach" && complaint.policyForcesMdApproval) return true;
  return false;
}


function requiresVisit(complaint) {
  if (complaint.visitRequested === true) return true;







  if (complaint.settlementValue > VISIT_THRESHOLD) return true;
  if (complaint.isKeyAccount) return true;
  return false;
}


function sampleGatePassed(complaint) {
  if (!complaint.sampleRequired) return true;
  const sample = complaint._latestSample;
  if (!sample) return false;
  return ["Received", "Under Testing", "Tested"].includes(sample.sampleStatus);
}




function getEffectiveSequence(complaint) {
  return STATUSES.filter((s) => {





    if (s === "Draft" && complaint.status !== "Draft") return false;
    if (s === "Sample_Awaited" && !complaint.sampleRequired) return false;
    if (s === "MD_Approval"    && !requiresMdApproval(complaint)) return false;
    if (s === "Visit_Pending"  && !requiresVisit(complaint)) return false;
    return true;
  });
}


function getNextStatus(complaint) {
  const seq = getEffectiveSequence(complaint);
  const idx = seq.indexOf(complaint.status);
  if (idx === -1 || idx >= seq.length - 1) return null;
  return seq[idx + 1];
}


function getPreviousStatus(complaint) {
  const seq = getEffectiveSequence(complaint);
  const idx = seq.indexOf(complaint.status);
  if (idx <= 0) return null;
  return seq[idx - 1];
}




function evaluateTransition(complaint, action) {
  const current = complaint.status;


  if (action === "resolve_clarification") {
    if (current !== "Clarification_Sought") {
      return { allowed: false, reason: "Complaint is not in Clarification_Sought status" };
    }
    return { allowed: true, newStatus: complaint._priorStatus || "Logged" };
  }


  if (current === "Closed") {
    return { allowed: false, reason: "Complaint is already closed" };
  }
  if (current === "Auto_Closed") {
    return { allowed: false, reason: "Complaint has been auto-closed" };
  }
  if (current === "Rejected" && action !== "approve") {
    return { allowed: false, reason: "Rejected complaint can only be re-submitted (approve)" };
  }


  if (action === "approve") {

    if (current === "QC_Review" && complaint.sampleRequired && !sampleGatePassed(complaint)) {
      return {
        allowed: false,
        reason: "Cannot proceed from QC_Review: physical sample has not been received yet. Update sample status to Received before approving.",
      };
    }


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


  if (action === "reject") {
    const prev = getPreviousStatus(complaint);
    if (!prev) return { allowed: false, reason: "Already at initial status; cannot reject further." };
    return { allowed: true, newStatus: prev };
  }


  if (action === "clarify") {
    return { allowed: true, newStatus: "Clarification_Sought", priorStatus: current };
  }


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
