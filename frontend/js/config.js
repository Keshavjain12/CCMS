window.CCMS = window.CCMS || {};

(function () {
  const env = window.CCMS_ENV || {};

  if (!window.CCMS_ENV) {
    console.warn(
      "[CCMS] env/config.js not found or did not set window.CCMS_ENV. " +
      "Copy env/config.example.js to env/config.js. Using built-in defaults."
    );
  }

  CCMS.config = Object.freeze({
    API_BASE_URL:        (env.API_BASE_URL || "http://localhost:3000").replace(/\/+$/, ""),
    APP_NAME:            env.APP_NAME || "Orient Paper & Mill — CCMS",
    APP_TAGLINE:         env.APP_TAGLINE || "Customer Complaint Management System",
    TOKEN_STORAGE_KEY:   env.TOKEN_STORAGE_KEY || "ccms_token",
    USER_STORAGE_KEY:    env.USER_STORAGE_KEY || "ccms_user",
    TOKEN_EXPIRY_HOURS:  env.TOKEN_EXPIRY_HOURS || 8,
    CURRENCY_SYMBOL:     env.CURRENCY_SYMBOL || "₹",

    SHOW_DEMO_ACCOUNTS:  env.SHOW_DEMO_ACCOUNTS === true,

    DEMO_ACCOUNTS:       Array.isArray(env.DEMO_ACCOUNTS) ? env.DEMO_ACCOUNTS : [],

    API_TIMEOUT_MS:      env.API_TIMEOUT_MS || 15000,
    DASHBOARD_REFRESH_MS: env.DASHBOARD_REFRESH_MS || 0,
  });
})();
