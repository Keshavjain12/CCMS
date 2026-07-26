const express = require("express");

const VERBS = ["get", "post", "put", "patch", "delete", "all"];

function wrap(handler) {
  if (typeof handler !== "function") return handler;

  if (handler.length === 4) return handler;
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

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
