require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { publishedHashes, issuePassword } = require("./credentials");

const FORCE = process.argv.includes("--force");
const DB_NAME = process.env.PGDATABASE || "ccms";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

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

async function findTransactionalData(client) {
  const found = [];
  for (const table of TRANSACTIONAL_TABLES) {
    const reg = await client.query("SELECT to_regclass($1) AS t", [`public.${table}`]);
    if (!reg.rows[0].t) continue;
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

  const admin = new Client({ ...baseConfig, database: "postgres" });
  try {
    await admin.connect();
  } catch (err) {
    fail(`Cannot reach PostgreSQL at ${baseConfig.host}:${baseConfig.port} — ${err.message}`,
         "Is the PostgreSQL service running, and are PGHOST/PGPORT/PGUSER/PGPASSWORD correct in .env?");
  }

  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME]);
  if (exists.rowCount === 0) {

    await admin.query(`CREATE DATABASE "${DB_NAME.replace(/"/g, '""')}"`);
    console.log(`✅ created database "${DB_NAME}"`);
  } else {
    console.log(`ℹ️  database "${DB_NAME}" already exists`);
  }
  await admin.end();

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

  let issued = [];
  if (IS_PRODUCTION) {
    issued = await rotatePublishedCredentials(client);
  }

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
