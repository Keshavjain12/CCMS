// ============================================================
// ROLES & RBAC  (mirror of backend src/middleware/auth.js)
// ------------------------------------------------------------
// The backend is the source of truth and re-checks everything.
// This mirror only decides which portal/nav/actions to SHOW so
// the UI never offers a button the server would reject with 403.
// ============================================================
window.CCMS = window.CCMS || {};

CCMS.roles = (function () {

  // ── Per-status → roles allowed to /action (backend STATUS_ALLOWED_ROLES)
  const STATUS_ALLOWED_ROLES = {
    Logged:                  ["R001", "R002"],
    TS_Review:               ["R002"],
    QC_Review:               ["R003", "R004"],
    Sample_Awaited:          ["R003", "R004"],
    CAPA_Pending:            ["R005", "R006"],
    Ops_Head_Approval:       ["R006"],
    Marketing_Review:        ["R007", "R008"],
    Marketing_Head_Approval: ["R008"],
    MD_Approval:             ["R009"],
    Visit_Pending:           ["R010", "R011"],
    Finance_Processing:      ["R010"],
  };

  // ── Endpoint-category → allowed roles (backend ROUTE_PERMISSIONS)
  const CAN = {
    createComplaint: ["R000", "R001", "R002", "R011"],
    manageSamples:   ["R000", "R003", "R004"],
    manageCapa:      ["R000", "R005", "R006"],
    manageVisits:    ["R000", "R010", "R011"],
    creditNote:      ["R000", "R010"],
    masterDataWrite: ["R000"],
  };

  // ── Roles allowed to see the COMPANY-WIDE views ───────────────────
  // Notifications, SLA breaches and the global audit log expose data
  // across every department (MD approvals, settlement values, all queued
  // emails). They must NOT be offered to every authenticated role. This
  // list restricts the nav + client guards to privileged roles; the
  // backend must ALSO enforce it (return 403 for everyone else).
  // Adjust here to add e.g. a dedicated Auditor role.
  //   R000 = Admin, R009 = Managing Director.
  const GLOBAL_VIEW_ROLES = ["R000", "R009"];
  function canViewGlobal(roleId) {
    return GLOBAL_VIEW_ROLES.indexOf(roleId) !== -1;
  }

  // ── Portal identity per role (drives branding + landing) ──────────
  const PORTALS = {
    R000: { portal: "Admin Console",         dept: "System",              accent: "#7c3aed", icon: "⚙" },
    R001: { portal: "Technical Services",    dept: "TS",                  accent: "#0ea5e9", icon: "🔧" },
    R002: { portal: "Technical Services",    dept: "TS",                  accent: "#0ea5e9", icon: "🔧" },
    R003: { portal: "Quality Control",       dept: "QC",                  accent: "#16a34a", icon: "🧪" },
    R004: { portal: "Quality Control",       dept: "QC",                  accent: "#16a34a", icon: "🧪" },
    R005: { portal: "Operations",            dept: "Operations",          accent: "#d97706", icon: "🏭" },
    R006: { portal: "Operations",            dept: "Operations",          accent: "#d97706", icon: "🏭" },
    R007: { portal: "Marketing",             dept: "Marketing",           accent: "#db2777", icon: "📣" },
    R008: { portal: "Marketing",             dept: "Marketing",           accent: "#db2777", icon: "📣" },
    R009: { portal: "Managing Director",     dept: "MD Office",           accent: "#b91c1c", icon: "★" },
    R010: { portal: "Finance",               dept: "Finance",             accent: "#0d9488", icon: "₹" },
    R011: { portal: "Sales / KAM",           dept: "Sales",               accent: "#2563eb", icon: "🤝" },
  };

  // ── Which nav sections each role sees ─────────────────────────────
  // Every authenticated role gets: dashboard, complaints, notifications, audit.
  // Extra sections are added per role below.
  function navFor(roleId) {
    const base = [
      { id: "dashboard",     label: "Dashboard",     icon: "▤", route: "#/dashboard" },
      { id: "complaints",    label: "Complaints",    icon: "▦", route: "#/complaints" },
    ];

    if (can("createComplaint", roleId)) {
      base.push({ id: "create", label: "New Complaint", icon: "＋", route: "#/complaints/new" });
    }

    // Company-wide views are only offered to privileged roles so the UI
    // never actively invites a QC Analyst or Sales Officer into the global
    // audit log / SLA breaches / all-department notifications.
    if (canViewGlobal(roleId)) {
      base.push(
        { id: "notifications", label: "Notifications",  icon: "✉", route: "#/notifications" },
        { id: "sla",           label: "SLA Breaches",   icon: "⏱", route: "#/sla" },
        { id: "audit",         label: "Audit Log",      icon: "☰", route: "#/audit" },
      );
    }

    if (roleId === "R000") {
      base.push(
        { id: "master", label: "Master Data", icon: "▣", route: "#/admin/master-data", section: "Admin" },
        { id: "sap",    label: "SAP Sync",    icon: "⇄", route: "#/admin/sap",         section: "Admin" },
        { id: "rollout",label: "Rollout",     icon: "◷", route: "#/admin/rollout",      section: "Admin" },
        { id: "archive",label: "Archive",     icon: "🗄", route: "#/admin/archive",      section: "Admin" },
      );
    }
    return base;
  }

  function portalFor(roleId) {
    return PORTALS[roleId] || { portal: "CCMS", dept: "—", accent: "#334155", icon: "●" };
  }

  function can(capability, roleId) {
    if (roleId === "R000") return true; // admin bypass
    const list = CAN[capability];
    return !!list && list.indexOf(roleId) !== -1;
  }

  // Can this role act on a complaint currently at `status`?
  // Handles the Clarification_Sought side-state the way the backend does.
  function canActOnStatus(roleId, status, priorStatus) {
    if (roleId === "R000") return true;
    let effective = status;
    if (status === "Clarification_Sought") effective = priorStatus || null;
    if (!effective) return false;
    const allowed = STATUS_ALLOWED_ROLES[effective];
    return !!allowed && allowed.indexOf(roleId) !== -1;
  }

  return {
    STATUS_ALLOWED_ROLES,
    navFor, portalFor, can, canActOnStatus, canViewGlobal,
  };
})();
