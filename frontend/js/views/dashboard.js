// ============================================================
// VIEW: Dashboard  (role-aware landing)
// KPI tiles + "My action queue" (complaints this role can act on)
// ============================================================
window.CCMS = window.CCMS || {};
CCMS.views = CCMS.views || {};

CCMS.views.dashboard = async function (mount) {
  const { el, money, statusBadge } = CCMS.ui;
  const user = CCMS.auth.currentUser() || {};
  const portal = CCMS.roles.portalFor(user.roleId);

  mount.appendChild(el("div.page-head", {}, [
    el("div", {}, [
      el("h1", { text: "Good day, " + (user.name ? user.name.split(" ")[0] : "there") }),
      el("p.muted", { text: portal.portal + " portal · " + (user.roleName || "") }),
    ]),
  ]));

  const kpiRow = el("div.kpi-row");
  const queueCard = el("div.card");
  const pipeCard = el("div.card");
  mount.appendChild(kpiRow);
  mount.appendChild(el("div.grid-2", {}, [queueCard, pipeCard]));

  kpiRow.appendChild(CCMS.ui.spinner("Loading KPIs…"));

  try {
    const [kpi, list] = await Promise.all([
      CCMS.api.get("/api/kpi").catch(() => null),
      CCMS.api.get("/api/complaints"),
    ]);

    // ── KPI tiles ──
    CCMS.ui.clear(kpiRow);
    const s = (kpi && kpi.summary) || {};
    const all = list.data || [];
    const myQueue = all.filter((c) =>
      CCMS.roles.canActOnStatus(user.roleId, c.status, c._priorStatus) &&
      !["Closed", "Auto_Closed", "Rejected"].includes(c.status)
    );

    tiles(kpiRow, [
      { label: "My action queue", value: myQueue.length, accent: true, sub: "awaiting you" },
      { label: "Total complaints", value: s.total != null ? s.total : all.length },
      { label: "Open", value: s.open != null ? s.open : all.filter((c) => !["Closed", "Auto_Closed"].includes(c.status)).length },
      { label: "Closed", value: s.closed != null ? s.closed : all.filter((c) => c.status === "Closed").length },
      { label: "Settlement (open)", value: money(sumSettlement(all)), small: true },
      { label: "Settlement (total)", value: money(sumAllSettlement(all, kpi)), small: true },
    ]);

    // ── My action queue ──
    CCMS.ui.clear(queueCard);
    queueCard.appendChild(el("div.card-head", {}, [
      el("h3", { text: "My action queue" }),
      el("a.link", { href: "#/complaints", text: "All complaints →" }),
    ]));
    if (!myQueue.length) {
      queueCard.appendChild(CCMS.ui.empty("Nothing is waiting on your role right now."));
    } else {
      const t = el("table.table");
      t.appendChild(el("thead", {}, el("tr", {}, [
        el("th", { text: "Complaint" }), el("th", { text: "Customer" }),
        el("th", { text: "Status" }), el("th", { text: "Value" }),
      ])));
      const tb = el("tbody");
      myQueue.slice(0, 8).forEach((c) => {
        tb.appendChild(el("tr.row-link", { onClick: () => CCMS.router.go("#/complaints/" + c.complaintNo) }, [
          el("td", {}, [el("strong", { text: c.complaintNo })]),
          el("td", { text: c.customerName || "—" }),
          el("td", {}, [statusBadge(c.status)]),
          el("td", { text: money(c.settlementValue) }),
        ]));
      });
      t.appendChild(tb);
      queueCard.appendChild(t);
    }

    // ── Pipeline by status ──
    CCMS.ui.clear(pipeCard);
    pipeCard.appendChild(el("div.card-head", {}, [el("h3", { text: "Pipeline by status" })]));
    const byStatus = groupBy(all, "status");
    const statuses = Object.keys(byStatus).sort((a, b) => byStatus[b].length - byStatus[a].length);
    if (!statuses.length) {
      pipeCard.appendChild(CCMS.ui.empty("No complaints yet."));
    } else {
      const maxN = Math.max.apply(null, statuses.map((k) => byStatus[k].length));
      statuses.forEach((st) => {
        const n = byStatus[st].length;
        pipeCard.appendChild(el("div.bar-row", {}, [
          el("div.bar-label", {}, [statusBadge(st)]),
          el("div.bar-track", {}, [
            el("div.bar-fill", { style: "width:" + Math.max(6, (n / maxN) * 100) + "%" }),
          ]),
          el("div.bar-value", { text: String(n) }),
        ]));
      });
    }

    if (kpi && kpi.sapHealth) {
      pipeCard.appendChild(el("div.sap-health", {}, [
        el("span.dot." + (String(kpi.sapHealth.status || "").toLowerCase().includes("mock") ? "warn" : "ok")),
        el("small", { text: "SAP: " + (kpi.sapHealth.mode || kpi.sapHealth.status || "unknown") }),
      ]));
    }
  } catch (err) {
    CCMS.ui.clear(kpiRow);
    mount.appendChild(CCMS.ui.errorBox(err.message));
  }

  // ── helpers ──
  function tiles(host, defs) {
    defs.forEach((d) => {
      host.appendChild(el("div.kpi-tile" + (d.accent ? ".accent" : ""), {}, [
        el("div.kpi-value" + (d.small ? ".sm" : ""), { text: String(d.value) }),
        el("div.kpi-label", { text: d.label }),
        d.sub ? el("div.kpi-sub", { text: d.sub }) : null,
      ]));
    });
  }
  function groupBy(arr, key) {
    return arr.reduce((m, x) => { (m[x[key]] = m[x[key]] || []).push(x); return m; }, {});
  }
  function sumSettlement(arr) {
    return arr.filter((c) => !["Closed", "Auto_Closed", "Rejected"].includes(c.status))
      .reduce((s, c) => s + Number(c.settlementValue || 0), 0);
  }

  // Total settlement across ALL complaints (open + closed). Prefer the
  // authoritative backend figure; fall back to summing the loaded list.
  function sumAllSettlement(arr, kpi) {
    if (kpi && kpi.settlement && kpi.settlement.totalValue != null) return kpi.settlement.totalValue;
    return arr.reduce((s, c) => s + Number(c.settlementValue || 0), 0);
  }
};
