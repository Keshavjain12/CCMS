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

  // render(layout, paint) — layout is "login" | "app"
  function render(layout, paint) {
    const r = clear(root());
    if (layout === "login") {
      const mount = el("div.login-mount");
      r.appendChild(mount);
      paint(mount);
      return;
    }

    const user = CCMS.auth.currentUser() || {};
    const portal = CCMS.roles.portalFor(user.roleId);
    document.documentElement.style.setProperty("--accent", portal.accent);

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
