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
const { publishedHashes, issuePassword } = require("./credentials");

const FORCE = process.argv.includes("--force");
const DB_NAME = process.env.PGDATABASE || "ccms";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// ── Published credentials ─────────────────────────────────────────────────
// seed.sql carries fixed password_hash values and README.md prints the
// passwords behind them, so the sandbox is usable on a fresh clone. This
// repository is public, so those passwords are public: seeded into a
// reachable deployment they hand anyone an Admin login. Withholding them from
// the API achieves nothing while the README discloses them — the credentials
// themselves have to go.
//
// So in production every account still carrying one of those hashes gets a
// fresh random password, printed once. Accounts already given a real password
// are untouched — their hash is not one of these — so a re-run cannot lock out
// users provisioned earlier. Lost one? npm run reset-password (no data loss).
async function rotatePublishedCredentials(client) {
  const hashes = publishedHashes();
  if (!hashes.length) return [];

  const { rows } = await client.query(
    "SELECT user_id, email FROM users WHERE password_hash = ANY($1) ORDER BY user_id",
    [hashes]
  );
  const issued = [];
  for (const u of rows) {
    issued.push({ email: u.email, password: await issuePassword(client, u.user_id) });
  }
  return issued;
}

// Tables holding data seed.sql cannot recreate — everything the users and the
// background engines produced. init-db refuses when any of them holds a row.
//
// The ten master-data tables are deliberately absent: they are reseeded
// verbatim from seed.sql, so rebuilding them loses nothing, and guarding them
// would make init-db refuse on every run after the first — turning --force
// into muscle memory and defeating the guard entirely.
//
// audit_log earns its place on its own: complaint_no is nullable and carries
// no FK, so it keeps rows even when complaints is empty.
const TRANSACTIONAL_TABLES = [
  "complaints",
  "complaint_line_items",
  "attachments",
  "samples",
  "visits",
  "capa_records",
  "credit_notes",
  "audit_log",
];

/** Transactional tables that exist and hold at least one row. */
async function findTransactionalData(client) {
  const found = [];
  for (const table of TRANSACTIONAL_TABLES) {
    const reg = await client.query("SELECT to_regclass($1) AS t", [`public.${table}`]);
    if (!reg.rows[0].t) continue; // not created yet — nothing to lose
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM "${table}"`);
    if (rows[0].n > 0) found.push({ table, n: rows[0].n });
  }
  return found;
}

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

  if (!FORCE) {
    const holdings = await findTransactionalData(client);
    if (holdings.length) {
      await client.end();
      const summary = holdings.map(({ table, n }) => `${n} ${table}`).join(", ");
      fail(`"${DB_NAME}" already holds transactional data — refusing to wipe it.`,
           `Found: ${summary}.\n   schema.sql drops every table. Re-run as:  npm run init-db -- --force`);
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

  // ── 3b. Replace the published credentials in production ───────────────
  let issued = [];
  if (IS_PRODUCTION) {
    issued = await rotatePublishedCredentials(client);
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

  if (IS_PRODUCTION) {
    if (issued.length) {
      // Printed once and never recoverable: only the bcrypt hash is stored.
      // Losing these means re-running with --force, not reading them back.
      console.log(`\n🔑 NODE_ENV=production — the ${issued.length} seeded account(s) had passwords`);
      console.log(`   published in README.md. Each has been given a new random one.`);
      console.log(`   This is the only time they are shown. Save them now — if one is`);
      console.log(`   lost, reissue it with:  npm run reset-password -- <email>\n`);
      const width = Math.max(...issued.map((i) => i.email.length));
      for (const { email, password } of issued) {
        console.log(`     ${email.padEnd(width)}   ${password}`);
      }
      console.log(`\n   Nothing published in this repository can sign in to this database.`);
    } else {
      console.log(`\n🔑 NODE_ENV=production — no account carries a password published in this`);
      console.log(`   repository, so none needed replacing.`);
    }
  } else {
    console.log(`\n   Sandbox logins are the ones in README.md — they are public, and fine`);
    console.log(`   here. Seeding with NODE_ENV=production replaces them automatically.`);
  }

  console.log(`\n   Next:  npm start\n`);

  await client.end();
}

main().catch((err) => fail(err.message));
