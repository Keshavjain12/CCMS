// =========================================================================
// RESET A PASSWORD  —  npm run reset-password -- <email>
// =========================================================================
// Only the bcrypt hash is stored, so a password cannot be read back. The one
// init-db prints when seeding a production database is shown once — and
// without this script, losing it meant re-running init-db --force, which
// drops every table. Recovery must not cost the data.
//
//   npm run reset-password -- admin@orientpaper.com   → one account
//   npm run reset-password -- --all                   → every account
//   npm run reset-password -- --published             → only accounts still
//                                                       on a password
//                                                       published in this repo
//
// Touches nothing but users.password_hash. Complaints, audit trail and
// everything else are untouched.
// =========================================================================

require("dotenv").config();
const { Client } = require("pg");
const { publishedHashes, issuePassword } = require("./credentials");

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const PUBLISHED_ONLY = args.includes("--published");
const emails = args.filter((a) => !a.startsWith("--"));

function fail(msg, hint) {
  console.error(`\n❌ ${msg}`);
  if (hint) console.error(`   ${hint}`);
  console.error("");
  process.exit(1);
}

async function main() {
  if (!ALL && !PUBLISHED_ONLY && emails.length === 0) {
    fail("Nothing to reset — say who.",
         "npm run reset-password -- someone@orientpaper.com\n" +
         "   npm run reset-password -- --all         (every account)\n" +
         "   npm run reset-password -- --published   (only accounts still using a\n" +
         "                                            password published in this repo)");
  }

  const client = new Client({
    host:     process.env.PGHOST || "localhost",
    port:     parseInt(process.env.PGPORT || "5432", 10),
    user:     process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || "ccms",
  });

  try {
    await client.connect();
  } catch (err) {
    fail(`Cannot reach PostgreSQL — ${err.message}`,
         "Check PGHOST/PGPORT/PGUSER/PGPASSWORD in .env, and that the server is running.");
  }

  let targets;
  if (ALL) {
    targets = (await client.query("SELECT user_id, email FROM users ORDER BY user_id")).rows;
  } else if (PUBLISHED_ONLY) {
    targets = (await client.query(
      "SELECT user_id, email FROM users WHERE password_hash = ANY($1) ORDER BY user_id",
      [publishedHashes()]
    )).rows;
    if (!targets.length) {
      console.log("\n✅ No account is using a password published in this repository.\n");
      await client.end();
      return;
    }
  } else {
    targets = (await client.query(
      "SELECT user_id, email FROM users WHERE lower(email) = ANY($1)",
      [emails.map((e) => e.toLowerCase())]
    )).rows;

    // Name the ones that don't exist rather than silently doing less than asked.
    const found = new Set(targets.map((t) => t.email.toLowerCase()));
    const missing = emails.filter((e) => !found.has(e.toLowerCase()));
    if (missing.length) {
      await client.end();
      fail(`No such user: ${missing.join(", ")}`, "Check the address, or list accounts with: npm run reset-password -- --all");
    }
  }

  const issued = [];
  for (const u of targets) {
    issued.push({ email: u.email, password: await issuePassword(client, u.user_id) });
  }
  await client.end();

  console.log(`\n🔑 Reset ${issued.length} password(s). Shown once — only the hash is stored.\n`);
  const width = Math.max(...issued.map((i) => i.email.length));
  for (const { email, password } of issued) {
    console.log(`     ${email.padEnd(width)}   ${password}`);
  }
  // The API loads users into memory at boot (masterData.load) and login
  // compares against that copy, not the table — so a running server keeps
  // accepting the old password until it restarts.
  console.log(`\n   Restart the API for this to take effect: it caches users at startup,`);
  console.log(`   so a running server still expects the previous password.\n`);
}

main().catch((err) => fail(err.message));
