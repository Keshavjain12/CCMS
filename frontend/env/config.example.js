// ============================================================
// CCMS Frontend — Environment Configuration (TEMPLATE)
// ------------------------------------------------------------
// Copy this file to `config.js` in the same folder and adjust
// the values for your environment. `config.js` is git-ignored
// so each developer/deployment can keep its own settings and
// no credentials are ever committed to the app source.
//
//   cp env/config.example.js env/config.js
//
// This file is loaded by index.html BEFORE the app bootstraps,
// so it must be plain browser JS (no imports / no build step).
// It publishes a single global: window.CCMS_ENV
//
// SECURITY: the object is Object.freeze()d so that a later
// (possibly XSS-injected) script cannot rewrite API_BASE_URL and
// redirect API traffic — along with the user's JWT — to an
// attacker-controlled host.
// ============================================================

window.CCMS_ENV = Object.freeze({
  // Base URL of the CCMS backend API (the Express server).
  // No trailing slash. Change the port if you set PORT in the
  // backend .env to something other than 3000.
  API_BASE_URL: "http://localhost:3000",

  // Display name shown in the top bar / login screen.
  APP_NAME: "Orient Paper & Mill — CCMS",
  APP_TAGLINE: "Customer Complaint Management System",

  // localStorage keys used to persist the JWT session.
  TOKEN_STORAGE_KEY: "ccms_token",
  USER_STORAGE_KEY: "ccms_user",

  // Auto-logout the client this many minutes before the JWT
  // actually expires on the server (JWT_EXPIRES in backend .env,
  // default 8h). Purely a client-side courtesy.
  TOKEN_EXPIRY_HOURS: 8,

  // Currency symbol used across the UI for settlement values.
  CURRENCY_SYMBOL: "₹",

  // Abort an API request after this many ms so the UI never hangs
  // forever on a stalled network or a locked backend.
  API_TIMEOUT_MS: 15000,

  // ── Demo login shortcuts (DEV / SANDBOX ONLY) ──────────────
  // Fail-CLOSED: the login screen shows the quick-fill buttons
  // ONLY when this is the literal boolean `true`. Leave it false
  // (or omit it) for any real deployment.
  SHOW_DEMO_ACCOUNTS: false,

  // Optional seeded accounts for the demo quick-fill buttons.
  // NEVER put real/production credentials here, and NEVER commit
  // a config.js that contains them. Example shape:
  //
  //   DEMO_ACCOUNTS: [
  //     { email: "someone@example.com", password: "…", label: "TS Officer", role: "Creates / forwards" },
  //   ],
  DEMO_ACCOUNTS: [],

  // Polling interval (ms) for the live dashboard KPIs. 0 = off.
  DASHBOARD_REFRESH_MS: 0,
});
