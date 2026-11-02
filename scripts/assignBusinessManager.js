// Run only by an operator after verifying the account owns the legacy business.
require('dotenv').config();
const db = require('../src/db/db');
const [businessId, uid] = process.argv.slice(2);
if (!businessId || !uid) {
  console.error('Usage: node scripts/assignBusinessManager.js <business-id> <verified-firebase-uid>');
  process.exit(1);
}
try {
  db.transaction(() => {
    const business = db.prepare('SELECT creator_uid FROM businesses WHERE id=?').get(businessId);
    if (!business) throw new Error('Business not found.');
    if (business.creator_uid && business.creator_uid !== uid) throw new Error('This business already has a different creator.');
    db.prepare('UPDATE businesses SET creator_uid=? WHERE id=?').run(uid,businessId);
    db.prepare("INSERT INTO business_members (business_id, uid, role) VALUES (?, ?, 'manager') ON CONFLICT(business_id,uid) DO UPDATE SET role='manager'").run(businessId,uid);
  })();
  console.log('Verified creator assigned as manager.');
} finally { db.close(); }
