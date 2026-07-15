// ============================================================
// THEME  —  light / dark
// ============================================================
// Loaded from <head>, before the body renders. That ordering is the whole
// point: applying the theme after first paint would flash a white page at a
// dark-mode user on every navigation.
//
// The usual trick for this is a tiny inline <script> in the document head,
// but the app's CSP is `script-src 'self'` (see index.html) and inline
// scripts are refused — so this ships as a file instead. It stays dependency
// free and touches nothing but <html data-theme>, which css/styles.css keys
// its dark token block off.
//
// Precedence:  explicit user choice  →  OS preference  →  light.
// ============================================================
window.CCMS = window.CCMS || {};

(function () {
  // Not read via CCMS.config: this runs before js/config.js has loaded, which
  // is what keeps it ahead of first paint.
  var KEY = "ccms_theme";

  // localStorage throws in Safari private mode rather than returning null.
  function stored() {
    try { return localStorage.getItem(KEY); } catch (_) { return null; }
  }

  function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    // The per-role accent is derived against the surface (see shell.js), so
    // the surface changing means it has to be derived again. Fired as an event
    // rather than calling shell directly: this file loads in <head>, long
    // before shell.js exists.
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

  // Run now, not on DOMContentLoaded — <body> has not been parsed yet.
  apply(stored() || (systemPrefersDark() ? "dark" : "light"));

  // Track the OS only until the user picks a side; an explicit choice wins
  // from then on, including in tabs opened later.
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onChange = function (e) { if (!stored()) apply(e.matches ? "dark" : "light"); };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange); // older Safari
  }

  CCMS.theme = { current: current, set: set, toggle: toggle, KEY: KEY };
})();
