// ============================================================
// CONFIG LOADER
// Merges window.CCMS_ENV (from env/config.js) with safe defaults.
// Everything else in the app reads config from CCMS.config.
// ============================================================
window.CCMS = window.CCMS || {};

(function () {
  const env = window.CCMS_ENV || {};

  if (!window.CCMS_ENV) {
    console.warn(
      "[CCMS] env/config.js not found or did not set window.CCMS_ENV. " +
      "Copy env/config.example.js to env/config.js. Using built-in defaults."
    );
  }

  // Object.freeze() the finalized config so a later (possibly malicious /
  // XSS-injected) script cannot rewrite API_BASE_URL and hijack API calls +
  // the JWT bearer header. Frozen config is read-only for the whole app.
  CCMS.config = Object.freeze({
    API_BASE_URL:        (env.API_BASE_URL || "http://localhost:3000").replace(/\/+$/, ""),
    APP_NAME:            env.APP_NAME || "Orient Paper & Mill — CCMS",
    APP_TAGLINE:         env.APP_TAGLINE || "Customer Complaint Management System",
    TOKEN_STORAGE_KEY:   env.TOKEN_STORAGE_KEY || "ccms_token",
    USER_STORAGE_KEY:    env.USER_STORAGE_KEY || "ccms_user",
    TOKEN_EXPIRY_HOURS:  env.TOKEN_EXPIRY_HOURS || 8,
    CURRENCY_SYMBOL:     env.CURRENCY_SYMBOL || "₹",
    // Fail-CLOSED: demo accounts only appear when explicitly enabled with the
    // literal boolean true. A missing / mistyped / absent flag hides them,
    // instead of defaulting to exposing seeded logins in production.
    SHOW_DEMO_ACCOUNTS:  env.SHOW_DEMO_ACCOUNTS === true,
    // Demo login shortcuts are supplied per-deployment via env/config.js
    // (git-ignored) — never hardcoded in the shipped app source.
    DEMO_ACCOUNTS:       Array.isArray(env.DEMO_ACCOUNTS) ? env.DEMO_ACCOUNTS : [],
    // Request timeout (ms) before an in-flight API call is aborted so the UI
    // never hangs forever on a stalled network / locked backend.
    API_TIMEOUT_MS:      env.API_TIMEOUT_MS || 15000,
    DASHBOARD_REFRESH_MS: env.DASHBOARD_REFRESH_MS || 0,
  });
})();
