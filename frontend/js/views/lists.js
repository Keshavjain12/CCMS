// ============================================================
// VIEWS: Notifications · SLA breaches · Global audit log
// (available to every authenticated role)
// ============================================================
window.CCMS = window.CCMS || {};
CCMS.views = CCMS.views || {};

// These three views expose company-wide data. Even though the nav hides them
// from non-privileged roles, a user could still type the hash route directly —
// so each view re-checks and refuses to even call the API. (The backend must
// independently enforce this and return 403; this guard is UX, not security.)
function globalViewGuard(mount, title) {
  const user = CCMS.auth.currentUser() || {};
  if (CCMS.roles.canViewGlobal(user.roleId)) return true;
  mount.appendChild(CCMS.ui.el("div.card", {}, [
    CCMS.ui.el("h2", { text: title + " — restricted" }),
    CCMS.ui.el("p", { text: "This company-wide view is limited to Admin and Managing Director roles." }),
    CCMS.ui.el("a.btn.btn-primary", { href: "#/dashboard", text: "Back to dashboard" }),
  ]));
  return false;
}

// ── Notifications ──────────────────────────────────────────
CCMS.views.notifications = async function (mount) {
  if (!globalViewGuard(mount, "Notifications")) return;
  const { el, dateFmt } = CCMS.ui;
  mount.appendChild(el("div.page-head", {}, [
    el("div", {}, [el("h1", { text: "Notifications" }), el("p.muted", { text: "Communication matrix — emails queued/sent per event." })]),
  ]));
  const card = el("div.card"); mount.appendChild(card);
  card.appendChild(CCMS.ui.spinner("Loading…"));
  try {
    const res = await CCMS.api.get("/api/notifications");
    CCMS.ui.clear(card);
    card.appendChild(el("div.card-head", {}, [
      el("h3", { text: (res.count || 0) + " notifications" }),
      CCMS.ui.pill("mode: " + (res.mode || "—"), res.mode === "live" ? "pill-ok" : "pill-warn"),
    ]));
    if (res.hint) card.appendChild(el("p.muted.sm", { text: res.hint }));
    const items = res.notifications || [];
    if (!items.length) { card.appendChild(CCMS.ui.empty("No notifications yet.")); return; }
    items.forEach((n) => {
      card.appendChild(el("div.sub-item", {}, [
        el("div.sub-main", {}, [
          el("strong", { text: n.subject || n.event || "Notification" }),
          n.complaintNo ? el("a.link", { href: "#/complaints/" + n.complaintNo, text: n.complaintNo }) : null,
        ]),
        el("div.sub-meta", { text: "To: " + fmtTo(n.to) + " · " + dateFmt(n.sentAt || n.at || n.timestamp) }),
        n.body ? el("div.tl-remarks", { text: n.body }) : null,
      ]));
    });
  } catch (err) { CCMS.ui.clear(card); card.appendChild(CCMS.ui.errorBox(err.message)); }

  function fmtTo(to) { return Array.isArray(to) ? to.join(", ") : (to || "—"); }
};

// ── SLA breaches ───────────────────────────────────────────
CCMS.views.sla = async function (mount) {
  if (!globalViewGuard(mount, "SLA breaches")) return;
  const { el, dateFmt } = CCMS.ui;
  mount.appendChild(el("div.page-head", {}, [
    el("div", {}, [el("h1", { text: "SLA breaches" }), el("p.muted", { text: "Auto-escalation engine — stages exceeding their SLA window." })]),
  ]));
  const card = el("div.card"); mount.appendChild(card);
  card.appendChild(CCMS.ui.spinner("Loading…"));
  try {
    const res = await CCMS.api.get("/api/sla/breaches");
    CCMS.ui.clear(card);
    const cfg = res.slaConfig || {};
    card.appendChild(el("div.card-head", {}, [
      el("h3", { text: (res.count || 0) + " breaches" }),
      el("small.muted", { text: "Stage " + (cfg.stageSLADays || "?") + "d · Sample " + (cfg.sampleSLADays || "?") + "d · Clarify " + (cfg.clarifySLADays || "?") + "d" }),
    ]));
    const items = res.breaches || [];
    if (!items.length) { card.appendChild(CCMS.ui.empty("No SLA breaches — everything is on time.")); return; }
    const t = el("table.table");
    t.appendChild(el("thead", {}, el("tr", {}, [
      el("th", { text: "Complaint" }), el("th", { text: "Status" }), el("th", { text: "Type" }),
      el("th", { text: "Age" }), el("th", { text: "Detected" }),
    ])));
    const tb = el("tbody");
    items.forEach((b) => {
      tb.appendChild(el("tr.row-link", { onClick: () => b.complaintNo && CCMS.router.go("#/complaints/" + b.complaintNo) }, [
        el("td", {}, [el("strong", { text: b.complaintNo || "—" })]),
        el("td", {}, [CCMS.ui.statusBadge(b.status)]),
        el("td", {}, [CCMS.ui.pill(b.breachType || b.type || "SLA", "pill-danger")]),
        el("td", { text: (b.ageDays != null ? b.ageDays + "d" : "—") }),
        el("td", { text: dateFmt(b.detectedAt || b.at) }),
      ]));
    });
    t.appendChild(tb);
    card.appendChild(t);
  } catch (err) { CCMS.ui.clear(card); card.appendChild(CCMS.ui.errorBox(err.message)); }
};

// ── Global audit log ───────────────────────────────────────
CCMS.views.audit = async function (mount) {
  if (!globalViewGuard(mount, "Audit log")) return;
  const { el, dateFmt } = CCMS.ui;
  mount.appendChild(el("div.page-head", {}, [
    el("div", {}, [el("h1", { text: "Audit log" }), el("p.muted", { text: "Immutable, append-only record of every human & system action." })]),
    el("button.btn.btn-ghost.btn-sm", { text: "Verify integrity", onClick: verify }),
  ]));
  const card = el("div.card"); mount.appendChild(card);
  card.appendChild(CCMS.ui.spinner("Loading…"));
  try {
    const entries = await CCMS.api.get("/api/audit-log");
    CCMS.ui.clear(card);
    const list = Array.isArray(entries) ? entries : (entries.entries || []);
    card.appendChild(el("div.card-head", {}, [el("h3", { text: list.length + " entries" })]));
    if (!list.length) { card.appendChild(CCMS.ui.empty("No audit entries.")); return; }
    const tl = el("div.timeline");
    list.slice().reverse().forEach((e) => {
      tl.appendChild(el("div.tl-item", {}, [
        el("div.tl-dot"),
        el("div.tl-body", {}, [
          el("div.tl-title", {}, [
            el("span", { text: e.action + (e.toStatus ? " → " + e.toStatus.replace(/_/g, " ") : "") }),
            e.complaintNo && e.complaintNo !== "SYSTEM" ? el("a.link", { href: "#/complaints/" + e.complaintNo, text: e.complaintNo }) : null,
          ]),
          el("div.tl-meta", { text: (e.actorRole || e.actorType || "") + " · " + dateFmt(e.timestamp || e.at) }),
          e.remarks ? el("div.tl-remarks", { text: e.remarks }) : null,
        ]),
      ]));
    });
    card.appendChild(tl);
  } catch (err) { CCMS.ui.clear(card); card.appendChild(CCMS.ui.errorBox(err.message)); }

  async function verify() {
    try {
      const res = await CCMS.api.get("/api/audit-log/verify");
      const ok = res.valid || res.intact || res.ok;
      CCMS.ui.toast("Integrity: " + (ok ? "VALID ✓" : "TAMPERED ✗") + (res.entries ? " (" + res.entries + " entries)" : ""), ok ? "success" : "error");
    } catch (err) { CCMS.ui.toast(err.message, "error"); }
  }
};
