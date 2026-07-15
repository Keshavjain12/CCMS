// =========================================================================
// DATABASE INITIALISER  —  npm run init-db
// =========================================================================
// Creates the CCMS database (if absent), applies db/schema.sql, then
// db/seed.sql. Reads connection settings from .env.
//
// Uses the pg driver rather than shelling out to psql: psql is frequently
// not on PATH on Windows, so a CLI-based script would fail on a fresh clone.
//
//   npm run init-db            → create + set up (refuses to wipe live data)
//   npm run init-db -- --force → drop and rebuild even if complaints exist
// =========================================================================

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const FORCE = process.argv.includes("--force");
const DB_NAME = process.env.PGDATABASE || "ccms";

const baseConfig = {
  host:     process.env.PGHOST || "localhost",
  port:     parseInt(process.env.PGPORT || "5432", 10),
  user:     process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD,
};

function fail(msg, hint) {
  console.error(`\n❌ ${msg}`);
  if (hint) console.error(`   ${hint}`);
  console.error("");
  process.exit(1);
}

async function main() {
  if (!baseConfig.password || baseConfig.password === "CHANGE_ME" || baseConfig.password === "your_postgres_password") {
    fail("PGPASSWORD is not set in backend/.env",
         "Copy .env.example to .env and fill in your PostgreSQL password.");
  }

  // ── 1. Create the database if it doesn't exist ────────────────────────
  // CREATE DATABASE cannot run inside a transaction, and must be issued from
  // a different database — hence the connection to `postgres` first.
  const admin = new Client({ ...baseConfig, database: "postgres" });
  try {
    await admin.connect();
  } catch (err) {
    fail(`Cannot reach PostgreSQL at ${baseConfig.host}:${baseConfig.port} — ${err.message}`,
         "Is the PostgreSQL service running, and are PGHOST/PGPORT/PGUSER/PGPASSWORD correct in .env?");
  }

  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME]);
  if (exists.rowCount === 0) {
    // Identifier can't be parameterised; quote it to stay injection-safe.
    await admin.query(`CREATE DATABASE "${DB_NAME.replace(/"/g, '""')}"`);
    console.log(`✅ created database "${DB_NAME}"`);
  } else {
    console.log(`ℹ️  database "${DB_NAME}" already exists`);
  }
  await admin.end();

  // ── 2. Connect to it and guard against clobbering real data ───────────
  const client = new Client({ ...baseConfig, database: DB_NAME });
  await client.connect();

  const tableCheck = await client.query("SELECT to_regclass('public.complaints') AS t");
  if (tableCheck.rows[0].t && !FORCE) {
    const { rows } = await client.query("SELECT count(*)::int AS n FROM complaints");
    if (rows[0].n > 0) {
      await client.end();
      fail(`"${DB_NAME}" already holds ${rows[0].n} complaint(s) — refusing to wipe them.`,
           "schema.sql drops every table. Re-run as:  npm run init-db -- --force");
    }
  }

  // ── 3. Apply schema, then seed ────────────────────────────────────────
  for (const file of ["schema.sql", "seed.sql"]) {
    const sql = fs.readFileSync(path.join(__dirname, file), "utf8");
    try {
      await client.query(sql);
      console.log(`✅ applied ${file}`);
    } catch (err) {
      await client.end();
      fail(`${file} failed: ${err.message}`);
    }
  }

  // ── 4. Report ─────────────────────────────────────────────────────────
  const { rows } = await client.query(`
    SELECT
      (SELECT count(*) FROM departments)     AS departments,
      (SELECT count(*) FROM roles)           AS roles,
      (SELECT count(*) FROM users)           AS users,
      (SELECT count(*) FROM customers)       AS customers,
      (SELECT count(*) FROM products)        AS products,
      (SELECT count(*) FROM complaint_types) AS complaint_types,
      (SELECT count(*) FROM sales_policies)  AS sales_policies,
      (SELECT count(*) FROM invoices)        AS invoices,
      (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') AS tables`);
  const r = rows[0];

  console.log(`\n🗄️  ${DB_NAME} ready — ${r.tables} tables`);
  console.log(`   seeded: ${r.departments} departments, ${r.roles} roles, ${r.users} users,`);
  console.log(`           ${r.customers} customers, ${r.products} products, ${r.complaint_types} complaint types,`);
  console.log(`           ${r.sales_policies} sales policies, ${r.invoices} invoices`);
  console.log(`\n   Next:  npm start\n`);

  await client.end();
}

main().catch((err) => fail(err.message));
