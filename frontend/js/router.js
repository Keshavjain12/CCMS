// ============================================================
// ROUTER — tiny hash router
// Routes are registered as [pattern, handler]. Patterns use
// :params, e.g. "#/complaints/:no". Guards redirect to login
// when not authenticated.
// ============================================================
window.CCMS = window.CCMS || {};

CCMS.router = (function () {
  const routes = [];

  function add(pattern, handler) {
    const keys = [];
    const regex = new RegExp(
      "^" + pattern
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/:([A-Za-z0-9_]+)/g, (_, k) => { keys.push(k); return "([^/]+)"; })
      + "$"
    );
    routes.push({ pattern, regex, keys, handler });
  }

  function current() {
    return location.hash.replace(/^#/, "") || "/dashboard";
  }

  function resolve() {
    const path = current();

    const isLogin = path === "/login";
    if (!isLogin && !CCMS.auth.isAuthenticated()) {
      location.hash = "#/login";
      return;
    }
    if (isLogin && CCMS.auth.isAuthenticated()) {
      location.hash = "#/dashboard";
      return;
    }

    for (const r of routes) {
      const m = path.match(r.regex);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        CCMS.shell.render(isLogin ? "login" : "app", (mount) => r.handler(mount, params));
        return;
      }
    }
    // No match → 404 inside the app shell
    CCMS.shell.render("app", (mount) => {
      mount.appendChild(CCMS.ui.el("div.card", {}, [
        CCMS.ui.el("h2", { text: "404 — Page not found" }),
        CCMS.ui.el("p", { text: "The route " + path + " does not exist." }),
        CCMS.ui.el("a.btn.btn-primary", { href: "#/dashboard", text: "Back to dashboard" }),
      ]));
    });
  }

  function start() {
    window.addEventListener("hashchange", resolve);
    resolve();
  }

  function go(hash) { location.hash = hash; }

  return { add, start, resolve, go, current };
})();
