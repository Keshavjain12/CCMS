// ============================================================
// VIEW: Complaint detail  — the working surface for every portal
// Shows the full record + the actions THIS role may perform at
// THIS status. The backend re-authorises every call.
// ============================================================
window.CCMS = window.CCMS || {};
CCMS.views = CCMS.views || {};

CCMS.views.complaintDetail = async function (mount, params) {
  const { el, money, dateFmt, dateOnly, statusBadge, pill, toast } = CCMS.ui;
  const user = CCMS.auth.currentUser() || {};
  const no = params.no;

  mount.appendChild(el("div.page-head", {}, [
    el("a.link.back", { href: "#/complaints", text: "← Back to complaints" }),
  ]));
  const container = el("div#detail-body");
  mount.appendChild(container);
  container.appendChild(CCMS.ui.spinner("Loading complaint " + no + "…"));

  let masterCache = null;
  await load();

  async function load() {
    try {
      const c = await CCMS.api.get("/api/complaints/" + encodeURIComponent(no));
      render(c);
    } catch (err) {
      CCMS.ui.clear(container);
      container.appendChild(CCMS.ui.errorBox(err.message));
    }
  }

  function reload() { CCMS.ui.clear(container); container.appendChild(CCMS.ui.spinner("Refreshing…")); load(); }

  function render(c) {
    CCMS.ui.clear(container);

    const canAct = CCMS.roles.canActOnStatus(user.roleId, c.status, c._priorStatus);
    const terminal = ["Closed", "Auto_Closed", "Rejected"].includes(c.status);

    // ── Header card ──
    container.appendChild(el("div.card.detail-head", {}, [
      el("div.detail-title", {}, [
        el("div", {}, [
          el("h1", { text: c.complaintNo }),
          el("p.muted", { text: c.title || "" }),
        ]),
        el("div.detail-status", {}, [
          statusBadge(c.status),
          c._sapFallback ? pill("SAP fallback", "pill-danger") : null,
        ]),
      ]),
      el("div.fact-grid", {}, [
        fact("Customer", c.customerName + (c.isKeyAccount ? "  ★ Key Account" : "")),
        fact("Business Line", c.businessLine),
        fact("Invoice", c.invoiceNumber + " · " + dateOnly(c.invoiceDate)),
        fact("Invoice Value", money(c.invoiceValue)),
        fact("Settlement Value", money(c.settlementValue)),
        fact("Policy", (c.policyId || "—") + " · " + (c.policyCompliance || "—")),
        fact("Reported By", c.reportedBy || "—"),
        fact("Created", dateFmt(c.createdAt)),
      ]),
      c.policyCompliance === "Breach"
        ? el("div.policy-alert", {}, [
            el("strong", { text: "⚠ Sales Policy Breach — " }),
            el("span", { text: c.policyClauseBreached || "policy conditions not met" }),
            c.policyForcesMdApproval ? el("span", { text: "  · MD approval enforced" }) : null,
          ])
        : null,
    ]));

    // ── Workflow progress ──
    container.appendChild(workflowStrip(c));

    // ── Two-column body ──
    const left = el("div.detail-col");
    const right = el("div.detail-col.detail-side");
    container.appendChild(el("div.detail-grid", {}, [left, right]));

    // LEFT: line items, samples, capa, visits, credit notes
    left.appendChild(lineItemsCard(c));
    if (c.samples && c.samples.length || isQC()) left.appendChild(samplesCard(c));
    if (c.capas && c.capas.length || isOps()) left.appendChild(capaCard(c));
    if (c.visits && c.visits.length || isVisitRole()) left.appendChild(visitsCard(c));
    if (c.creditNotes && c.creditNotes.length || isFinance()) left.appendChild(creditNoteCard(c));
    left.appendChild(auditCard(c));

    // RIGHT: action panel + gates
    right.appendChild(actionPanel(c, canAct, terminal));
    right.appendChild(gatesCard(c));
    if (c.attachments && c.attachments.length) right.appendChild(attachmentsCard(c));
  }

  // ── role predicates ──
  function isQC()      { return ["R000", "R003", "R004"].includes(user.roleId); }
  function isOps()     { return ["R000", "R005", "R006"].includes(user.roleId); }
  function isVisitRole(){ return ["R000", "R010", "R011"].includes(user.roleId); }
  function isFinance() { return ["R000", "R010"].includes(user.roleId); }

  function fact(label, value) {
    return el("div.fact", {}, [
      el("span.fact-label", { text: label }),
      el("span.fact-value", { text: value == null || value === "" ? "—" : String(value) }),
    ]);
  }

  // ── Workflow strip ──
  function workflowStrip(c) {
    const seq = (c.statusSequence || []).length ? c.statusSequence : defaultSeq();
    const curIdx = seq.indexOf(c.status);
    const strip = el("div.card.workflow", {}, [el("div.card-head", {}, [el("h3", { text: "Workflow" })])]);
    const track = el("div.wf-track");
    seq.forEach((st, i) => {
      const state = i < curIdx ? "done" : i === curIdx ? "current" : "todo";
      track.appendChild(el("div.wf-step." + state, {}, [
        el("span.wf-dot", { text: i < curIdx ? "✓" : String(i + 1) }),
        el("span.wf-name", { text: st.replace(/_/g, " ") }),
      ]));
    });
    strip.appendChild(track);
    if (["Rejected", "Clarification_Sought", "Auto_Closed"].includes(c.status)) {
      strip.appendChild(el("div.wf-sidestate", {}, [
        pill(c.status.replace(/_/g, " "), "pill-danger"),
        el("small", { text: c._priorStatus ? "Paused from: " + c._priorStatus.replace(/_/g, " ") : "" }),
      ]));
    }
    return strip;
    function defaultSeq() {
      return ["Logged", "TS_Review", "QC_Review", "CAPA_Pending", "Ops_Head_Approval",
        "Marketing_Review", "Marketing_Head_Approval", "Finance_Processing", "Closed"];
    }
  }

  // ── Line items ──
  function lineItemsCard(c) {
    const card = el("div.card", {}, [el("div.card-head", {}, [el("h3", { text: "Line items (" + (c.lineItems || []).length + ")" })])]);
    if (!(c.lineItems || []).length) { card.appendChild(CCMS.ui.empty("No line items.")); return card; }
    const t = el("table.table");
    t.appendChild(el("thead", {}, el("tr", {}, [
      el("th", { text: "Product" }), el("th", { text: "Type" }), el("th", { text: "Inv Qty" }),
      el("th", { text: "Defective" }), el("th", { text: "Unit Price" }), el("th", { text: "Defective Value" }), el("th", { text: "Sample?" }),
    ])));
    const tb = el("tbody");
    (c.lineItems || []).forEach((li) => {
      tb.appendChild(el("tr", {}, [
        el("td", {}, [el("strong", { text: li.productName || li.sapMaterialNo || "—" }), el("small.muted", { text: " " + (li.sapMaterialNo || "") })]),
        el("td", { text: li.complaintTypeName || li.complaintTypeId || "—" }),
        el("td", { text: (li.invoiceQty != null ? li.invoiceQty : "—") + " " + (li.uom || "") }),
        el("td", { text: String(li.defectiveQty != null ? li.defectiveQty : "—") }),
        el("td", { text: money(li.unitPrice) }),
        el("td", {}, [el("strong", { text: money((li.unitPrice || 0) * (li.defectiveQty || 0)) })]),
        el("td", {}, [li.sampleRequired ? pill("Required", "pill-warn") : pill("No", "pill-ok")]),
      ]));
    });
    t.appendChild(tb);
    card.appendChild(t);
    return card;
  }

  // ── Samples (QC portal) ──
  function samplesCard(c) {
    const card = el("div.card", {}, [el("div.card-head", {}, [
      el("h3", { text: "Physical samples (QC)" }),
      isQC() && !terminalStatus(c) ? el("button.btn.btn-sm.btn-primary", { text: "+ Sample", onClick: () => sampleForm(c) }) : null,
    ])]);
    if (!(c.samples || []).length) { card.appendChild(CCMS.ui.empty("No sample record yet.")); return card; }
    (c.samples || []).forEach((s) => {
      card.appendChild(el("div.sub-item", {}, [
        el("div.sub-main", {}, [
          el("strong", { text: s.sampleTypeName || s.sampleTypeId || "Sample" }),
          statusBadge(s.sampleStatus || "Awaited"),
        ]),
        el("div.sub-meta", { text:
          "Dispatch: " + (s.dispatchMode || "—") + " · Received: " + (s.receivedDate ? dateOnly(s.receivedDate) : "pending") +
          (s.testResult ? " · Result: " + s.testResult : "") }),
        isQC() && !terminalStatus(c)
          ? el("div.sub-actions", {}, [el("button.btn.btn-xs.btn-ghost", { text: "Update status", onClick: () => sampleUpdateForm(c, s) })])
          : null,
      ]));
    });
    return card;
  }

  // ── CAPA (Operations portal) ──
  function capaCard(c) {
    const card = el("div.card", {}, [el("div.card-head", {}, [
      el("h3", { text: "CAPA (Operations)" }),
      isOps() && ["QC_Review", "Sample_Awaited", "CAPA_Pending"].includes(c.status)
        ? el("button.btn.btn-sm.btn-primary", { text: "+ Document CAPA", onClick: () => capaForm(c) }) : null,
    ])]);
    if (!(c.capas || []).length) { card.appendChild(CCMS.ui.empty("No CAPA documented yet.")); return card; }
    (c.capas || []).forEach((cp) => {
      card.appendChild(el("div.sub-item", {}, [
        kv("Root cause", cp.rootCauseDescription),
        kv("Corrective", cp.correctiveAction),
        kv("Preventive", cp.preventiveAction),
        el("div.sub-meta", { text: "By " + (cp.documentedByName || cp.documentedBy || "—") }),
      ]));
    });
    return card;
  }

  // ── Visits (Sales/Finance portal) ──
  function visitsCard(c) {
    const card = el("div.card", {}, [el("div.card-head", {}, [
      el("h3", { text: "Customer visits" }),
      isVisitRole() && !terminalStatus(c) ? el("button.btn.btn-sm.btn-primary", { text: "+ Schedule visit", onClick: () => visitForm(c) }) : null,
    ])]);
    if (!(c.visits || []).length) { card.appendChild(CCMS.ui.empty("No visit scheduled.")); return card; }
    (c.visits || []).forEach((v) => {
      card.appendChild(el("div.sub-item", {}, [
        el("div.sub-main", {}, [
          el("strong", { text: (v.visitType || "Visit") + " visit" }),
          statusBadge(v.visitStatus || "Planned"),
        ]),
        el("div.sub-meta", { text: "Scheduled: " + dateOnly(v.scheduledDate) + " · Assigned: " + (v.assignedTo || "—") +
          (v.outcome ? " · Outcome: " + v.outcome : "") }),
        v.findings ? kv("Findings", v.findings) : null,
        isVisitRole() && v.visitStatus !== "Completed" && !terminalStatus(c)
          ? el("div.sub-actions", {}, [el("button.btn.btn-xs.btn-ghost", { text: "Record outcome", onClick: () => visitUpdateForm(c, v) })])
          : null,
      ]));
    });
    return card;
  }

  // ── Credit notes (Finance portal) ──
  function creditNoteCard(c) {
    const card = el("div.card", {}, [el("div.card-head", {}, [
      el("h3", { text: "Credit note (SAP)" }),
      isFinance() && c.status === "Finance_Processing" && !c.creditNoteNumber
        ? el("button.btn.btn-sm.btn-primary", { text: "Raise credit note in SAP", onClick: () => creditNoteForm(c) }) : null,
    ])]);
    if (!(c.creditNotes || []).length) {
      card.appendChild(CCMS.ui.empty(c.status === "Finance_Processing"
        ? "No credit note raised yet — required before closing."
        : "No credit note yet."));
      return card;
    }
    (c.creditNotes || []).forEach((cn) => {
      card.appendChild(el("div.sub-item", {}, [
        el("div.sub-main", {}, [el("strong", { text: cn.creditNoteNumber }), pill("SAP " + (cn.sapDocumentNumber || ""), "pill-ok")]),
        el("div.sub-meta", { text: money(cn.amount) + " · Raised by " + (cn.raisedByName || cn.raisedBy || "—") }),
      ]));
    });
    return card;
  }

  // ── Attachments ──
  function attachmentsCard(c) {
    const card = el("div.card", {}, [el("div.card-head", {}, [el("h3", { text: "Attachments" })])]);
    (c.attachments || []).forEach((a) => {
      card.appendChild(el("div.sub-item.compact", {}, [
        el("strong", { text: a.fileType || "file" }),
        el("small.muted", { text: " " + (a.description || a.fileReference || "") }),
      ]));
    });
    return card;
  }

  // ── Audit trail ──
  function auditCard(c) {
    const card = el("div.card", {}, [el("div.card-head", {}, [
      el("h3", { text: "Audit trail" }),
      // The per-complaint trail below is fine for anyone who can view this
      // complaint, but the cross-link to the GLOBAL log is only for the
      // privileged roles that are actually allowed to open it.
      CCMS.roles.canViewGlobal(user.roleId)
        ? el("a.link", { href: "#/audit", text: "Full log →" })
        : null,
    ])]);
    const list = el("div.timeline");
    card.appendChild(list);
    list.appendChild(CCMS.ui.spinner("Loading trail…"));
    CCMS.api.get("/api/complaints/" + encodeURIComponent(c.complaintNo) + "/audit-log")
      .then((res) => {
        CCMS.ui.clear(list);
        const entries = res.entries || [];
        if (!entries.length) { list.appendChild(CCMS.ui.empty("No audit entries.")); return; }
        entries.forEach((e) => {
          list.appendChild(el("div.tl-item", {}, [
            el("div.tl-dot"),
            el("div.tl-body", {}, [
              el("div.tl-title", { text: e.action + (e.toStatus ? " → " + e.toStatus.replace(/_/g, " ") : "") }),
              el("div.tl-meta", { text: (e.actorRole || e.actorType || "") + " · " + dateFmt(e.timestamp || e.at) }),
              e.remarks ? el("div.tl-remarks", { text: e.remarks }) : null,
            ]),
          ]));
        });
      })
      .catch((err) => { CCMS.ui.clear(list); list.appendChild(CCMS.ui.errorBox(err.message)); });
    return card;
  }

  // ── Gates ──
  function gatesCard(c) {
    const g = {
      "Sample required": c.sampleRequired,
      "MD approval": c.settlementValue > 100000 || c.policyForcesMdApproval,
      "Customer visit": c.isKeyAccount || c.settlementValue > 50000 || c.visitRequested,
      "Credit note recorded": !!c.creditNoteNumber,
    };
    const card = el("div.card", {}, [el("div.card-head", {}, [el("h3", { text: "Gates" })])]);
    Object.keys(g).forEach((k) => {
      card.appendChild(el("div.gate-row", {}, [
        el("span.gate-icon." + (g[k] ? "on" : "off"), { text: g[k] ? "●" : "○" }),
        el("span", { text: k }),
        el("span.gate-state", { text: g[k] ? "Yes" : "No" }),
      ]));
    });
    return card;
  }

  // ── Action panel (universal workflow actions) ──
  function actionPanel(c, canAct, terminal) {
    const card = el("div.card.action-panel", {}, [el("div.card-head", {}, [el("h3", { text: "Actions" })])]);

    if (terminal) {
      card.appendChild(el("div.action-note", { text: "This complaint is " + c.status.replace(/_/g, " ").toLowerCase() + " — no further workflow actions." }));
      return card;
    }
    if (!canAct) {
      const allowed = CCMS.roles.STATUS_ALLOWED_ROLES[c.status === "Clarification_Sought" ? c._priorStatus : c.status];
      card.appendChild(el("div.action-note", { text:
        "Your role (" + (user.roleName || user.roleId) + ") cannot action this stage." +
        (allowed ? " Awaiting: " + allowed.join(", ") + "." : "") }));
      return card;
    }

    card.appendChild(el("p.muted.sm", { text: "You are authorised to act at " + c.status.replace(/_/g, " ") + "." }));

    const buttons = el("div.action-buttons");
    const approveLabel = user.canApprove ? "Approve / Advance" : "Forward";
    buttons.appendChild(el("button.btn.btn-primary.btn-block", { text: approveLabel, onClick: () => actionForm(c, "approve", approveLabel) }));
    if (user.canReject || user.isAdmin) {
      buttons.appendChild(el("button.btn.btn-danger.btn-block", { text: "Reject", onClick: () => actionForm(c, "reject", "Reject") }));
    }
    if (c.status === "Clarification_Sought") {
      buttons.appendChild(el("button.btn.btn-ghost.btn-block", { text: "Resolve clarification", onClick: () => actionForm(c, "resolve_clarification", "Resolve clarification") }));
    } else {
      buttons.appendChild(el("button.btn.btn-ghost.btn-block", { text: "Seek clarification", onClick: () => actionForm(c, "clarify", "Seek clarification") }));
    }
    if (user.isAdmin) {
      buttons.appendChild(el("button.btn.btn-ghost.btn-block", { text: "Auto-close (admin)", onClick: () => actionForm(c, "auto_close", "Auto-close") }));
    }
    card.appendChild(buttons);

    // Stage hints for the specific portals
    const hints = [];
    if (["QC_Review", "Sample_Awaited"].includes(c.status) && c.sampleRequired && !sampleReceived(c)) {
      hints.push("Sample gate: approval is blocked until a sample is marked Received.");
    }
    if (c.status === "Finance_Processing" && !c.creditNoteNumber) {
      hints.push("Finance gate: raise the SAP credit note before approving to Closed.");
    }
    hints.forEach((h) => card.appendChild(el("div.action-hint", { text: "ⓘ " + h })));

    return card;
  }

  function sampleReceived(c) {
    const order = ["Awaited", "Received", "Under Testing", "Tested", "Disposed"];
    return (c.samples || []).some((s) => order.indexOf(s.sampleStatus) >= 1);
  }
  function terminalStatus(c) { return ["Closed", "Auto_Closed", "Rejected"].includes(c.status); }

  function kv(label, value) {
    return el("div.kv", {}, [el("span.kv-label", { text: label }), el("span.kv-value", { text: value || "—" })]);
  }

  // =====================================================================
  // FORMS (modals) — each posts to the backend then reloads the view
  // =====================================================================

  function actionForm(c, action, label) {
    const remarks = el("textarea.input", { rows: "3", placeholder: "Remarks (optional)…" });
    CCMS.ui.openModal({
      title: label + " — " + c.complaintNo,
      body: el("div", {}, [
        el("p.muted", { text: "Current status: " + c.status.replace(/_/g, " ") }),
        el("label.field", {}, [el("span", { text: "Remarks" }), remarks]),
      ]),
      actions: [
        { label: "Cancel", cls: "btn-ghost" },
        { label: label, cls: action === "reject" ? "btn-danger" : "btn-primary", onClick: async (close) => {
          try {
            // Do NOT send actorId / actorRole. Who is acting (and with what
            // role) must be derived by the backend from the signed JWT — a
            // client-supplied identity is trivially spoofable (e.g. changing
            // "QC Analyst" to "Managing Director" in the request body).
            const res = await CCMS.api.post("/api/complaints/" + encodeURIComponent(c.complaintNo) + "/action",
              { action, remarks: remarks.value || undefined });
            close();
            toast(c.complaintNo + ": " + res.fromStatus + " → " + res.toStatus, "success");
            reload();
          } catch (err) { toast(err.message, "error"); }
        } },
      ],
    });
  }

  async function ensureMaster() {
    if (masterCache) return masterCache;
    const [sampleTypes] = await Promise.all([
      CCMS.api.get("/api/master-data/sampleTypes").catch(() => ({ data: [] })),
    ]);
    masterCache = { sampleTypes: sampleTypes.data || [] };
    return masterCache;
  }

  async function sampleForm(c) {
    const m = await ensureMaster();
    const typeSel = el("select.input", {}, (m.sampleTypes || []).map((s) =>
      el("option", { value: s.sampleTypeId, text: s.sampleTypeName })));
    const mode = el("input.input", { placeholder: "Courier / Hand-carry" });
    const date = el("input.input", { type: "date" });
    CCMS.ui.openModal({
      title: "Create sample record",
      body: el("div", {}, [
        el("label.field", {}, [el("span", { text: "Sample type" }), typeSel]),
        el("label.field", {}, [el("span", { text: "Dispatch mode" }), mode]),
        el("label.field", {}, [el("span", { text: "Dispatched date" }), date]),
      ]),
      actions: [
        { label: "Cancel", cls: "btn-ghost" },
        { label: "Create", cls: "btn-primary", onClick: async (close) => {
          try {
            await CCMS.api.post("/api/complaints/" + encodeURIComponent(c.complaintNo) + "/samples",
              { sampleTypeId: typeSel.value, dispatchMode: mode.value, dispatchedDate: date.value, createdBy: user.userId });
            close(); toast("Sample record created.", "success"); reload();
          } catch (err) { toast(err.message, "error"); }
        } },
      ],
    });
  }

  function sampleUpdateForm(c, s) {
    const statusSel = el("select.input", {}, ["Awaited", "Received", "Under Testing", "Tested", "Disposed"]
      .map((x) => el("option", { value: x, selected: x === s.sampleStatus ? "selected" : null, text: x })));
    const result = el("input.input", { placeholder: "Pass / Fail / Inconclusive", value: s.testResult || "" });
    const notes = el("textarea.input", { rows: "2", placeholder: "Test notes…", text: s.testResultNotes || "" });
    CCMS.ui.openModal({
      title: "Update sample — " + (s.sampleTypeName || ""),
      body: el("div", {}, [
        el("label.field", {}, [el("span", { text: "Status" }), statusSel]),
        el("label.field", {}, [el("span", { text: "Test result" }), result]),
        el("label.field", {}, [el("span", { text: "Notes" }), notes]),
      ]),
      actions: [
        { label: "Cancel", cls: "btn-ghost" },
        { label: "Save", cls: "btn-primary", onClick: async (close) => {
          const body = { sampleStatus: statusSel.value, receivedBy: user.userId };
          if (statusSel.value === "Received" || statusSel.value === "Under Testing") body.receivedDate = new Date().toISOString().slice(0, 10);
          if (result.value) body.testResult = result.value;
          if (notes.value) body.testResultNotes = notes.value;
          try {
            await CCMS.api.put("/api/complaints/" + encodeURIComponent(c.complaintNo) + "/samples/" + s.sampleId, body);
            close(); toast("Sample updated.", "success"); reload();
          } catch (err) { toast(err.message, "error"); }
        } },
      ],
    });
  }

  function capaForm(c) {
    const root = el("textarea.input", { rows: "2", placeholder: "Root cause…" });
    const corr = el("textarea.input", { rows: "2", placeholder: "Corrective action…" });
    const prev = el("textarea.input", { rows: "2", placeholder: "Preventive action…" });
    CCMS.ui.openModal({
      title: "Document CAPA — " + c.complaintNo,
      body: el("div", {}, [
        el("label.field", {}, [el("span", { text: "Root cause *" }), root]),
        el("label.field", {}, [el("span", { text: "Corrective action *" }), corr]),
        el("label.field", {}, [el("span", { text: "Preventive action *" }), prev]),
      ]),
      actions: [
        { label: "Cancel", cls: "btn-ghost" },
        { label: "Save CAPA", cls: "btn-primary", onClick: async (close) => {
          if (!root.value || !corr.value || !prev.value) { toast("All three CAPA fields are required.", "error"); return; }
          try {
            await CCMS.api.post("/api/complaints/" + encodeURIComponent(c.complaintNo) + "/capa", {
              rootCauseDescription: root.value, correctiveAction: corr.value, preventiveAction: prev.value,
              documentedBy: user.userId, documentedByName: user.name,
            });
            close(); toast("CAPA documented.", "success"); reload();
          } catch (err) { toast(err.message, "error"); }
        } },
      ],
    });
  }

  function visitForm(c) {
    const date = el("input.input", { type: "date" });
    const assigned = el("input.input", { placeholder: "User ID (e.g. U011)", value: user.userId || "" });
    const type = el("select.input", {}, [
      el("option", { value: "Mandatory", text: "Mandatory" }),
      el("option", { value: "Optional", text: "Optional" }),
    ]);
    CCMS.ui.openModal({
      title: "Schedule customer visit",
      body: el("div", {}, [
        el("label.field", {}, [el("span", { text: "Scheduled date" }), date]),
        el("label.field", {}, [el("span", { text: "Assigned to" }), assigned]),
        el("label.field", {}, [el("span", { text: "Visit type" }), type]),
      ]),
      actions: [
        { label: "Cancel", cls: "btn-ghost" },
        { label: "Schedule", cls: "btn-primary", onClick: async (close) => {
          try {
            await CCMS.api.post("/api/complaints/" + encodeURIComponent(c.complaintNo) + "/visits", {
              scheduledDate: date.value, assignedTo: assigned.value, visitType: type.value, scheduledBy: user.userId });
            close(); toast("Visit scheduled.", "success"); reload();
          } catch (err) { toast(err.message, "error"); }
        } },
      ],
    });
  }

  function visitUpdateForm(c, v) {
    const status = el("select.input", {}, ["Planned", "Completed"].map((x) =>
      el("option", { value: x, selected: x === v.visitStatus ? "selected" : null, text: x })));
    const findings = el("textarea.input", { rows: "2", placeholder: "Findings…", text: v.findings || "" });
    const outcome = el("input.input", { placeholder: "Outcome", value: v.outcome || "" });
    const ack = el("input.input", { placeholder: "Customer acknowledgement", value: v.customerAcknowledgement || "" });
    CCMS.ui.openModal({
      title: "Record visit outcome",
      body: el("div", {}, [
        el("label.field", {}, [el("span", { text: "Status" }), status]),
        el("label.field", {}, [el("span", { text: "Findings" }), findings]),
        el("label.field", {}, [el("span", { text: "Outcome" }), outcome]),
        el("label.field", {}, [el("span", { text: "Customer acknowledgement" }), ack]),
      ]),
      actions: [
        { label: "Cancel", cls: "btn-ghost" },
        { label: "Save", cls: "btn-primary", onClick: async (close) => {
          try {
            await CCMS.api.put("/api/complaints/" + encodeURIComponent(c.complaintNo) + "/visits/" + v.visitId, {
              visitStatus: status.value, visitDate: new Date().toISOString().slice(0, 10),
              findings: findings.value, outcome: outcome.value, customerAcknowledgement: ack.value, updatedBy: user.userId });
            close(); toast("Visit updated.", "success"); reload();
          } catch (err) { toast(err.message, "error"); }
        } },
      ],
    });
  }

  function creditNoteForm(c) {
    const reason = el("textarea.input", { rows: "3", placeholder: "Reason for credit note…", text: "Customer complaint settlement" });
    CCMS.ui.openModal({
      title: "Raise credit note in SAP — " + money(c.settlementValue),
      body: el("div", {}, [
        el("p.muted", { text: "This calls SAP (touchpoint 5) and writes back the credit note number (touchpoint 6)." }),
        el("label.field", {}, [el("span", { text: "Reason" }), reason]),
      ]),
      actions: [
        { label: "Cancel", cls: "btn-ghost" },
        { label: "Push to SAP", cls: "btn-primary", onClick: async (close) => {
          try {
            const res = await CCMS.api.post("/api/complaints/" + encodeURIComponent(c.complaintNo) + "/credit-note", {
              reason: reason.value, raisedBy: user.userId, raisedByName: user.name });
            close(); toast("Credit note " + (res.creditNote && res.creditNote.creditNoteNumber) + " raised.", "success"); reload();
          } catch (err) { toast(err.message, "error"); }
        } },
      ],
    });
  }
};
