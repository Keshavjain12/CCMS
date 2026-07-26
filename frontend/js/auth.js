window.CCMS = window.CCMS || {};

CCMS.auth = (function () {
  const cfg = CCMS.config;
  const EXPIRY_KEY = "ccms_session_expires";

  function saveSession(user, expiresIn) {
    localStorage.setItem(cfg.USER_STORAGE_KEY, JSON.stringify(user));
    const hours = parseInt(expiresIn, 10) || cfg.TOKEN_EXPIRY_HOURS || 8;
    localStorage.setItem(EXPIRY_KEY, String(Date.now() + hours * 3600 * 1000));
  }

  function clearSession() {
    localStorage.removeItem(cfg.USER_STORAGE_KEY);
    localStorage.removeItem(EXPIRY_KEY);

    localStorage.removeItem(cfg.TOKEN_STORAGE_KEY);
  }

  function currentUser() {
    try {
      return JSON.parse(localStorage.getItem(cfg.USER_STORAGE_KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  function isAuthenticated() {
    if (!currentUser()) return false;
    const exp = parseInt(localStorage.getItem(EXPIRY_KEY) || "0", 10);
    if (exp && Date.now() >= exp) {
      clearSession();
      return false;
    }
    return true;
  }

  async function login(email, password) {
    const res = await CCMS.api.post("/api/auth/login", { email, password }, { noAuth: true });
    saveSession(res.user, res.expiresIn);
    return res.user;
  }

  async function logout() {
    try { await CCMS.api.post("/api/auth/logout", {}); } catch (_) {  }
    clearSession();
    location.hash = "#/login";
  }

  async function refreshMe() {
    const me = await CCMS.api.get("/api/auth/me");
    const merged = Object.assign({}, currentUser(), me, {
      canApprove: me.permissions && me.permissions.canApprove,
      canForward: me.permissions && me.permissions.canForward,
      canReject:  me.permissions && me.permissions.canReject,
      isAdmin:    me.permissions && me.permissions.isAdmin,
    });
    localStorage.setItem(cfg.USER_STORAGE_KEY, JSON.stringify(merged));
    return merged;
  }

  return {
    login, logout, refreshMe,
    saveSession, clearSession,
    currentUser, isAuthenticated,
  };
})();
