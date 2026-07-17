window.CCMS = window.CCMS || {};

CCMS.ui = (function () {
  const cfg = CCMS.config;

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

  function rowLink(label, go, cells) {
    const tr = el("tr.row-link", {
      tabindex: "0",
      role: "link",
      "aria-label": label,
      onClick: go,
      onKeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      },
    }, cells);
    return tr;
  }

  function toast(message, type) {
    let host = document.getElementById("toast-host");
    if (!host) {

      host = el("div#toast-host.toast-host", { role: "status", "aria-live": "polite" });
      document.body.appendChild(host);
    }
    const t = el("div.toast." + (type || "info"), { role: type === "error" ? "alert" : null }, [
      el("span.toast-ico", { text: type === "success" ? "✓" : type === "error" ? "!" : "i", "aria-hidden": "true" }),
      el("span.toast-msg", { text: message }),
    ]);
    host.appendChild(t);
    setTimeout(() => t.classList.add("show"), 10);
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 300);
    }, type === "error" ? 6000 : 3500);
  }

  function openModal(opts) {

    const opener = document.activeElement;
    const overlay = el("div.modal-overlay");
    const titleId = "modal-title-" + Math.random().toString(36).slice(2, 8);

    const actionButtons = (opts.actions || [{ label: "Close", cls: "btn-ghost" }]).map((a) => {
      const btn = el("button.btn." + (a.cls || "btn-ghost"), { text: a.label, type: "button" });
      btn.addEventListener("click", () => {
        if (!a.onClick) return close();

        runAsync(btn, () => a.onClick(close, btn));
      });
      return btn;
    });

    const box = el("div.modal", {
      role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabindex: "-1",
    }, [
      el("div.modal-head", {}, [
        el("h3#" + titleId, { text: opts.title || "" }),
        el("button.modal-x", { text: "✕", type: "button", "aria-label": "Close dialog", onClick: () => close() }),
      ]),
      el("div.modal-body", {}, [
        typeof opts.body === "string" ? el("p", { text: opts.body }) : opts.body,
      ]),
      el("div.modal-actions", {}, actionButtons),
    ]);
    overlay.appendChild(box);

    const onOverlayClick = (e) => { if (e.target === overlay) close(); };
    overlay.addEventListener("click", onOverlayClick);

    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); return close(); }
      if (e.key !== "Tab") return;
      const f = box.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);

    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add("show"), 10);

    setTimeout(() => {
      const target = box.querySelector("input, textarea, select") || box;
      target.focus();
    }, 60);

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;

      overlay.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKey);
      overlay.classList.remove("show");
      setTimeout(() => overlay.remove(), 200);
      if (opener && typeof opener.focus === "function") opener.focus();
    }
    return { close, box };
  }

  function confirm(message, onYes, opts) {
    opts = opts || {};
    openModal({
      title: opts.title || "Please confirm",
      body: typeof message === "string"
        ? message
        : message,
      actions: [
        { label: opts.cancelLabel || "Cancel", cls: "btn-ghost" },
        { label: opts.yesLabel || "Confirm", cls: opts.danger ? "btn-danger" : "btn-primary",
          onClick: (close) => { close(); return onYes(); } },
      ],
    });
  }

    function confirmConsequence(opts, onYes) {
    const body = el("div", {}, [
      opts.lead ? el("p", { text: opts.lead }) : null,
      (opts.points || []).length
        ? el("ul.consequence", {}, opts.points.map((p) => el("li", { text: p })))
        : null,
    ]);
    return confirm(body, onYes, {
      title: opts.title || "Confirm",
      yesLabel: opts.yesLabel || "Confirm",
      danger: opts.danger !== false,
    });
  }

  function spinner(label) {
    return el("div.loading", {}, [el("div.spinner"), el("span", { text: label || "Loading…" })]);
  }
  function empty(msg) { return el("div.empty", { text: msg || "Nothing here yet." }); }
  function errorBox(msg) { return el("div.error-box", { text: humanError(msg) }); }

  function skelLines(n, widths) {
    widths = widths || ["w-80", "w-60", "w-40"];
    const box = el("div");
    for (let i = 0; i < n; i++) box.appendChild(el("div.skel.skel-line." + widths[i % widths.length]));
    return box;
  }
  function skelTiles(n) {
    const row = el("div.kpi-row");
    for (let i = 0; i < n; i++) row.appendChild(el("div.skel.skel-tile"));
    return row;
  }
  function skelRows(n) {
    const box = el("div");
    for (let i = 0; i < n; i++) box.appendChild(el("div.skel.skel-row"));
    return box;
  }
  function skelCard(titleWidth) {
    return el("div", {}, [el("div.skel.skel-title", { style: titleWidth ? "width:" + titleWidth : null }), skelLines(3)]);
  }

  const ERROR_COPY = [
    [/not authenticated|invalid or expired|jwt/i, "Your session has expired. Please sign in again."],
    [/not authorised|not authorized|forbidden|cannot action|permission/i, "You do not have permission to do that."],
    [/rate limit|too many/i, "Too many attempts. Please wait a few minutes and try again."],
    [/failed to fetch|networkerror|load failed/i, "Can't reach the server. Check your connection and try again."],
    [/invalid input syntax|violates .*constraint|column .* does not exist|relation .* does not exist|syntax error/i,
      "Something went wrong saving that. Nothing was changed — please try again."],
    [/internal server error/i, "Something went wrong on our side. Nothing was changed — please try again."],
  ];
  function humanError(err) {
    const raw = (err && err.message) ? err.message : String(err == null ? "" : err);
    for (const [pattern, copy] of ERROR_COPY) {
      if (pattern.test(raw)) {
        if (raw && window.console) console.warn("[CCMS] " + raw);
        return copy;
      }
    }

    return raw || "Something went wrong.";
  }
  function errorToast(err) { toast(humanError(err), "error"); }

  function runAsync(btn, fn) {
    if (btn.dataset.busy === "1") return Promise.resolve();
    btn.dataset.busy = "1";
    btn.classList.add("is-loading");
    btn.setAttribute("aria-busy", "true");
    btn.disabled = true;
    return Promise.resolve()
      .then(fn)
      .finally(() => {
        btn.dataset.busy = "";
        btn.classList.remove("is-loading");
        btn.removeAttribute("aria-busy");
        btn.disabled = false;
      });
  }

  const GATE_ICON = { met: "✓", blocked: "!", pending: "…", na: "–" };
  function gate(g) {
    const state = g.state || "na";
    return el("div.gate.is-" + state, { role: state === "blocked" ? "alert" : null }, [
      el("span.gate-ico", { text: GATE_ICON[state] || "–", "aria-hidden": "true" }),
      el("div.gate-txt", {}, [
        el("div.gate-name", { text: g.name }),
        g.why ? el("div.gate-why", { text: g.why }) : null,
        g.todo ? el("div.gate-todo", { text: "→ " + g.todo }) : null,
      ]),
    ]);
  }

  return {
    el, clear, appendChildren,
    money, dateFmt, dateOnly,
    statusBadge, pill, gate, rowLink,
    toast, errorToast, humanError, openModal, confirm,
    spinner, empty, errorBox,
    skelLines, skelTiles, skelRows, skelCard,
    runAsync,
  };
})();
