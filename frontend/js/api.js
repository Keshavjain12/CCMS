window.CCMS = window.CCMS || {};

CCMS.api = (function () {
  const cfg = CCMS.config;

  async function request(method, path, body, opts) {
    opts = opts || {};
    const headers = { Accept: "application/json" };

    let payload;
    if (body !== undefined && body !== null) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }

    const controller = new AbortController();
    const timeoutMs = cfg.API_TIMEOUT_MS || 15000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(cfg.API_BASE_URL + path, {
        method,
        headers,
        body: payload,

        credentials: "include",
        signal: controller.signal,
      });
    } catch (networkErr) {
      const aborted = networkErr && networkErr.name === "AbortError";
      const e = new Error(
        aborted
          ? "The CCMS server took too long to respond (over " +
            Math.round(timeoutMs / 1000) + "s). Please try again."
          : "Cannot reach the CCMS server at " + cfg.API_BASE_URL +
            ". Is the backend running (npm start)?"
      );
      e.isNetwork = true;
      e.isTimeout = aborted;
      throw e;
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 && !opts.noAuth) {
      CCMS.auth.clearSession();
      if (location.hash !== "#/login") {
        location.hash = "#/login";
      }
    }

    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {

        data = { raw: "Server returned a non-JSON response (" + res.status + ")." };
      }
    }

    if (!res.ok) {
      const msg = (data && (data.error || data.message || data.raw)) || ("Request failed (" + res.status + ")");
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  return {
    get:  (path, opts)        => request("GET", path, null, opts),
    post: (path, body, opts)  => request("POST", path, body, opts),
    put:  (path, body, opts)  => request("PUT", path, body, opts),
    del:  (path, opts)        => request("DELETE", path, null, opts),
    request,
  };
})();
