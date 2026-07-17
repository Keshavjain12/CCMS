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

async function filterVisible(user, complaints) {
  if (!user) return [];

  if (user.isAdmin || user.roleId === "R009") return complaints;
  const flags = await Promise.all(complaints.map((c) => visibleToUser(user, c)));
  return complaints.filter((_, i) => flags[i]);
}

module.exports = { visibleToUser, filterVisible };
