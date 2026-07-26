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

  let complaintTypes = [];
  try { complaintTypes = (await CCMS.api.get("/api/master-data/complaintTypes")).data || []; } catch (_) {}

  let customers = [];
  try { customers = (await CCMS.api.get("/api/master-data/customers")).data || []; } catch (_) {}
  customers.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  const customerSel = el("select.input", {}, [el("option", { value: "", text: "Select a company…" })]
    .concat(customers.map((c) => el("option", { value: c.customerId, text: c.name + " (" + c.customerId + ")" }))));

  const invoiceSel = el("select.input", { disabled: "true" }, [el("option", { value: "", text: "Select a company first…" })]);

  const invInput = el("input.input", { placeholder: "e.g. 90009999" });
  const lookupBtn = el("button.btn.btn-secondary", { text: "Look up in SAP" });
  const invResult = el("div.inv-result");

  customerSel.addEventListener("change", () => {
    const cid = customerSel.value;
    CCMS.ui.clear(invResult);
    CCMS.ui.clear(lineItemsHost);
    invoiceSel.innerHTML = "";
    if (!cid) {
      invoiceSel.setAttribute("disabled", "true");
      invoiceSel.appendChild(el("option", { value: "", text: "Select a company first…" }));
      return;
    }
    invoiceSel.setAttribute("disabled", "true");
    invoiceSel.appendChild(el("option", { value: "", text: "Loading invoices…" }));
    CCMS.api.get("/api/master-data/customer/" + encodeURIComponent(cid) + "/invoices")
      .then((res) => {
        const list = res.invoices || [];
        invoiceSel.innerHTML = "";
        if (!list.length) {
          invoiceSel.appendChild(el("option", { value: "", text: "No invoices on file for this company" }));
          toast("No invoices found for this company. You can still enter an invoice number manually below.", "info");
          return;
        }
        invoiceSel.appendChild(el("option", { value: "", text: "Select an invoice…" }));
        list.forEach((inv) => invoiceSel.appendChild(el("option", {
          value: inv.invoiceNumber,
          text: inv.invoiceNumber + " · " + inv.invoiceDate + " · " + money(inv.netAmount) + " " + (inv.currency || "") + " · " + inv.itemCount + " item(s)",
        })));
        invoiceSel.removeAttribute("disabled");

        if (list.length === 1) { invoiceSel.value = list[0].invoiceNumber; doLookup(list[0].invoiceNumber); }
      })
      .catch((err) => {
        invoiceSel.innerHTML = "";
        invoiceSel.appendChild(el("option", { value: "", text: "Could not load invoices" }));
        toast(CCMS.ui.humanError(err), "error");
      });
  });

  invoiceSel.addEventListener("change", () => {
    if (invoiceSel.value) doLookup(invoiceSel.value);
  });

  const titleInput = el("input.input", { placeholder: "Short title for the complaint" });
  const remarksInput = el("textarea.input", { rows: "2", placeholder: "Customer's description of the issue…" });

  const lineItemsHost = el("div.li-builder");
  const liError = el("div");
  const addLiBtn = el("button.btn.btn-ghost.btn-sm", { text: "+ Add line item", onClick: () => addLineRow() });

  const submitBtn = el("button.btn.btn-primary.btn-lg", { text: "Create complaint", onClick: submit });

  let invoiceData = null;
  let sapFallback = false;

  function fieldError(input, msg) {
    clearFieldError(input);
    input.classList.add("invalid");
    input.setAttribute("aria-invalid", "true");
    const err = el("div.field-err", { text: msg });
    err.dataset.errFor = "1";
    (input.parentNode || input).insertBefore(err, input.nextSibling);
    input.focus();
    return false;
  }
  function clearFieldError(input) {
    input.classList.remove("invalid");
    input.removeAttribute("aria-invalid");
    const sib = input.nextSibling;
    if (sib && sib.dataset && sib.dataset.errFor) sib.remove();
  }

  lookupBtn.addEventListener("click", () => doLookup());

  invInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); doLookup(); }
  });

  function doLookup(explicitNo) {
    const no = String(explicitNo || invInput.value || "").trim();
    if (!no) return fieldError(invInput, "Enter an invoice number to look up.");
    invInput.value = no;
    clearFieldError(invInput);

    CCMS.ui.clear(invResult);
    invResult.appendChild(el("div.async-state", {}, [
      el("div.dot-spin", { "aria-hidden": "true" }),
      el("span", { text: "Fetching invoice " + no + " from SAP…" }),
    ]));

    return CCMS.ui.runAsync(lookupBtn, async () => {
      try {
        const res = await CCMS.api.get("/api/master-data/invoice/" + encodeURIComponent(no));
        invoiceData = res.data;
        renderInvoice(res.source, res.data);
        prefillFromInvoice(res.data);
        toast("Invoice " + no + " loaded — " + ((res.data.lineItems || []).length) + " line item(s).", "success");
      } catch (err) {
        invoiceData = null;

        CCMS.ui.clear(invResult);
        invResult.appendChild(CCMS.ui.gate({
          name: "Invoice not validated against SAP",
          state: "pending",
          why: CCMS.ui.humanError(err),
          todo: "You can still file this complaint — it will be flagged “Pending SAP Validation” and Finance will verify the invoice before any credit note is raised.",
        }));
        sapFallback = true;
      }
    });
  }

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

  function submit() {
    const items = Array.prototype.map.call(lineItemsHost.querySelectorAll(".li-row"), (r) => r._collect())
      .filter((x) => x.complaintTypeId && x.defectiveQty > 0);

    if (!invInput.value.trim()) return fieldError(invInput, "An invoice number is required.");
    clearFieldError(invInput);
    if (!items.length) {
      CCMS.ui.clear(liError);
      liError.appendChild(el("div.field-err", {
        text: "Add at least one affected product with a complaint type and a defective quantity above zero.",
      }));
      lineItemsHost.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    CCMS.ui.clear(liError);

    return CCMS.ui.runAsync(submitBtn, async () => {
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

        if (res.policyAlert) toast("Policy breach flagged: " + res.policyAlert.clauseBreached + " — MD approval will be required.", "info");
        if (res.complaint && res.complaint.sapValidationPending) {
          toast("Filed with “Pending SAP Validation” — Finance will verify the invoice.", "info");
        }
        CCMS.router.go("#/complaints/" + cno);
      } catch (err) {
        CCMS.ui.errorToast(err);
      }
    });
  }

  function required(text) {
    return el("span", {}, [text, el("span.req", { text: "*", "aria-hidden": "true" })]);
  }

  mount.appendChild(el("div.grid-2", {}, [
    el("div.card", {}, [
      el("div.card-head", {}, [el("h3", { text: "1 · Company & invoice" })]),
      el("label.field", {}, [required("Company"), customerSel]),
      el("label.field", {}, [required("Invoice"), invoiceSel]),
      el("p.muted.sm", { text: "Pick a company, then its invoice — line items and unit prices fill in automatically from the invoice." }),
      el("details.mt", {}, [
        el("summary.muted.sm", { text: "Or enter an invoice number manually" }),
        el("label.field", {}, [el("span", { text: "Invoice number" }), el("div.inline-form", {}, [invInput, lookupBtn])]),
        el("p.muted.sm", { text: "Try 90001234, 90005678, or 90009999 in mock mode." }),
      ]),
      invResult,
    ]),
    el("div.card", {}, [
      el("div.card-head", {}, [el("h3", { text: "2 · Complaint details" })]),
      el("label.field", {}, [el("span", { text: "Title (optional)" }), titleInput]),
      el("label.field", {}, [el("span", { text: "Remarks (optional)" }), remarksInput]),
    ]),
  ]));

  mount.appendChild(el("div.card", {}, [
    el("div.card-head", {}, [el("h3", { text: "3 · Affected line items" }), addLiBtn]),
    lineItemsHost,
    liError,
  ]));

  mount.appendChild(el("div.form-submit", {}, [submitBtn]));

  addLineRow();
};
