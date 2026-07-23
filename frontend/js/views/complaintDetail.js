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

  container.appendChild(detailSkeleton());

  let masterCache = null;
  let lastStatus = null;

  const parts = {};

  await load();

  async function load() {
    try {

      const [c, seq] = await Promise.all([
        CCMS.api.get("/api/complaints/" + encodeURIComponent(no)),
        CCMS.api.get("/api/complaints/" + encodeURIComponent(no) + "/status-sequence").catch(() => null),
      ]);
      render(c, (seq && seq.gates) || null);
    } catch (err) {
      CCMS.ui.clear(container);
      container.appendChild(CCMS.ui.errorBox(err));
    }
  }

  function swap(key, next) {
    const prev = parts[key];
    if (!prev || !prev.parentNode) return;

    if (prev.id) next.id = prev.id;
    if (prev.classList.contains("detail-section")) next.classList.add("detail-section");
    prev.parentNode.replaceChild(next, prev);
    parts[key] = next;
  }

  async function reload() {
    const before = lastStatus;
    try {
      const [c, seq] = await Promise.all([
        CCMS.api.get("/api/complaints/" + encodeURIComponent(no)),
        CCMS.api.get("/api/complaints/" + encodeURIComponent(no) + "/status-sequence").catch(() => null),
      ]);
      const gates = (seq && seq.gates) || null;

      const canAct = CCMS.roles.canActOnStatus(user.roleId, c.status, c._priorStatus);
      const terminal = ["Closed", "Auto_Closed", "Rejected"].includes(c.status);

      swap("status", statusBadge(c.status));
      swap("workflow", workflowStrip(c, before));
      swap("actions", actionPanel(c, canAct, terminal, gates));
      swap("gates", gatesCard(c, gates));
      swap("samples", samplesCard(c));
      swap("visits", visitsCard(c));
      swap("capa", capaCard(c));
      swap("credit", creditNoteCard(c));
      swap("emails", notificationsCard(c));
      swap("audit", auditCard(c));
      lastStatus = c.status;
    } catch (err) {

      CCMS.ui.clear(container);
      container.appendChild(CCMS.ui.errorBox(err));
    }
  }

  function detailSkeleton() {
    const { skelLines, skelRows, el: e } = CCMS.ui;
    return e("div", {}, [
      e("div.card", {}, [e("div.skel.skel-title"), skelLines(2), e("div.skel.skel-row")]),
      e("div.card", {}, [e("div.skel.skel-title"), skelRows(2)]),
      e("div.detail-grid", {}, [
        e("div.detail-col", {}, [e("div.card", {}, [e("div.skel.skel-title"), skelRows(4)])]),
        e("div.detail-col", {}, [e("div.card", {}, [e("div.skel.skel-title"), skelLines(3)])]),
      ]),
    ]);
  }

  function render(c, gates) {
    CCMS.ui.clear(container);
    container.classList.add("view-enter");

    const canAct = CCMS.roles.canActOnStatus(user.roleId, c.status, c._priorStatus);
    const terminal = ["Closed", "Auto_Closed", "Rejected"].includes(c.status);

    container.appendChild(el("div.card.detail-head", {}, [
      el("div.detail-title", {}, [
        el("div", {}, [
          el("h1", { text: c.complaintNo }),
          el("p.muted", { text: c.title || "" }),
        ]),
        el("div.detail-status", {}, [
          (parts.status = statusBadge(c.status)),
          c.sapValidationPending ? pill("Pending SAP validation", "pill-warn") : null,
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

    container.appendChild((parts.workflow = workflowStrip(c, null)));

    const sections = [];
    const left = el("div.detail-col");
    const right = el("div.detail-col.detail-side");

    function section(id, label, count, node) {
      node.id = "sec-" + id;
      node.classList.add("detail-section");
      sections.push({ id, label, count });
      return node;
    }

    left.appendChild(section("items", "Line items", (c.lineItems || []).length, lineItemsCard(c)));
    if ((c.samples || []).length || isQC()) left.appendChild(section("samples", "Samples", (c.samples || []).length, (parts.samples = samplesCard(c))));
    if ((c.capas || []).length || isOps()) left.appendChild(section("capa", "CAPA", (c.capas || []).length, (parts.capa = capaCard(c))));
    if ((c.visits || []).length || isVisitRole()) left.appendChild(section("visits", "Visits", (c.visits || []).length, (parts.visits = visitsCard(c))));
    if ((c.creditNotes || []).length || isFinance()) left.appendChild(section("credit", "Credit note", (c.creditNotes || []).length, (parts.credit = creditNoteCard(c))));
    left.appendChild(section("emails", "Emails", null, (parts.emails = notificationsCard(c))));
    left.appendChild(section("audit", "Audit", null, (parts.audit = auditCard(c))));

    right.appendChild((parts.actions = actionPanel(c, canAct, terminal, gates)));
    right.appendChild((parts.gates = gatesCard(c, gates)));
    if ((c.attachments || []).length) right.appendChild(attachmentsCard(c));

    container.appendChild(subnav(sections));
    container.appendChild(el("div.detail-grid", {}, [left, right]));

    lastStatus = c.status;
  }

  function subnav(sections) {
    const nav = el("nav.subnav", { "aria-label": "Complaint sections" });
    sections.forEach((s, i) => {
      const btn = el("button.subnav-item" + (i === 0 ? ".active" : ""), {
        type: "button",
        text: s.label,
        onClick: () => {
          const target = document.getElementById("sec-" + s.id);
          if (!target) return;
          target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
          nav.querySelectorAll(".subnav-item").forEach((n) => n.classList.remove("active"));
          btn.classList.add("active");
        },
      });
      if (s.count != null) btn.appendChild(el("span.subnav-count", { text: String(s.count) }));
      nav.appendChild(btn);
    });
    return nav;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

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

  function workflowStrip(c, previous) {
    const seq = (c.statusSequence || []).length ? c.statusSequence : defaultSeq();
    const curIdx = seq.indexOf(c.status);
    const movedFrom = previous && previous !== c.status ? seq.indexOf(previous) : -1;
    const strip = el("div.card.workflow", {}, [el("div.card-head", {}, [el("h3", { text: "Workflow" })])]);
    const track = el("div.wf-track");
    seq.forEach((st, i) => {
      const state = i < curIdx ? "done" : i === curIdx ? "current" : "todo";

      const justDone = i === movedFrom && movedFrom > -1 && movedFrom < curIdx;
      track.appendChild(el("div.wf-step." + state + (justDone ? ".just-done" : ""), {
        "aria-current": state === "current" ? "step" : null,
      }, [
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
        el("td.num", { text: (li.invoiceQty != null ? li.invoiceQty : "—") + " " + (li.uom || "") }),
        el("td.num", { text: String(li.defectiveQty != null ? li.defectiveQty : "—") }),
        el("td.num", { text: money(li.unitPrice) }),

        el("td.num", {}, [el("strong", { text: money(li.defectiveValue != null ? li.defectiveValue : (li.unitPrice || 0) * (li.defectiveQty || 0)) })]),
        el("td", {}, [li.sampleRequired ? pill("Required", "pill-warn") : pill("No", "pill-ok")]),
      ]));
    });
    t.appendChild(tb);
    card.appendChild(t);
    return card;
  }

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
          ? el("div.sub-actions", {}, [
              el("button.btn.btn-xs.btn-ghost", { text: "Record outcome", onClick: () => visitUpdateForm(c, v) }),

              !v.visitDate && !v.findings && !v.outcome && !v.customerAcknowledgement
                ? el("button.btn.btn-xs.btn-ghost", { text: "✕ Remove", title: "Remove this visit — scheduled by mistake", onClick: () => removeVisit(c, v) })
                : null,
            ])
          : null,
      ]));
    });
    return card;
  }

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

  function auditCard(c) {
    const card = el("div.card", {}, [el("div.card-head", {}, [
      el("h3", { text: "Audit trail" }),

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
      .catch((err) => { CCMS.ui.clear(list); list.appendChild(CCMS.ui.errorBox(err)); });
    return card;
  }

  function notificationsCard(c) {
    const card = el("div.card", {}, [el("div.card-head", {}, [
      el("h3", { text: "Emails" }),
      el("a.link", { href: "#/notifications", text: "All notifications →" }),
    ])]);
    const list = el("div.timeline");
    card.appendChild(list);
    list.appendChild(CCMS.ui.spinner("Loading emails…"));
    CCMS.api.get("/api/notifications/" + encodeURIComponent(c.complaintNo))
      .then((res) => {
        CCMS.ui.clear(list);
        card.querySelector(".card-head h3").textContent = "Emails (" + (res.count || 0) + ")";
        const items = res.notifications || [];
        if (!items.length) { list.appendChild(CCMS.ui.empty("No emails sent for this complaint yet.")); return; }
        items.forEach((n) => {
          const isCust = n.channel === "customer";
          list.appendChild(el("div.tl-item", {}, [
            el("div.tl-dot"),
            el("div.tl-body", {}, [
              el("div.tl-title", {}, [
                pill(isCust ? "Customer" : "Team", isCust ? "pill-ok" : "pill-warn"),
                el("span", { text: "  " + (n.subject || n.event || "Email") }),
              ]),
              el("div.tl-meta", { text: "To: " + fmtRecipients(n.to) + " · " + dateFmt(n.sentAt || n.at || n.timestamp) +
                (n.mode ? " · " + n.mode : "") + (n.skipped ? " · skipped (" + n.skipped + ")" : "") }),
              n.body ? el("div.tl-remarks", { text: n.body }) : null,
            ]),
          ]));
        });
      })
      .catch((err) => { CCMS.ui.clear(list); list.appendChild(CCMS.ui.errorBox(err)); });
    return card;

    function fmtRecipients(to) {
      if (Array.isArray(to)) return to.length ? to.join(", ") : "—";
      return to || "—";
    }
  }

  function gateList(c, gates) {
    const g = gates || {};
    const sampleRequired = g.sampleRequired != null ? g.sampleRequired : !!c.sampleRequired;
    const samplePassed = g.sampleGatePassed != null ? g.sampleGatePassed : sampleReceived(c);
    const atSampleStage = ["QC_Review", "Sample_Awaited"].includes(c.status);
    const closed = ["Closed", "Auto_Closed"].includes(c.status);

    const list = [];

    list.push(!sampleRequired
      ? { name: "Physical sample", state: "na", why: "Not required for these complaint types." }
      : samplePassed
        ? { name: "Physical sample", state: "met", why: "Sample received — QC review can proceed." }
        : {
            name: "Physical sample", state: atSampleStage ? "blocked" : "pending",
            why: atSampleStage
              ? "QC Review cannot be approved until the sample is physically received."
              : "A sample must be received before QC Review can be approved.",
            todo: "QC logs the sample, then sets it to Received",
          });

    if (g.mdApprovalRequired || c.policyForcesMdApproval) {
      const done = passedStage(c, "MD_Approval");
      list.push({
        name: "MD approval",
        state: done ? "met" : c.status === "MD_Approval" ? "pending" : "pending",
        why: c.policyForcesMdApproval
          ? "Required: the settlement breaches sales policy."
          : "Required: settlement exceeds the MD approval threshold.",
        todo: done ? null : "Managing Director approves at MD Approval",
      });
    }

    if (g.visitRequired || c.visitRequested) {
      const done = (c.visits || []).some((v) => v.visitStatus === "Completed");
      list.push({
        name: "Customer visit",
        state: done ? "met" : "pending",
        why: c.isKeyAccount ? "Required: key account." : "Required: settlement exceeds the visit threshold.",
        todo: done ? null : "Sales/KAM schedules the visit and records its outcome",
      });
    }

    list.push(c.creditNoteNumber
      ? { name: "SAP credit note", state: "met", why: "Raised: " + c.creditNoteNumber }
      : {
          name: "SAP credit note", state: c.status === "Finance_Processing" ? "blocked" : closed ? "na" : "pending",
          why: c.status === "Finance_Processing"
            ? "The complaint cannot be closed until the credit note exists in SAP."
            : "Finance raises this before closing.",
          todo: c.status === "Finance_Processing" ? "Finance raises the credit note in SAP" : null,
        });

    return list;
  }

  function passedStage(c, stage) {
    const seq = c.statusSequence || [];
    const at = seq.indexOf(c.status), of = seq.indexOf(stage);
    return of >= 0 && at >= 0 && at > of;
  }

  function gatesCard(c, gates) {
    const card = el("div.card", {}, [el("div.card-head", {}, [el("h3", { text: "Gates" })])]);
    const list = gateList(c, gates);
    if (!list.length) { card.appendChild(CCMS.ui.empty("No gates apply.")); return card; }
    list.forEach((g) => card.appendChild(CCMS.ui.gate(g)));
    return card;
  }

  function actionPanel(c, canAct, terminal, gates) {
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

    const blocker = gateList(c, gates).find((g) => g.state === "blocked");

    const buttons = el("div.action-buttons");
    const approveLabel = user.canApprove ? "Approve / Advance" : "Forward";
    const approve = el("button.btn.btn-primary.btn-block", {
      text: approveLabel,
      type: "button",
      onClick: () => startApprove(c, approveLabel),
    });
    if (blocker) {
      approve.disabled = true;

      approve.setAttribute("aria-describedby", "approve-blocked");
      approve.title = blocker.why;
    }
    buttons.appendChild(approve);

    if (user.canReject || user.isAdmin) {
      buttons.appendChild(el("button.btn.btn-danger.btn-block", { type: "button", text: "Reject", onClick: () => actionForm(c, "reject", "Reject") }));
    }
    if (c.status === "Clarification_Sought") {
      buttons.appendChild(el("button.btn.btn-ghost.btn-block", { type: "button", text: "Resolve clarification", onClick: () => actionForm(c, "resolve_clarification", "Resolve clarification") }));
    } else {
      buttons.appendChild(el("button.btn.btn-ghost.btn-block", { type: "button", text: "Seek clarification", onClick: () => actionForm(c, "clarify", "Seek clarification") }));
    }
    if (user.isAdmin) {
      buttons.appendChild(el("button.btn.btn-ghost.btn-block", { type: "button", text: "Auto-close (admin)", onClick: () => actionForm(c, "auto_close", "Auto-close") }));
    }
    card.appendChild(buttons);

    if (blocker) {
      const g = CCMS.ui.gate(blocker);
      g.id = "approve-blocked";
      card.appendChild(g);
    }

    return card;
  }

  function startApprove(c, label) {
    const money_ = CCMS.ui.money;
    if (c.status === "MD_Approval") {
      return CCMS.ui.confirmConsequence({
        title: "Approve settlement of " + money_(c.settlementValue) + "?",
        lead: "You are approving as Managing Director. This authorises the settlement and moves " + c.complaintNo + " onward.",
        points: [
          "Customer: " + (c.customerName || "—") + (c.isKeyAccount ? " (key account)" : ""),
          "Settlement: " + money_(c.settlementValue) + " against an invoice of " + money_(c.invoiceValue),
          c.policyForcesMdApproval ? "Sales policy is in breach — this approval overrides it." : "Within sales policy.",
        ],
        yesLabel: "Approve settlement",
      }, () => actionForm(c, "approve", label));
    }
    if (c.status === "Finance_Processing") {
      return CCMS.ui.confirmConsequence({
        title: "Close " + c.complaintNo + "?",
        lead: "Approving at Finance Processing closes the complaint. Closed complaints have no further workflow actions.",
        points: [
          "Credit note: " + (c.creditNoteNumber || "not raised"),
          "Settlement: " + money_(c.settlementValue),
        ],
        yesLabel: "Close complaint",
      }, () => actionForm(c, "approve", label));
    }
    return actionForm(c, "approve", label);
  }

  function sampleReceived(c) {
    const order = ["Awaited", "Received", "Under Testing", "Tested", "Disposed"];
    return (c.samples || []).some((s) => order.indexOf(s.sampleStatus) >= 1);
  }
  function terminalStatus(c) { return ["Closed", "Auto_Closed", "Rejected"].includes(c.status); }

  function kv(label, value) {
    return el("div.kv", {}, [el("span.kv-label", { text: label }), el("span.kv-value", { text: value || "—" })]);
  }

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

            const res = await CCMS.api.post("/api/complaints/" + encodeURIComponent(c.complaintNo) + "/action",
              { action, remarks: remarks.value || undefined });
            close();
            toast(c.complaintNo + " moved to " + String(res.toStatus || "").replace(/_/g, " "), "success");
            await reload();
          } catch (err) { CCMS.ui.errorToast(err); }
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
          } catch (err) { CCMS.ui.errorToast(err); }
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
          } catch (err) { CCMS.ui.errorToast(err); }
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
          } catch (err) { CCMS.ui.errorToast(err); }
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
          } catch (err) { CCMS.ui.errorToast(err); }
        } },
      ],
    });
  }

  function removeVisit(c, v) {
    CCMS.ui.confirm("Remove this " + (v.visitType || "").toLowerCase() + " visit? It has not taken place, so nothing is lost.", async () => {
      try {
        await CCMS.api.del("/api/complaints/" + encodeURIComponent(c.complaintNo) + "/visits/" + v.visitId);
        toast("Visit removed.", "success"); reload();
      } catch (err) { CCMS.ui.errorToast(err); }
    }, { title: "Remove visit", yesLabel: "Remove", danger: true });
  }

  function visitUpdateForm(c, v) {

    const status = el("select.input", {}, ["Planned", "Completed", "Cancelled"].map((x) =>
      el("option", { value: x, selected: x === v.visitStatus ? "selected" : null, text: x })));
    const findings = el("textarea.input", { rows: "2", placeholder: "Findings…", text: v.findings || "" });

    const outcome = el("select.input", {}, ["", "Resolved On-Site", "Escalation Confirmed", "No Further Action"].map((x) =>
      el("option", { value: x, selected: x === (v.outcome || "") ? "selected" : null, text: x || "— not recorded —" })));
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
          } catch (err) { CCMS.ui.errorToast(err); }
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
          } catch (err) { CCMS.ui.errorToast(err); }
        } },
      ],
    });
  }
};
