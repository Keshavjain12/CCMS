const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

function publishedHashes() {
  const sql = fs.readFileSync(path.join(__dirname, "seed.sql"), "utf8");
  return [...new Set(sql.match(/\$2[aby]\$[0-9]{2}\$[A-Za-z0-9./]{53}/g) || [])];
}

function strongPassword() {
  return crypto.randomBytes(15).toString("base64url");
}

async function issuePassword(client, userId) {
  const password = strongPassword();
  const hash = await bcrypt.hash(password, 10);
  await client.query("UPDATE users SET password_hash = $1 WHERE user_id = $2", [hash, userId]);
  return password;
}

module.exports = { publishedHashes, strongPassword, issuePassword };
