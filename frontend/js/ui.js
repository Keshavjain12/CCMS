// ============================================================
// UI HELPERS
// Small, dependency-free helpers: DOM builder, formatters,
// status badges, toasts, and a modal/confirm dialog.
// ============================================================
window.CCMS = window.CCMS || {};

CCMS.ui = (function () {
  const cfg = CCMS.config;

  // ── DOM builder: el("div.card", { onclick }, [children | text]) ──
  function el(spec, attrs, children) {
    const parts = spec.split(/(?=[.#])/);
    const tag = parts[0] && !/[.#]/.test(parts[0][0]) ? parts.shift() : "div";
    const node = document.createElement(tag || "div");
    parts.forEach((p) => {
      if (p[0] === ".") node.classList.add(p.slice(1));
      else if (p[0] === "#") node.id = p.slice(1);
    });
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v == null || v === false) return;
        // NOTE: there is deliberately no `html`/innerHTML branch. Every value
        // goes in as textContent or a typed attribute, so API data, error
        // strings, and user fields can never be parsed as markup — the DOM
        // builder itself is XSS-safe by construction.
        if (k === "text") node.textContent = v;
        else if (k.slice(0, 2) === "on" && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === "dataset") {
          Object.assign(node.dataset, v);
        } else {
          node.setAttribute(k, v);
        }
      });
    }
    appendChildren(node, children);
    return node;
  }

  function appendChildren(node, children) {
    if (children == null) return;
    if (!Array.isArray(children)) children = [children];
    children.forEach((c) => {
      if (c == null || c === false) return;
      node.appendChild(typeof c === "string" || typeof c === "number"
        ? document.createTextNode(String(c))
        : c);
    });
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  // ── Formatters ──────────────────────────────────────────────────
  function money(v) {
    const n = Number(v || 0);
    return cfg.CURRENCY_SYMBOL + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }
  function dateFmt(v) {
    if (!v) return "—";
    const d = new Date(v);
    if (isNaN(d)) return String(v);
    return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  }
  function dateOnly(v) {
    if (!v) return "—";
    const d = new Date(v);
    return isNaN(d) ? String(v) : d.toLocaleDateString("en-IN", { dateStyle: "medium" });
  }

  // ── Status badge ────────────────────────────────────────────────
  const STATUS_CLASS = {
    Draft: "st-draft", Logged: "st-logged", TS_Review: "st-review",
    QC_Review: "st-review", Sample_Awaited: "st-warn", CAPA_Pending: "st-review",
    Ops_Head_Approval: "st-review", Marketing_Review: "st-review",
    Marketing_Head_Approval: "st-review", MD_Approval: "st-md",
    Visit_Pending: "st-warn", Finance_Processing: "st-finance",
    Closed: "st-closed", Rejected: "st-reject",
    Clarification_Sought: "st-warn", Auto_Closed: "st-closed",
  };
  function statusBadge(status) {
    return el("span.badge." + (STATUS_CLASS[status] || "st-default"),
      { text: (status || "—").replace(/_/g, " ") });
  }

  function pill(text, cls) {
    return el("span.pill" + (cls ? "." + cls : ""), { text });
  }

  // ── Toast notifications ─────────────────────────────────────────
  function toast(message, type) {
    let host = document.getElementById("toast-host");
    if (!host) {
      host = el("div#toast-host.toast-host");
      document.body.appendChild(host);
    }
    const t = el("div.toast." + (type || "info"), {}, [
      el("span.toast-msg", { text: message }),
    ]);
    host.appendChild(t);
    setTimeout(() => t.classList.add("show"), 10);
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 300);
    }, type === "error" ? 6000 : 3500);
  }

  // ── Modal dialog ────────────────────────────────────────────────
  // openModal({ title, body(node|string), actions:[{label,cls,onClick(close)}] })
  function openModal(opts) {
    const overlay = el("div.modal-overlay");
    const box = el("div.modal", {}, [
      el("div.modal-head", {}, [
        el("h3", { text: opts.title || "" }),
        el("button.modal-x", { text: "✕", onClick: close }),
      ]),
      el("div.modal-body", {}, [
        typeof opts.body === "string" ? el("p", { text: opts.body }) : opts.body,
      ]),
      el("div.modal-actions", {},
        (opts.actions || [{ label: "Close", cls: "btn-ghost" }]).map((a) =>
          el("button.btn." + (a.cls || "btn-ghost"), {
            text: a.label,
            onClick: () => a.onClick ? a.onClick(close) : close(),
          })
        )
      ),
    ]);
    overlay.appendChild(box);
    const onOverlayClick = (e) => { if (e.target === overlay) close(); };
    overlay.addEventListener("click", onOverlayClick);
    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add("show"), 10);
    let closed = false;
    function close() {
      if (closed) return; // guard against double-close (X + overlay + action)
      closed = true;
      // Detach the listener before removal so long sessions don't accumulate
      // handlers bound to detached overlay nodes.
      overlay.removeEventListener("click", onOverlayClick);
      overlay.classList.remove("show");
      setTimeout(() => overlay.remove(), 200);
    }
    return { close, box };
  }

  function confirm(message, onYes, opts) {
    opts = opts || {};
    openModal({
      title: opts.title || "Please confirm",
      body: message,
      actions: [
        { label: opts.cancelLabel || "Cancel", cls: "btn-ghost" },
        { label: opts.yesLabel || "Confirm", cls: opts.danger ? "btn-danger" : "btn-primary",
          onClick: (close) => { close(); onYes(); } },
      ],
    });
  }

  // ── Simple loading + empty + error states ───────────────────────
  function spinner(label) {
    return el("div.loading", {}, [el("div.spinner"), el("span", { text: label || "Loading…" })]);
  }
  function empty(msg) { return el("div.empty", { text: msg || "Nothing here yet." }); }
  function errorBox(msg) { return el("div.error-box", { text: msg }); }

  return {
    el, clear, appendChildren,
    money, dateFmt, dateOnly,
    statusBadge, pill,
    toast, openModal, confirm,
    spinner, empty, errorBox,
  };
})();
