// =========================================================================
// POSTGRES CONNECTION POOL
// =========================================================================
// Single shared pool for the whole process. Every data module goes through
// query() / one() / many() / tx() here — no module creates its own client.
//
// Column naming: the schema is snake_case (Postgres convention) but the
// application speaks camelCase. Queries alias columns explicitly
// (e.g. `SELECT complaint_no AS "complaintNo"`), so rows come back in the
// exact shape the rest of the app already expects.
// =========================================================================

require("dotenv").config();
const { Pool, types } = require("pg");

// ── Type parsing ─────────────────────────────────────────────────────────
// pg's defaults don't match what this app expects, so fix them once here
// rather than casting in every query.
//
//  1. NUMERIC arrives as a string (pg protects precision). The app does real
//     arithmetic on money and percentages — `settlementPct > maxSettlementPct`
//     would compare strings and silently misbehave. Parse to float.
//     (Safe here: values are well inside IEEE-754 exact range.)
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
//  2. INT8/bigserial arrives as a string for the same reason. audit_log.log_id
//     fits comfortably in a JS number.
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
//  3. DATE would become a Date at *local* midnight, which shifts the calendar
//     day either side of UTC. Invoice dates are calendar facts, not instants —
//     keep them as 'YYYY-MM-DD' strings, exactly as the mock data had them.
types.setTypeParser(1082, (v) => v);

const pool = new Pool({
  host:     process.env.PGHOST     || "localhost",
  port:     parseInt(process.env.PGPORT || "5432", 10),
  database: process.env.PGDATABASE || "ccms",
  user:     process.env.PGUSER     || "postgres",
  password: process.env.PGPASSWORD,
  max:      parseInt(process.env.PG_POOL_MAX || "10", 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// A pool error means an idle client died (DB restart, network blip). Log it
// rather than letting it take the process down — the pool will reconnect.
pool.on("error", (err) => {
  console.error("[DB] idle client error:", err.message);
});

/**
 * Run a query. Returns the full pg result.
 */
async function query(text, params) {
  const started = Date.now();
  try {
    const res = await pool.query(text, params);
    if (process.env.NODE_ENV === "development" && process.env.DB_LOG === "true") {
      console.log(`[DB] ${Date.now() - started}ms  ${text.split("\n")[0].trim().slice(0, 70)}`);
    }
    return res;
  } catch (err) {
    // Surface the offending SQL — a bare "syntax error" is useless at 2am.
    console.error(`[DB] query failed: ${err.message}\n     SQL: ${text.trim().slice(0, 160)}`);
    throw err;
  }
}

/** First row, or null. */
async function one(text, params) {
  const { rows } = await query(text, params);
  return rows[0] || null;
}

/** All rows. */
async function many(text, params) {
  const { rows } = await query(text, params);
  return rows;
}

/**
 * Run fn inside a transaction. Commits on success, rolls back on throw.
 * Use for multi-statement writes that must not half-apply — e.g. creating a
 * complaint plus its line items.
 */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Verify connectivity at boot so failures are loud and early. */
async function healthcheck() {
  const row = await one("SELECT current_database() AS db, version() AS version");
  return { database: row.db, version: String(row.version).split(",")[0] };
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, one, many, tx, healthcheck, close };
