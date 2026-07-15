// =========================================================================
// READ SCOPING  —  Section 12.3 (least privilege on reads)
// =========================================================================
// Single source of truth for "may this user see this complaint?".
//
// This lived inside routes/complaints.js, which meant the complaints list
// enforced it but /api/kpi did not — so a junior role could read
// company-wide totals and settlement values from the dashboard even though
// the list correctly hid those complaints. Any endpoint that returns
// complaint data (or anything derived from it) must scope through here.
//
// A complaint is visible to a user when:
//   • they are Admin (R000) or the Managing Director (R009) — full oversight;
//   • they reported/created it;
//   • it is currently in their role's action queue (their role may act on the
//     current status — or its prior status when parked in Clarification_Sought);
//   • they have personally acted on it at some point (per the audit trail,
//     whose actorId is stamped from the JWT, so it can't be spoofed).
// =========================================================================

const audit = require("../data/auditLog");
const { canActOnStatus } = require("../middleware/auth");

async function visibleToUser(user, complaint) {
  if (!complaint) return false;
  if (!user) return false;
  if (user.isAdmin || user.roleId === "R009") return true;
  if (complaint.reportedBy && complaint.reportedBy === user.userId) return true;
  if (canActOnStatus(user, complaint.status, null, complaint._priorStatus).allowed) return true;
  const entries = await audit.getForComplaint(complaint.complaintNo);
  return entries.some((e) => e.actorId === user.userId);
}

/**
 * Filter a list of complaints down to those `user` may see.
 * Checks run concurrently — each may hit the audit trail.
 */
async function filterVisible(user, complaints) {
  if (!user) return [];
  // Admin/MD see everything; skip the per-complaint audit lookups entirely.
  if (user.isAdmin || user.roleId === "R009") return complaints;
  const flags = await Promise.all(complaints.map((c) => visibleToUser(user, c)));
  return complaints.filter((_, i) => flags[i]);
}

module.exports = { visibleToUser, filterVisible };
