











require("dotenv").config();
const { Pool, types } = require("pg");









types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));


types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));



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



pool.on("error", (err) => {
  console.error("[DB] idle client error:", err.message);
});


async function query(text, params) {
  const started = Date.now();
  try {
    const res = await pool.query(text, params);
    if (process.env.NODE_ENV === "development" && process.env.DB_LOG === "true") {
      console.log(`[DB] ${Date.now() - started}ms  ${text.split("\n")[0].trim().slice(0, 70)}`);
    }
    return res;
  } catch (err) {

    console.error(`[DB] query failed: ${err.message}\n     SQL: ${text.trim().slice(0, 160)}`);
    throw err;
  }
}


async function one(text, params) {
  const { rows } = await query(text, params);
  return rows[0] || null;
}


async function many(text, params) {
  const { rows } = await query(text, params);
  return rows;
}


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


function using(client) {
  if (!client) return { query, one, many };
  return {
    query: (text, params) => client.query(text, params),
    async one(text, params) { const { rows } = await client.query(text, params); return rows[0] || null; },
    async many(text, params) { const { rows } = await client.query(text, params); return rows; },
  };
}


async function healthcheck() {
  const row = await one("SELECT current_database() AS db, version() AS version");
  return { database: row.db, version: String(row.version).split(",")[0] };
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, one, many, tx, using, healthcheck, close };
