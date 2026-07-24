const db = require("./db");

/** 6-digit numeric code, e.g. "483920". */
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function insertCode(email) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

  db.prepare(
    `INSERT INTO verification_codes (email, code, expires_at) VALUES (?, ?, ?)`
  ).run(email.toLowerCase().trim(), code, expiresAt);

  return { code, expiresAt };
}

/** Most recent (unverified) code sent for this email, if any. */
function getLatestForEmail(email) {
  return db
    .prepare(
      `SELECT * FROM verification_codes WHERE email = ? ORDER BY id DESC LIMIT 1`
    )
    .get(email.toLowerCase().trim());
}

function incrementAttempts(id) {
  db.prepare(`UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?`).run(id);
}

function markVerified(id) {
  db.prepare(`UPDATE verification_codes SET verified = 1 WHERE id = ?`).run(id);
}

/** Has this email successfully verified a code recently (within the last
 *  hour)? Used right before creating the real account, as a final guard
 *  so account creation can't be reached without having verified. */
function hasRecentVerification(email) {
  const row = db
    .prepare(
      `SELECT * FROM verification_codes
       WHERE email = ? AND verified = 1
       AND datetime(created_at) > datetime('now', '-1 hour')
       ORDER BY id DESC LIMIT 1`
    )
    .get(email.toLowerCase().trim());
  return !!row;
}

module.exports = { insertCode, getLatestForEmail, incrementAttempts, markVerified, hasRecentVerification };
