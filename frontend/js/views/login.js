window.CCMS = window.CCMS || {};
CCMS.views = CCMS.views || {};

CCMS.views.login = function (mount) {
  const { el } = CCMS.ui;
  const cfg = CCMS.config;

  const DEMO = Array.isArray(cfg.DEMO_ACCOUNTS) ? cfg.DEMO_ACCOUNTS : [];

  const emailInput = el("input.input", { type: "email", placeholder: "you@orientpaper.com", autocomplete: "username" });
  const passInput  = el("input.input", { type: "password", placeholder: "••••••••", autocomplete: "current-password" });
  const errBox     = el("div.form-error", { style: "display:none" });
  const submitBtn  = el("button.btn.btn-primary.btn-lg", { type: "submit", text: "Sign in" });

  async function doLogin(e) {
    if (e) e.preventDefault();
    errBox.style.display = "none";
    const email = emailInput.value.trim();
    const password = passInput.value;
    if (!email || !password) {
      showErr("Enter both email and password.");
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";
    try {
      const user = await CCMS.auth.login(email, password);
      CCMS.ui.toast("Welcome, " + (user.name || "") + "!", "success");
      location.hash = "#/dashboard";
    } catch (err) {
      showErr(CCMS.ui.humanError(err));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in";
    }
  }

  function showErr(msg) { errBox.textContent = msg; errBox.style.display = "block"; }

  function fill(acc) {
    emailInput.value = acc.email || "";
    passInput.value = acc.password || "";
    passInput.focus();
  }

  const form = el("form.login-form", { onSubmit: doLogin }, [
    el("label.field", {}, [el("span", { text: "Email" }), emailInput]),
    el("label.field", {}, [el("span", { text: "Password" }), passInput]),
    errBox,
    submitBtn,
  ]);

  const leftPanel = el("div.login-hero", {}, [
    el("div.login-brand", {}, [
      el("span.brand-mark.lg", { text: "OPM" }),
      el("div", {}, [
        el("h1", { text: cfg.APP_NAME }),
        el("p", { text: cfg.APP_TAGLINE }),
      ]),
    ]),
    el("ul.hero-points", {}, [
      el("li", { text: "Role-based portals — TS, QC, Operations, Marketing, MD, Finance, Sales" }),
      el("li", { text: "Full complaint lifecycle with SAP S/4HANA integration" }),
      el("li", { text: "JWT-secured — every action authorised by role & stage" }),
    ]),
    el("div.hero-foot", { text: "Secured with a JWT in an httpOnly cookie" }),
  ]);

  const card = el("div.login-card", {}, [
    el("h2", { text: "Sign in to your portal" }),
    el("p.muted", { text: "Use your Orient Paper & Mill staff credentials." }),
    form,
  ]);

  if (cfg.SHOW_DEMO_ACCOUNTS && DEMO.length) {
    card.appendChild(el("div.demo-block", {}, [
      el("div.demo-head", { text: "Demo accounts — click to fill" }),
      el("div.demo-grid", {}, DEMO.map((acc) =>
        el("button.demo-btn", { type: "button", onClick: () => fill(acc) }, [
          el("strong", { text: acc.label || acc.email || "Account" }),
          el("small", { text: acc.role || "" }),
        ])
      )),
      el("div.demo-hint", { text: "Sandbox logins — configured in env/config.js (dev only)." }),
    ]));
  }

  mount.appendChild(el("div.login-screen", {}, [leftPanel, card]));
  setTimeout(() => emailInput.focus(), 50);
};
