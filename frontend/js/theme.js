window.CCMS = window.CCMS || {};

(function () {

  var KEY = "ccms_theme";

  function stored() {
    try { return localStorage.getItem(KEY); } catch (_) { return null; }
  }

  function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);

    if (typeof window.dispatchEvent === "function" && typeof window.CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("ccms:themechange", { detail: { theme } }));
    }
  }

  function current() {
    return document.documentElement.getAttribute("data-theme") || "light";
  }

  function set(theme) {
    apply(theme);
    try { localStorage.setItem(KEY, theme); } catch (_) {}
    return theme;
  }

  function toggle() {
    return set(current() === "dark" ? "light" : "dark");
  }

  apply(stored() || (systemPrefersDark() ? "dark" : "light"));

  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onChange = function (e) { if (!stored()) apply(e.matches ? "dark" : "light"); };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  CCMS.theme = { current: current, set: set, toggle: toggle, KEY: KEY };
})();
