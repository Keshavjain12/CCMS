window.CCMS = window.CCMS || {};

(function () {
  const R = CCMS.router;
  const V = CCMS.views;

  R.add("/login", V.login);

  R.add("/dashboard", V.dashboard);
  R.add("/complaints", V.complaints);
  R.add("/complaints/new", V.createComplaint);
  R.add("/complaints/:no", V.complaintDetail);
  R.add("/notifications", V.notifications);
  R.add("/sla", V.sla);
  R.add("/audit", V.audit);

  R.add("/admin/master-data", V.masterData);
  R.add("/admin/sap", V.sap);
  R.add("/admin/rollout", V.rollout);
  R.add("/admin/archive", V.archive);

  document.title = CCMS.config.APP_NAME;

  if (CCMS.auth.isAuthenticated()) {
    CCMS.auth.refreshMe().catch(() => {  });
  }

  R.start();
})();
