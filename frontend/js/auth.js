// ============================================================
// AUTH
// JWT session management: login, logout, current-user cache,
// and token persistence in localStorage.
// ============================================================
window.CCMS = window.CCMS || {};

CCMS.auth = (function () {
  const cfg = CCMS.config;

  function saveSession(token, user) {
    localStorage.setItem(cfg.TOKEN_STORAGE_KEY, token);
    localStorage.setItem(cfg.USER_STORAGE_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(cfg.TOKEN_STORAGE_KEY);
    localStorage.removeItem(cfg.USER_STORAGE_KEY);
  }

  function getToken() {
    return localStorage.getItem(cfg.TOKEN_STORAGE_KEY);
  }

  function currentUser() {
    try {
      return JSON.parse(localStorage.getItem(cfg.USER_STORAGE_KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  function isAuthenticated() {
    const t = getToken();
    if (!t) return false;
    // Cheap client-side expiry check by decoding the JWT payload.
    const payload = decodeJwt(t);
    if (payload && payload.exp && Date.now() >= payload.exp * 1000) {
      clearSession();
      return false;
    }
    return true;
  }

  function decodeJwt(t) {
    try {
      const base64 = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = decodeURIComponent(
        atob(base64)
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      );
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  // POST /api/auth/login → { token, user }
  async function login(email, password) {
    const res = await CCMS.api.post("/api/auth/login", { email, password }, { noAuth: true });
    saveSession(res.token, res.user);
    return res.user;
  }

  // POST /api/auth/logout (best-effort) then clear local session.
  async function logout() {
    try { await CCMS.api.post("/api/auth/logout", {}); } catch (_) { /* stateless — ignore */ }
    clearSession();
    location.hash = "#/login";
  }

  // GET /api/auth/me — refresh the cached user profile/permissions.
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
    getToken, currentUser, isAuthenticated, decodeJwt,
  };
})();
