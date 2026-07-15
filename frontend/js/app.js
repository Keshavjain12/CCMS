// ============================================================
// APP BOOTSTRAP
// Registers every route → view, then starts the hash router.
// Loaded last (after all js/views/*.js) in index.html.
// ============================================================
window.CCMS = window.CCMS || {};

(function () {
  const R = CCMS.router;
  const V = CCMS.views;

  // Public
  R.add("/login", V.login);

  // Authenticated (router guards these)
  R.add("/dashboard", V.dashboard);
  R.add("/complaints", V.complaints);
  R.add("/complaints/new", V.createComplaint);
  R.add("/complaints/:no", V.complaintDetail);
  R.add("/notifications", V.notifications);
  R.add("/sla", V.sla);
  R.add("/audit", V.audit);

  // Admin
  R.add("/admin/master-data", V.masterData);
  R.add("/admin/sap", V.sap);
  R.add("/admin/rollout", V.rollout);
  R.add("/admin/archive", V.archive);

  document.title = CCMS.config.APP_NAME;

  // Best-effort: refresh the cached profile/permissions on load so the
  // UI reflects the server's current view of this user's role.
  if (CCMS.auth.isAuthenticated()) {
    CCMS.auth.refreshMe().catch(() => { /* token may be stale — router handles 401 */ });
  }

  R.start();
})();
