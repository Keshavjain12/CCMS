require("dotenv").config();
const fs = require("fs");

// ---------------------------------------------------------------------------
// Shared PostgreSQL connection config.
//
// Works in two modes:
//   • Local dev   — discrete PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD vars.
//   • Hosted/PaaS — a single DATABASE_URL connection string (Render, Neon,
//                   Railway, Heroku, Supabase, RDS, …), which almost always
//                   requires TLS.
//
// Used by src/db/pool.js (the app pool) and the db/*.js admin scripts so they
// all connect the same way.
// ---------------------------------------------------------------------------

// Resolve the TLS settings. SSL is turned on when a connection string is used
// (managed databases mandate it), or explicitly via PGSSL=true / PGSSLMODE.
// Turn it off for a plain local server with PGSSL=false or PGSSLMODE=disable.
function sslConfig() {
  const mode = String(process.env.PGSSLMODE || "").toLowerCase();
  const flag = String(process.env.PGSSL || "").toLowerCase();

  if (mode === "disable" || flag === "false") return false;

  const wanted =
    !!process.env.DATABASE_URL ||
    flag === "true" ||
    ["require", "verify-ca", "verify-full"].includes(mode);
  if (!wanted) return false;

  // Managed providers often present a certificate that will not validate
  // against the system CA store, so we default to not rejecting it. For full
  // verification set PGSSL_REJECT_UNAUTHORIZED=true and (optionally) point
  // PGSSLROOTCERT at the provider's CA bundle.
  const reject = String(process.env.PGSSL_REJECT_UNAUTHORIZED || "").toLowerCase() === "true";
  const ssl = { rejectUnauthorized: reject };
  if (reject && process.env.PGSSLROOTCERT) {
    try { ssl.ca = fs.readFileSync(process.env.PGSSLROOTCERT, "utf8"); } catch (_) { /* fall back to default trust store */ }
  }
  return ssl;
}

// Build a node-postgres Pool/Client config. `extra` is merged in last so
// callers can add pool sizing, a maintenance `database`, etc.
function dbConfig(extra = {}) {
  const ssl = sslConfig();
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, ...(ssl ? { ssl } : {}), ...extra };
  }
  return {
    host:     process.env.PGHOST     || "localhost",
    port:     parseInt(process.env.PGPORT || "5432", 10),
    database: process.env.PGDATABASE || "ccms",
    user:     process.env.PGUSER     || "postgres",
    password: process.env.PGPASSWORD,
    ...(ssl ? { ssl } : {}),
    ...extra,
  };
}

// True when we point at a hosted database via a connection string. In that
// case the database already exists and we must not touch the "postgres"
// maintenance database or attempt CREATE DATABASE.
function isManaged() {
  return !!process.env.DATABASE_URL;
}

module.exports = { sslConfig, dbConfig, isManaged };
