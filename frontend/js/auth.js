// ============================================================
// AUTH
// Session management: login, logout, current-user cache.
//
// The JWT is NOT handled here. It lives in an httpOnly cookie that this code
// cannot read or write — the browser attaches it to requests automatically.
// So there is no token in localStorage for an XSS payload to steal.
//
// What is cached locally is the user profile (name/role — not a credential)
// and a session expiry hint, purely so the UI can render without a round-trip.
// These are UI hints only: the server is the sole authority on whether a
// request is authorised, and any 401 sends the user back to login.
// ============================================================
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
    // Remove any token left over from the pre-cookie build.
    localStorage.removeItem(cfg.TOKEN_STORAGE_KEY);
  }

  function currentUser() {
    try {
      return JSON.parse(localStorage.getItem(cfg.USER_STORAGE_KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  // Optimistic UI check only — it cannot see the cookie, so it can't truly
  // know. The server decides; a 401 from any call triggers logout.
  function isAuthenticated() {
    if (!currentUser()) return false;
    const exp = parseInt(localStorage.getItem(EXPIRY_KEY) || "0", 10);
    if (exp && Date.now() >= exp) {
      clearSession();
      return false;
    }
    return true;
  }

  // POST /api/auth/login → { user, expiresIn }; the token arrives as a cookie.
  async function login(email, password) {
    const res = await CCMS.api.post("/api/auth/login", { email, password }, { noAuth: true });
    saveSession(res.user, res.expiresIn);
    return res.user;
  }

  // POST /api/auth/logout — the server clears the cookie; we drop the cache.
  async function logout() {
    try { await CCMS.api.post("/api/auth/logout", {}); } catch (_) { /* clear locally regardless */ }
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
    currentUser, isAuthenticated,
  };
})();
