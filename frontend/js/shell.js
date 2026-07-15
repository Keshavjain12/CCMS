// ============================================================
// APP SHELL
// Renders either the bare "login" layout or the authenticated
// "app" layout (top bar + role-filtered sidebar + content).
// Views are painted into the content mount by the router.
// ============================================================
window.CCMS = window.CCMS || {};

CCMS.shell = (function () {
  const { el, clear } = CCMS.ui;

  function root() { return document.getElementById("root"); }

  // ── Per-role accent ───────────────────────────────────────────────
  // roles.js holds one hex per portal; this turns it into the three tokens
  // the stylesheet uses. Derived, not hand-picked, so adding a portal cannot
  // ship a colour below WCAG AA — four of the nine were failing when the same
  // hex was used both as text and as a fill under white text.
  //
  // Recomputed on theme change: "readable" depends on the surface, and dark
  // needs the accent lifted where light needs it deepened.
  let currentAccent = null;

  function applyAccent(hex) {
    currentAccent = hex || "#0d6e6e";
    const css = getComputedStyle(document.documentElement);
    // Read the surface the active theme actually set, rather than assuming.
    const surface = (css.getPropertyValue("--surface") || "#ffffff").trim();
    const style = document.documentElement.style;
    style.setProperty("--accent", currentAccent);
    style.setProperty("--accent-text", CCMS.color.readableOn(currentAccent, surface));
    style.setProperty("--accent-contrast", CCMS.color.contrastText(currentAccent));
  }

  // theme.js fires this after data-theme changes, so the accent is re-derived
  // against the new surface instead of staying tuned for the old one.
  window.addEventListener("ccms:themechange", () => {
    if (currentAccent) applyAccent(currentAccent);
  });

  // render(layout, paint) — layout is "login" | "app"
  function render(layout, paint) {
    const r = clear(root());
    if (layout === "login") {
      // No role yet, so no portal accent — fall back to the house colour, but
      // still derive it, so the login screen obeys the same contrast rule as
      // everything else rather than being an exception.
      applyAccent(CCMS.roles.portalFor(null).accent);
      const mount = el("div.login-mount");
      r.appendChild(mount);
      paint(mount);
      return;
    }

    const user = CCMS.auth.currentUser() || {};
    const portal = CCMS.roles.portalFor(user.roleId);
    applyAccent(portal.accent);

    const content = el("main.content#view-mount");

    const layoutNode = el("div.app-layout", {}, [
      topbar(user, portal),
      el("div.app-body", {}, [
        sidebar(user, portal),
        content,
      ]),
    ]);
    r.appendChild(layoutNode);

    // Highlight active nav
    paint(content);
    highlightNav();
  }

  function topbar(user, portal) {
    return el("header.topbar", {}, [
      el("div.brand", {}, [
        el("span.brand-mark", { text: "OPM" }),
        el("div.brand-text", {}, [
          el("strong", { text: "CCMS" }),
          el("small", { text: CCMS.config.APP_TAGLINE }),
        ]),
      ]),
      el("div.portal-chip", {}, [
        el("span.portal-icon", { text: portal.icon }),
        el("div", {}, [
          el("small", { text: "PORTAL" }),
          el("strong", { text: portal.portal }),
        ]),
      ]),
      el("div.topbar-spacer"),
      el("div.user-chip", {}, [
        themeToggle(),
        el("div.user-avatar", { text: initials(user.name) }),
        el("div.user-meta", {}, [
          el("strong", { text: user.name || "User" }),
          el("small", { text: (user.roleName || user.roleId || "") }),
        ]),
        el("button.btn.btn-ghost.btn-sm", {
          text: "Logout",
          onClick: () => CCMS.auth.logout(),
        }),
      ]),
    ]);
  }

  // Shows where you are going, not where you are: the icon is the theme the
  // click will switch to. Labelled for screen readers — the glyph alone says
  // nothing to one.
  function themeToggle() {
    const btn = el("button.btn.btn-ghost.btn-sm.theme-toggle", {
      onClick: () => { CCMS.theme.toggle(); render(btn); },
    });
    render(btn);
    return btn;

    function render(node) {
      const dark = CCMS.theme.current() === "dark";
      node.textContent = dark ? "☀" : "☾";
      const label = dark ? "Switch to light theme" : "Switch to dark theme";
      node.title = label;
      node.setAttribute("aria-label", label);
    }
  }

  function sidebar(user, portal) {
    const items = CCMS.roles.navFor(user.roleId);
    const nav = el("nav.sidebar");

    // Group by optional "section"
    let currentSection = null;
    items.forEach((it) => {
      if (it.section && it.section !== currentSection) {
        currentSection = it.section;
        nav.appendChild(el("div.nav-section", { text: it.section }));
      }
      if (!it.section) currentSection = null;
      nav.appendChild(el("a.nav-item", {
        href: it.route,
        dataset: { route: it.route },
      }, [
        el("span.nav-icon", { text: it.icon }),
        el("span.nav-label", { text: it.label }),
      ]));
    });

    nav.appendChild(el("div.sidebar-foot", {}, [
      el("small", { text: portal.dept + " · " + (user.roleId || "") }),
      // Infrastructure detail (the backend host) is only surfaced to Admins.
      // Regular users don't need it and it's needless information disclosure.
      user.roleId === "R000"
        ? el("small.muted", { text: "API: " + CCMS.config.API_BASE_URL })
        : null,
    ]));
    return nav;
  }

  function highlightNav() {
    const path = "#" + (location.hash.replace(/^#/, "") || "/dashboard");
    document.querySelectorAll(".nav-item").forEach((a) => {
      const route = a.getAttribute("data-route");
      const active = path === route ||
        (route !== "#/dashboard" && path.indexOf(route) === 0 && route !== "#/complaints") ||
        (route === "#/complaints" && path.indexOf("#/complaints") === 0 && path.indexOf("#/complaints/new") !== 0);
      a.classList.toggle("active", active);
    });
  }

  function initials(name) {
    if (!name) return "?";
    return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  }

  return { render, highlightNav };
})();
