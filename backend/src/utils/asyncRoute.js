// =========================================================================
// ASYNC ROUTE SAFETY NET
// =========================================================================
// Express 4 does not catch rejected promises from `async` handlers. The
// rejection escapes the request entirely, and Node terminates the process on
// an unhandled rejection — so one failed query (a constraint violation, a
// dropped connection) took the whole API down instead of returning a 500.
//
// safeRouter() returns an ordinary express Router whose verb methods wrap
// each handler, forwarding any rejection to next() where the error middleware
// in server.js turns it into a response. Routes added later are covered
// automatically, which per-route try/catch could not guarantee.
// =========================================================================

const express = require("express");

const VERBS = ["get", "post", "put", "patch", "delete", "all"];

/** Forward an async handler's rejection to next(); pass anything else through. */
function wrap(handler) {
  if (typeof handler !== "function") return handler;
  // Express identifies error middleware by arity — wrapping would change it
  // to 3 and silently demote it to an ordinary handler.
  if (handler.length === 4) return handler;
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * Patch a Router's or an app's verb methods so every handler registered
 * afterwards is wrapped. Must be applied before any route is registered.
 */
function protect(target) {
  for (const verb of VERBS) {
    const original = target[verb].bind(target);
    target[verb] = (path, ...handlers) => original(path, ...handlers.map(wrap));
  }
  return target;
}

function safeRouter(...args) {
  return protect(express.Router(...args));
}

module.exports = { safeRouter, protect, wrap };
