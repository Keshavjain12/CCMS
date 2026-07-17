window.CCMS = window.CCMS || {};

CCMS.roles = (function () {

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

  const CAN = {
    createComplaint: ["R000", "R001", "R002", "R011"],
    manageSamples:   ["R000", "R003", "R004"],
    manageCapa:      ["R000", "R005", "R006"],
    manageVisits:    ["R000", "R010", "R011"],
    creditNote:      ["R000", "R010"],
    masterDataWrite: ["R000"],
  };

  const GLOBAL_VIEW_ROLES = ["R000", "R009"];
  function canViewGlobal(roleId) {
    return GLOBAL_VIEW_ROLES.indexOf(roleId) !== -1;
  }

  const PORTALS = {
    R000: { portal: "Admin Console",         dept: "System",              accent: "#0355a6", icon: "⚙" },
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

  function navFor(roleId) {
    const base = [
      { id: "dashboard",     label: "Dashboard",     icon: "▤", route: "#/dashboard" },
      { id: "complaints",    label: "Complaints",    icon: "▦", route: "#/complaints" },
    ];

    if (can("createComplaint", roleId)) {
      base.push({ id: "create", label: "New Complaint", icon: "＋", route: "#/complaints/new" });
    }

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
    if (roleId === "R000") return true;
    const list = CAN[capability];
    return !!list && list.indexOf(roleId) !== -1;
  }

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
