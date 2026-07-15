// ============================================================
// VIEWS: Admin Console  (role R000 only)
//   • Master data browser (9 entities)
//   • SAP nightly batch sync trigger
//   • Rollout phase / feature flags
//   • Data-retention archive
// ============================================================
window.CCMS = window.CCMS || {};
CCMS.views = CCMS.views || {};

function adminGuard(mount) {
  const user = CCMS.auth.currentUser() || {};
  if (user.roleId !== "R000") {
    mount.appendChild(CCMS.ui.el("div.card", {}, [
      CCMS.ui.el("h2", { text: "Administrator only" }),
      CCMS.ui.el("p", { text: "This section is restricted to the Admin role (R000)." }),
      CCMS.ui.el("a.btn.btn-primary", { href: "#/dashboard", text: "Back to dashboard" }),
    ]));
    return false;
  }
  return true;
}

// ── Master data browser ────────────────────────────────────
CCMS.views.masterData = async function (mount) {
  if (!adminGuard(mount)) return;
  const { el } = CCMS.ui;

  mount.appendChild(el("div.page-head", {}, [
    el("div", {}, [el("h1", { text: "Master data" }), el("p.muted", { text: "9 entities — synced from SAP (customers, products, policies) or configured locally." })]),
  ]));

  const ENTITIES = [
    ["customers", "Customers / Distributors"], ["users", "Users"], ["roles", "Roles"],
    ["departments", "Departments"], ["products", "Products / SKUs"], ["complaintTypes", "Complaint Types"],
    ["sampleTypes", "Sample Types"], ["salesPolicies", "Sales Policies"],
  ];

  const tabs = el("div.tabs");
  const panel = el("div.card");
  mount.appendChild(tabs);
  mount.appendChild(panel);

  ENTITIES.forEach(([key, label], i) => {
    const tab = el("button.tab" + (i === 0 ? ".active" : ""), { text: label, onClick: () => {
      tabs.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      loadEntity(key);
    } });
    tabs.appendChild(tab);
  });

  loadEntity("customers");

  async function loadEntity(key) {
    CCMS.ui.clear(panel);
    panel.appendChild(CCMS.ui.spinner("Loading " + key + "…"));
    try {
      const res = await CCMS.api.get("/api/master-data/" + key);
      CCMS.ui.clear(panel);
      const rows = res.data || [];
      panel.appendChild(el("div.card-head", {}, [el("h3", { text: res.entity + " · " + (res.count || rows.length) + " records" })]));
      if (!rows.length) { panel.appendChild(CCMS.ui.empty("No records.")); return; }
      panel.appendChild(dataTable(rows));
    } catch (err) { CCMS.ui.clear(panel); panel.appendChild(CCMS.ui.errorBox(err)); }
  }

  function dataTable(rows) {
    const cols = Object.keys(rows[0]).filter((k) => k[0] !== "_").slice(0, 8);
    const wrap = el("div.table-scroll");
    const t = el("table.table.compact");
    t.appendChild(el("thead", {}, el("tr", {}, cols.map((c) => el("th", { text: c })))));
    const tb = el("tbody");
    rows.forEach((r) => {
      tb.appendChild(el("tr", {}, cols.map((c) => {
        const v = r[c];
        const text = typeof v === "boolean" ? (v ? "✓" : "—") : (v == null ? "—" : String(v));
        return el("td", { text: text });
      })));
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    return wrap;
  }
};

// ── SAP sync ───────────────────────────────────────────────
CCMS.views.sap = async function (mount) {
  if (!adminGuard(mount)) return;
  const { el, toast } = CCMS.ui;

  mount.appendChild(el("div.page-head", {}, [
    el("div", {}, [el("h1", { text: "SAP integration" }), el("p.muted", { text: "Section 11.1 — nightly master data batch sync (customers, products, sales policies)." })]),
  ]));

  const out = el("div.card");
  const btn = el("button.btn.btn-primary.btn-lg", { text: "Run nightly batch sync now" });
  mount.appendChild(el("div.card", {}, [
    el("div.card-head", {}, [el("h3", { text: "Master data batch sync" })]),
    el("p.muted", { text: "Pulls Business Partner, Material Master, and Pricing Condition records from SAP (or mock)." }),
    btn,
  ]));
  mount.appendChild(out);

  btn.addEventListener("click", () => CCMS.ui.runAsync(btn, async () => {
    CCMS.ui.clear(out);
    try {
      const res = await CCMS.api.post("/api/master-data/sap-sync", {});
      const r = res.result || res;
      toast("SAP sync complete.", "success");

      // Was a JSON dump. The result is really three things: when it ran, what
      // came back per entity, and whether anything failed.
      out.appendChild(el("div.card-head", {}, [
        el("h3", { text: "Last sync result" }),
        CCMS.ui.pill(Object.keys(r.errors || {}).length ? "Completed with errors" : "Success",
          Object.keys(r.errors || {}).length ? "pill-danger" : "pill-ok"),
      ]));
      out.appendChild(el("p.muted.sm", { text: "Ran " + CCMS.ui.dateFmt(r.timestamp) }));

      const synced = r.synced || {};
      const counts = Object.keys(synced).filter((k) => typeof synced[k] === "number");
      if (counts.length) {
        const row = el("div.kpi-row");
        counts.forEach((k) => row.appendChild(el("div.kpi-tile", {}, [
          el("div.kpi-value", { text: String(synced[k]) }),
          el("div.kpi-label", { text: humanEntity(k) }),
        ])));
        out.appendChild(row);
      }
      // A note (e.g. "MOCK mode — already seeded") is information, not an entity
      // count, and belongs where it can be read rather than buried in JSON.
      if (synced.note) out.appendChild(CCMS.ui.gate({ name: "Mock mode", state: "na", why: synced.note }));

      const errs = Object.keys(r.errors || {});
      errs.forEach((k) => out.appendChild(CCMS.ui.gate({
        name: humanEntity(k) + " failed to sync", state: "blocked", why: String(r.errors[k]),
      })));
      if (!counts.length && !errs.length && !synced.note) out.appendChild(CCMS.ui.empty("Nothing to sync."));
    } catch (err) { out.appendChild(CCMS.ui.errorBox(err)); CCMS.ui.errorToast(err); }
  }));

  function humanEntity(k) {
    return ({ customers: "Customers", products: "Products / SKUs", salesPolicies: "Sales policies", invoices: "Invoices" })[k]
      || k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  }
};

// ── Rollout ────────────────────────────────────────────────
CCMS.views.rollout = async function (mount) {
  if (!adminGuard(mount)) return;
  const { el } = CCMS.ui;
  mount.appendChild(el("div.page-head", {}, [
    el("div", {}, [el("h1", { text: "Phased rollout" }), el("p.muted", { text: "Section 12.8 — current rollout phase and feature flags." })]),
  ]));
  const card = el("div.card"); mount.appendChild(card);
  const flagCard = el("div.card"); mount.appendChild(flagCard);
  card.appendChild(el("div.skel.skel-title"));
  card.appendChild(CCMS.ui.skelRows(3));

  try {
    const res = await CCMS.api.get("/api/rollout");
    CCMS.ui.clear(card);
    CCMS.ui.clear(flagCard);

    // This screen used to be JSON.stringify in a <pre>. The reader had to
    // parse a blob to answer the only two questions it exists for: which phase
    // are we in, and what does that phase allow?
    card.appendChild(el("div.card-head", {}, [
      el("h3", { text: "Rollout status" }),
      CCMS.ui.pill("Phase " + (res.currentPhase || "?"), "pill-ok"),
    ]));

    // Phase stepper — where we are in a three-step plan, not a number.
    const phases = res.allPhases || [];
    const stepper = el("div.phase-track");
    phases.forEach((p) => {
      const state = p.active ? "current" : (p.phase < res.currentPhase ? "done" : "todo");
      stepper.appendChild(el("div.phase-step." + state, {}, [
        el("div.phase-dot", { text: p.active ? String(p.phase) : (p.phase < res.currentPhase ? "✓" : String(p.phase)) }),
        el("div.phase-body", {}, [
          el("div.phase-name", { text: String(p.label || "").replace(/^Phase \d+ — /, "") }),
          el("div.phase-desc", { text: p.description || "" }),
        ]),
      ]));
    });
    card.appendChild(stepper);

    // What the active phase actually admits — the thing the gate enforces.
    card.appendChild(el("div.kv-block", {}, [
      el("div.kv", {}, [
        el("span.kv-label", { text: "Business lines" }),
        el("span.kv-value", {}, (res.allowedBusinessLines || []).map((b) => CCMS.ui.pill(b, "pill-ok"))),
      ]),
      el("div.kv", {}, [
        el("span.kv-label", { text: "Regions" }),
        el("span.kv-value", {}, res.allowedRegions === "*"
          ? [CCMS.ui.pill("All regions", "pill-ok")]
          : (res.allowedRegions || []).map((r) => CCMS.ui.pill(r, "pill-ok"))),
      ]),
      el("div.kv", {}, [
        el("span.kv-label", { text: "Concurrent complaints" }),
        el("span.kv-value", { text: res.maxConcurrentComplaints == null ? "No limit" : String(res.maxConcurrentComplaints) }),
      ]),
    ]));
    if (res.howToAdvance) card.appendChild(el("p.muted.sm", { text: res.howToAdvance }));

    // Feature flags, as on/off rather than a JSON object. These are real now:
    // the archival engine consults them.
    flagCard.appendChild(el("div.card-head", {}, [el("h3", { text: "Feature flags" })]));
    const feats = res.features || {};
    const grid = el("div.flag-grid");
    Object.keys(feats).forEach((k) => {
      const on = feats[k] === true;
      grid.appendChild(el("div.flag." + (on ? "on" : "off"), {}, [
        el("span.flag-dot", { text: on ? "✓" : "–", "aria-hidden": "true" }),
        el("span.flag-name", { text: humanFlag(k) }),
        el("span.flag-state", { text: on ? "On" : "Off" }),
      ]));
    });
    flagCard.appendChild(grid);
  } catch (err) { CCMS.ui.clear(card); card.appendChild(CCMS.ui.errorBox(err)); }

  function humanFlag(k) {
    return ({
      slaEngine: "SLA auto-escalation", notifications: "Email notifications",
      rbac: "Role-based access control", kpiDashboard: "KPI dashboard",
      archival: "Data retention & archival", repeatDetection: "Repeat complaint detection",
    })[k] || k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  }
};

// ── Archive ────────────────────────────────────────────────
CCMS.views.archive = async function (mount) {
  if (!adminGuard(mount)) return;
  const { el, toast } = CCMS.ui;
  mount.appendChild(el("div.page-head", {}, [
    el("div", {}, [el("h1", { text: "Data retention & archive" }), el("p.muted", { text: "Section 12.7 — archived complaints and retention policy." })]),
    el("button.btn.btn-ghost.btn-sm", { text: "Run archival check", onClick: run }),
  ]));
  const policyCard = el("div.card");
  const listCard = el("div.card");
  mount.appendChild(policyCard);
  mount.appendChild(listCard);
  load();

  async function load() {
    CCMS.ui.clear(policyCard); CCMS.ui.clear(listCard);
    policyCard.appendChild(CCMS.ui.spinner("Loading policy…"));
    listCard.appendChild(CCMS.ui.spinner("Loading archive…"));
    try {
      const [policy, arch] = await Promise.all([
        CCMS.api.get("/api/archive/policy").catch(() => ({})),
        CCMS.api.get("/api/archive").catch(() => ({ complaints: [] })),
      ]);
      // Was a JSON dump of the policy object. It is a set of rules with a
      // window, an effect and a reason — which is readable prose, not a blob.
      CCMS.ui.clear(policyCard);
      policyCard.appendChild(el("div.card-head", {}, [
        el("h3", { text: "Retention policy" }),
        CCMS.ui.pill(policy.enabled ? "Engine on" : "Engine off", policy.enabled ? "pill-ok" : "pill-warn"),
      ]));
      if (policy.tickHours) {
        policyCard.appendChild(el("p.muted.sm", { text: "Checks every " + policy.tickHours + " hour(s)." }));
      }
      (policy.rules || []).forEach((r) => {
        policyCard.appendChild(el("div.rule", {}, [
          el("div.rule-head", {}, [
            el("strong", { text: r.rule }),
            CCMS.ui.pill(r.window, "pill-warn"),
          ]),
          el("div.rule-action", { text: r.action }),
          r.rationale ? el("div.rule-why", { text: r.rationale }) : null,
        ]));
      });
      const stats = policy.currentStats || {};
      if (stats.totalArchived != null) {
        policyCard.appendChild(el("p.muted.sm", {
          text: stats.totalArchived + " complaint(s) archived to date"
            + (stats.archivalLogEntriesThisRun != null ? " · " + stats.archivalLogEntriesThisRun + " action(s) logged since this server started" : ""),
        }));
      }

      CCMS.ui.clear(listCard);
      const rows = arch.complaints || [];
      listCard.appendChild(el("div.card-head", {}, [el("h3", { text: (arch.count != null ? arch.count : rows.length) + " archived complaints" })]));
      if (!rows.length) { listCard.appendChild(CCMS.ui.empty("Nothing archived yet.")); return; }
      const t = el("table.table");
      t.appendChild(el("thead", {}, el("tr", {}, [el("th", { text: "Complaint" }), el("th", { text: "Status" }), el("th", { text: "Archived" })])));
      const tb = el("tbody");
      rows.forEach((c) => tb.appendChild(el("tr", {}, [
        el("td", {}, [el("strong", { text: c.complaintNo })]),
        el("td", {}, [CCMS.ui.statusBadge(c.status)]),
        el("td", { text: CCMS.ui.dateFmt(c.archivedAt) }),
      ])));
      t.appendChild(tb); listCard.appendChild(t);
    } catch (err) { CCMS.ui.clear(listCard); listCard.appendChild(CCMS.ui.errorBox(err)); }
  }

  async function run() {
    try { const res = await CCMS.api.post("/api/archive/run", {}); toast("Archival check ran.", "success"); load(); }
    catch (err) { CCMS.ui.errorToast(err); }
  }
};
