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
    } catch (err) { CCMS.ui.clear(panel); panel.appendChild(CCMS.ui.errorBox(err.message)); }
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

  btn.addEventListener("click", async () => {
    btn.disabled = true; btn.textContent = "Syncing…";
    CCMS.ui.clear(out);
    try {
      const res = await CCMS.api.post("/api/master-data/sap-sync", {});
      toast("SAP sync complete.", "success");
      out.appendChild(el("div.card-head", {}, [el("h3", { text: "Last sync result" })]));
      out.appendChild(el("pre.code", { text: JSON.stringify(res.result || res, null, 2) }));
    } catch (err) { out.appendChild(CCMS.ui.errorBox(err.message)); toast(err.message, "error"); }
    finally { btn.disabled = false; btn.textContent = "Run nightly batch sync now"; }
  });
};

// ── Rollout ────────────────────────────────────────────────
CCMS.views.rollout = async function (mount) {
  if (!adminGuard(mount)) return;
  const { el } = CCMS.ui;
  mount.appendChild(el("div.page-head", {}, [
    el("div", {}, [el("h1", { text: "Phased rollout" }), el("p.muted", { text: "Section 12.8 — current rollout phase and feature flags." })]),
  ]));
  const card = el("div.card"); mount.appendChild(card);
  card.appendChild(CCMS.ui.spinner("Loading…"));
  try {
    const res = await CCMS.api.get("/api/rollout");
    CCMS.ui.clear(card);
    card.appendChild(el("div.card-head", {}, [
      el("h3", { text: "Rollout status" }),
      CCMS.ui.pill("Phase " + (res.phase || res.rolloutPhase || "?"), "pill-ok"),
    ]));
    card.appendChild(el("pre.code", { text: JSON.stringify(res, null, 2) }));
  } catch (err) { CCMS.ui.clear(card); card.appendChild(CCMS.ui.errorBox(err.message)); }
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
      CCMS.ui.clear(policyCard);
      policyCard.appendChild(el("div.card-head", {}, [el("h3", { text: "Retention policy" })]));
      policyCard.appendChild(el("pre.code", { text: JSON.stringify(policy, null, 2) }));

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
    } catch (err) { CCMS.ui.clear(listCard); listCard.appendChild(CCMS.ui.errorBox(err.message)); }
  }

  async function run() {
    try { const res = await CCMS.api.post("/api/archive/run", {}); toast("Archival check ran.", "success"); load(); }
    catch (err) { toast(err.message, "error"); }
  }
};
