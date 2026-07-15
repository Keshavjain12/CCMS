// ============================================================
// VIEW: Complaints list
// Filter by status / business line / "only mine to action".
// ============================================================
window.CCMS = window.CCMS || {};
CCMS.views = CCMS.views || {};

CCMS.views.complaints = async function (mount) {
  const { el, money, statusBadge } = CCMS.ui;
  const user = CCMS.auth.currentUser() || {};

  const head = el("div.page-head", {}, [
    el("div", {}, [
      el("h1", { text: "Complaints" }),
      el("p.muted", { text: "Every complaint you are permitted to view." }),
    ]),
  ]);
  if (CCMS.roles.can("createComplaint", user.roleId)) {
    head.appendChild(el("a.btn.btn-primary", { href: "#/complaints/new", text: "+ New Complaint" }));
  }
  mount.appendChild(head);

  // Filters
  const statusSel = el("select.input", {}, [el("option", { value: "", text: "All statuses" })]);
  [
    "Logged", "TS_Review", "QC_Review", "Sample_Awaited", "CAPA_Pending",
    "Ops_Head_Approval", "Marketing_Review", "Marketing_Head_Approval",
    "MD_Approval", "Visit_Pending", "Finance_Processing", "Closed",
    "Rejected", "Clarification_Sought", "Auto_Closed",
  ].forEach((s) => statusSel.appendChild(el("option", { value: s, text: s.replace(/_/g, " ") })));

  const blSel = el("select.input", {}, [
    el("option", { value: "", text: "All business lines" }),
    el("option", { value: "Paper", text: "Paper" }),
    el("option", { value: "Chemical", text: "Chemical" }),
  ]);
  const searchInput = el("input.input", { type: "search", placeholder: "Search No. / customer / title…" });
  const mineChk = el("input", { type: "checkbox" });

  const filters = el("div.filters", {}, [
    searchInput, statusSel, blSel,
    el("label.check", {}, [mineChk, el("span", { text: "Only awaiting my role" })]),
  ]);
  mount.appendChild(filters);

  const listCard = el("div.card");
  mount.appendChild(listCard);
  listCard.appendChild(CCMS.ui.spinner("Loading complaints…"));

  let all = [];
  try {
    const res = await CCMS.api.get("/api/complaints");
    all = res.data || [];
  } catch (err) {
    CCMS.ui.clear(listCard);
    listCard.appendChild(CCMS.ui.errorBox(err.message));
    return;
  }

  [statusSel, blSel].forEach((s) => s.addEventListener("change", paint));
  searchInput.addEventListener("input", debounce(paint, 150));
  mineChk.addEventListener("change", paint);
  paint();

  function paint() {
    const q = searchInput.value.trim().toLowerCase();
    const st = statusSel.value, bl = blSel.value, mine = mineChk.checked;

    let rows = all.filter((c) => {
      if (st && c.status !== st) return false;
      if (bl && c.businessLine !== bl) return false;
      if (mine && !CCMS.roles.canActOnStatus(user.roleId, c.status, c._priorStatus)) return false;
      if (q) {
        const hay = [c.complaintNo, c.customerName, c.title, c.invoiceNumber].join(" ").toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    CCMS.ui.clear(listCard);
    listCard.appendChild(el("div.card-head", {}, [
      el("h3", { text: rows.length + " complaint" + (rows.length === 1 ? "" : "s") }),
    ]));

    if (!rows.length) {
      listCard.appendChild(CCMS.ui.empty("No complaints match these filters."));
      return;
    }

    const t = el("table.table");
    t.appendChild(el("thead", {}, el("tr", {}, [
      el("th", { text: "Complaint No." }), el("th", { text: "Customer" }),
      el("th", { text: "Business Line" }), el("th", { text: "Status" }),
      el("th", { text: "Settlement" }), el("th", { text: "Policy" }), el("th", { text: "" }),
    ])));
    const tb = el("tbody");
    rows.forEach((c) => {
      const canAct = CCMS.roles.canActOnStatus(user.roleId, c.status, c._priorStatus) &&
        !["Closed", "Auto_Closed", "Rejected"].includes(c.status);
      tb.appendChild(el("tr.row-link", { onClick: () => CCMS.router.go("#/complaints/" + c.complaintNo) }, [
        el("td", {}, [
          el("strong", { text: c.complaintNo }),
          canAct ? el("span.dot-flag", { title: "Awaiting your action" }) : null,
        ]),
        el("td", { text: c.customerName || "—" }),
        el("td", {}, [CCMS.ui.pill(c.businessLine || "—", c.businessLine === "Chemical" ? "pill-chem" : "pill-paper")]),
        el("td", {}, [statusBadge(c.status)]),
        el("td", { text: money(c.settlementValue) }),
        el("td", {}, [c.policyCompliance === "Breach"
          ? CCMS.ui.pill("Breach", "pill-danger")
          : CCMS.ui.pill("OK", "pill-ok")]),
        el("td", {}, [el("span.chevron", { text: "›" })]),
      ]));
    });
    t.appendChild(tb);
    listCard.appendChild(t);
  }

  function debounce(fn, ms) {
    let h; return function () { clearTimeout(h); h = setTimeout(fn, ms); };
  }
};
