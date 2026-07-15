// ============================================================
// VIEW: Create complaint (Stage 1)
// Restricted to TS Officer/Head, Sales/KAM, Admin.
// Fetches the invoice from SAP, then builds line items.
// ============================================================
window.CCMS = window.CCMS || {};
CCMS.views = CCMS.views || {};

CCMS.views.createComplaint = async function (mount) {
  const { el, money, toast } = CCMS.ui;
  const user = CCMS.auth.currentUser() || {};

  if (!CCMS.roles.can("createComplaint", user.roleId)) {
    mount.appendChild(el("div.card", {}, [
      el("h2", { text: "Not permitted" }),
      el("p", { text: "Only Technical Services, Sales/KAM, or Admin may create complaints." }),
      el("a.btn.btn-primary", { href: "#/complaints", text: "Back to complaints" }),
    ]));
    return;
  }

  mount.appendChild(el("div.page-head", {}, [
    el("div", {}, [el("h1", { text: "New complaint" }), el("p.muted", { text: "Stage 1 — invoice lookup, line items & policy check" })]),
  ]));

  // ── Load complaint types for the dropdowns ──
  let complaintTypes = [];
  try { complaintTypes = (await CCMS.api.get("/api/master-data/complaintTypes")).data || []; } catch (_) {}

  // ── Invoice lookup section ──
  const invInput = el("input.input", { placeholder: "e.g. 90009999" });
  const lookupBtn = el("button.btn.btn-secondary", { text: "Look up in SAP" });
  const invResult = el("div.inv-result");

  const titleInput = el("input.input", { placeholder: "Short title for the complaint" });
  const remarksInput = el("textarea.input", { rows: "2", placeholder: "Customer's description of the issue…" });

  const lineItemsHost = el("div.li-builder");
  const addLiBtn = el("button.btn.btn-ghost.btn-sm", { text: "+ Add line item", onClick: () => addLineRow() });

  const submitBtn = el("button.btn.btn-primary.btn-lg", { text: "Create complaint", onClick: submit });

  let invoiceData = null;

  lookupBtn.addEventListener("click", async () => {
    const no = invInput.value.trim();
    if (!no) { toast("Enter an invoice number.", "error"); return; }
    lookupBtn.disabled = true; lookupBtn.textContent = "Looking up…";
    CCMS.ui.clear(invResult);
    try {
      const res = await CCMS.api.get("/api/master-data/invoice/" + encodeURIComponent(no));
      invoiceData = res.data;
      renderInvoice(res.source, res.data);
      prefillFromInvoice(res.data);
    } catch (err) {
      invResult.appendChild(CCMS.ui.errorBox(err.message + " — you can still enter line items manually below."));
      invoiceData = null;
    } finally {
      lookupBtn.disabled = false; lookupBtn.textContent = "Look up in SAP";
    }
  });

  function renderInvoice(source, inv) {
    CCMS.ui.clear(invResult);
    invResult.appendChild(el("div.inv-card", {}, [
      el("div.inv-row", {}, [
        el("strong", { text: "Invoice " + inv.BillingDocument }),
        CCMS.ui.pill(source, source === "SAP" ? "pill-ok" : "pill-warn"),
      ]),
      el("div.inv-meta", { text:
        "Sold-to: " + inv.SoldToParty + " · Date: " + inv.BillingDocumentDate +
        " · Net: " + money(inv.NetAmount) + " " + (inv.TransactionCurrency || "") }),
      el("div.inv-items", {}, (inv.lineItems || []).map((li) =>
        el("div.inv-item", { text:
          "Item " + li.BillingDocumentItem + " · " + li.MaterialDescription +
          " · Qty " + li.BillingQuantity + " " + li.BillingQuantityUnit +
          " · " + money(li.NetPriceAmount) + "/unit" }))),
    ]));
  }

  function prefillFromInvoice(inv) {
    CCMS.ui.clear(lineItemsHost);
    (inv.lineItems || []).forEach((li) => addLineRow({
      invoiceItemNo: li.BillingDocumentItem,
      sapMaterialNo: li.Material,
      productName: li.MaterialDescription,
      invoiceQty: li.BillingQuantity,
      unitPrice: li.NetPriceAmount,
      uom: li.BillingQuantityUnit,
    }));
    if (!(inv.lineItems || []).length) addLineRow();
  }

  function addLineRow(pref) {
    pref = pref || {};
    const itemNo = el("input.input.sm", { placeholder: "Item #", value: pref.invoiceItemNo || "" });
    const mat = el("input.input.sm", { placeholder: "Material", value: pref.sapMaterialNo || "" });
    const name = el("input.input", { placeholder: "Product name", value: pref.productName || "" });
    const invQty = el("input.input.sm", { type: "number", placeholder: "Inv qty", value: pref.invoiceQty || "" });
    const price = el("input.input.sm", { type: "number", placeholder: "Unit price", value: pref.unitPrice || "" });
    const defQty = el("input.input.sm", { type: "number", placeholder: "Defective qty" });
    const uom = el("input.input.sm", { placeholder: "UoM", value: pref.uom || "" });
    const typeSel = el("select.input", {}, [el("option", { value: "", text: "Complaint type…" })]
      .concat(complaintTypes.map((t) => el("option", { value: t.typeId, text: t.typeName + (t.sampleRequired ? " (sample)" : "") }))));
    const valOut = el("div.li-value", { text: money(0) });

    function recompute() { valOut.textContent = money((parseFloat(price.value) || 0) * (parseFloat(defQty.value) || 0)); }
    [price, defQty].forEach((n) => n.addEventListener("input", recompute));

    const row = el("div.li-row", {}, [
      el("div.li-grid", {}, [
        field("Item #", itemNo), field("Material", mat), field("Product", name, "wide"),
        field("Inv qty", invQty), field("Unit price", price), field("Defective qty", defQty),
        field("UoM", uom), field("Type", typeSel, "wide"),
      ]),
      el("div.li-foot", {}, [
        el("span.muted", { text: "Defective value: " }), valOut,
        el("button.btn.btn-xs.btn-ghost", { text: "Remove", onClick: () => row.remove() }),
      ]),
    ]);
    row._collect = () => ({
      invoiceItemNo: itemNo.value || undefined,
      sapMaterialNo: mat.value || undefined,
      productName: name.value || undefined,
      invoiceQty: invQty.value ? parseFloat(invQty.value) : undefined,
      unitPrice: price.value ? parseFloat(price.value) : undefined,
      defectiveQty: defQty.value ? parseFloat(defQty.value) : 0,
      uom: uom.value || undefined,
      complaintTypeId: typeSel.value || undefined,
    });
    lineItemsHost.appendChild(row);
    recompute();
  }

  function field(label, node, cls) {
    return el("label.mini-field" + (cls ? "." + cls : ""), {}, [el("span", { text: label }), node]);
  }

  async function submit() {
    const items = Array.prototype.map.call(lineItemsHost.querySelectorAll(".li-row"), (r) => r._collect())
      .filter((x) => x.complaintTypeId && x.defectiveQty > 0);
    if (!invInput.value.trim()) { toast("Invoice number is required.", "error"); return; }
    if (!items.length) { toast("Add at least one line item with a complaint type and defective qty.", "error"); return; }

    submitBtn.disabled = true; submitBtn.textContent = "Creating…";
    try {
      const res = await CCMS.api.post("/api/complaints", {
        invoiceNumber: invInput.value.trim(),
        title: titleInput.value || undefined,
        remarks: remarksInput.value || undefined,
        lineItemsInput: items,
        reportedBy: user.userId,
      });
      const cno = res.complaint && res.complaint.complaintNo;
      toast("Created " + cno, "success");
      if (res.policyAlert) toast("Policy breach flagged: " + res.policyAlert.clauseBreached, "error");
      CCMS.router.go("#/complaints/" + cno);
    } catch (err) {
      toast(err.message, "error");
      submitBtn.disabled = false; submitBtn.textContent = "Create complaint";
    }
  }

  mount.appendChild(el("div.grid-2", {}, [
    el("div.card", {}, [
      el("div.card-head", {}, [el("h3", { text: "1 · Invoice (SAP lookup)" })]),
      el("div.inline-form", {}, [invInput, lookupBtn]),
      el("p.muted.sm", { text: "Try 90001234, 90005678, or 90009999 in mock mode." }),
      invResult,
    ]),
    el("div.card", {}, [
      el("div.card-head", {}, [el("h3", { text: "2 · Complaint details" })]),
      el("label.field", {}, [el("span", { text: "Title" }), titleInput]),
      el("label.field", {}, [el("span", { text: "Remarks" }), remarksInput]),
    ]),
  ]));

  mount.appendChild(el("div.card", {}, [
    el("div.card-head", {}, [el("h3", { text: "3 · Affected line items" }), addLiBtn]),
    lineItemsHost,
  ]));

  mount.appendChild(el("div.form-submit", {}, [submitBtn]));

  addLineRow();
};
