const db = require("./db");
const crypto = require("node:crypto");

/** 6-digit numeric code, e.g. "483920". */
function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function insertCode(email, purpose='signup') {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

  const salt=crypto.randomBytes(16).toString('hex');
  const stored='sha256:'+salt+':'+crypto.createHash('sha256').update(salt+':'+code).digest('hex');
  db.prepare(
    `INSERT INTO verification_codes (email, code, expires_at, purpose) VALUES (?, ?, ?, ?)`
  ).run(email.toLowerCase().trim(), stored, expiresAt, purpose);

  return { code, expiresAt };
}

/** Most recent (unverified) code sent for this email, if any. */
function getLatestForEmail(email, purpose='signup') {
  return db
    .prepare(
      `SELECT * FROM verification_codes WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1`
    )
    .get(email.toLowerCase().trim(), purpose);
}

function incrementAttempts(id) {
  db.prepare(`UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?`).run(id);
}

function markVerified(id) {
  db.prepare(`UPDATE verification_codes SET verified = 1 WHERE id = ?`).run(id);
}

function checkCode(row,value){
 if(typeof value!=='string'||!/^\d{6}$/.test(value.trim()))return false;
 const parts=row.code.split(':');if(parts.length!==3||parts[0]!=='sha256')return false;
 const actual=crypto.createHash('sha256').update(parts[1]+':'+value.trim()).digest();
 const expected=Buffer.from(parts[2],'hex');return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);
}
module.exports = { insertCode, getLatestForEmail, incrementAttempts, markVerified, checkCode };
