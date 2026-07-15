// =========================================================================
// CREDENTIAL HELPERS  —  shared by init.js and reset-password.js
// =========================================================================
// One definition of "which passwords are public" and "how a new one is
// issued". Both scripts need the same answers, and two copies would drift.
// =========================================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

/**
 * The password_hash values written into seed.sql, whose plaintext is printed
 * in README.md. This repository is public, so any account still carrying one
 * of these can be signed into by anyone who reads it.
 *
 * Read from the file rather than hard-coded: seed.sql is the disclosure, so
 * it is also the definition — replace the hashes there and this follows,
 * instead of silently going stale.
 */
function publishedHashes() {
  const sql = fs.readFileSync(path.join(__dirname, "seed.sql"), "utf8");
  return [...new Set(sql.match(/\$2[aby]\$[0-9]{2}\$[A-Za-z0-9./]{53}/g) || [])];
}

/** Strong enough that printing it once is the only weak link. */
function strongPassword() {
  return crypto.randomBytes(15).toString("base64url");
}

/**
 * Give one user a fresh random password. Returns the plaintext — the caller's
 * only chance to show it, since only the hash is stored.
 */
async function issuePassword(client, userId) {
  const password = strongPassword();
  const hash = await bcrypt.hash(password, 10);
  await client.query("UPDATE users SET password_hash = $1 WHERE user_id = $2", [hash, userId]);
  return password;
}

module.exports = { publishedHashes, strongPassword, issuePassword };
