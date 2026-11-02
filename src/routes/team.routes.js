const express = require('express');
const db = require('../db/db');
const businesses = require('../db/businessesRepo');
const requireUser = require('../middleware/firebaseUser');
const firebase = require('../services/firebaseAdmin.service');
const router = express.Router();
router.use(requireUser);

function businessJSON(b, role) {
  return { businessId: b.id, businessName: b.name, businessType: b.business_type || '',
    apiKey: b.api_key, code: b.code || '', role };
}
function member(businessId, uid) {
  return db.prepare('SELECT * FROM business_members WHERE business_id = ? AND uid = ?').get(businessId, uid);
}
function profile(uid) {
  const row = db.prepare('SELECT * FROM user_profiles WHERE uid = ?').get(uid) || {};
  return { uid, firstName: row.first_name || '', lastName: row.last_name || '', phone: row.phone || '', bio: row.bio || '' };
}
router.get('/me/profile', (req, res) => res.json(profile(req.user.uid)));
router.put('/me/profile', (req, res) => {
  const values = {};
  for (const [key, max] of Object.entries({ firstName: 80, lastName: 80, phone: 40, bio: 500 })) {
    const value = req.body[key];
    if (typeof value !== 'string' || value.length > max) return res.status(400).json({ error: `${key} must be text of at most ${max} characters.` });
    values[key] = value.trim();
  }
  if (!values.firstName || !values.lastName) return res.status(400).json({ error: 'Please enter your first and last name.' });
  db.prepare(`INSERT INTO user_profiles (uid, first_name, last_name, phone, bio) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET first_name=excluded.first_name, last_name=excluded.last_name, phone=excluded.phone, bio=excluded.bio`)
    .run(req.user.uid, values.firstName, values.lastName, values.phone, values.bio);
  res.json(profile(req.user.uid));
});
router.get('/me/businesses', (req, res) => {
  const rows = db.prepare(`SELECT b.*, m.role FROM businesses b JOIN business_members m ON m.business_id=b.id WHERE m.uid=? ORDER BY b.name`).all(req.user.uid);
  res.json(rows.map(b => businessJSON(b, b.role)));
});
router.post('/team/join', (req, res) => {
  if (typeof req.body.code !== 'string') return res.status(400).json({ error: 'A business code is required.' });
  const b = businesses.getByCode(req.body.code.trim().toUpperCase());
  if (!b) return res.status(404).json({ error: 'No business found with that code.' });
  // Rejoining must never overwrite an existing manager or assistant role.
  db.prepare("INSERT OR IGNORE INTO business_members (business_id, uid, role) VALUES (?, ?, 'employee')").run(b.id, req.user.uid);
  res.json(businessJSON(b, member(b.id, req.user.uid).role));
});
router.use('/team/:businessId', (req, res, next) => {
  req.membership = member(req.params.businessId, req.user.uid);
  if (!req.membership) return res.status(403).json({ error: 'You must belong to this business.' });
  next();
});
router.get('/team/:businessId/members', async (req, res, next) => {
  try {
    const business = businesses.getById(req.params.businessId);
    const legacy = await firebase.legacyMemberships(business.id);
    db.transaction(() => {
      const insert = db.prepare("INSERT OR IGNORE INTO business_members (business_id, uid, role) VALUES (?, ?, 'employee')");
      for (const record of legacy) {
        if (typeof record.uid === 'string' && record.uid && record.code === business.code) {
          insert.run(business.id, record.uid);
        }
      }
    })();
  const rows = db.prepare(`SELECT m.uid, m.role, m.accepts_bookings, m.joined_at, p.first_name, p.last_name, p.bio
    FROM business_members m LEFT JOIN user_profiles p ON p.uid=m.uid
    WHERE m.business_id=? ORDER BY CASE m.role WHEN 'manager' THEN 0 WHEN 'assistant_manager' THEN 1 ELSE 2 END,
      p.first_name COLLATE NOCASE, p.last_name COLLATE NOCASE, m.uid`).all(req.params.businessId);
  // Phone numbers are private profile details and are not in the directory.
  res.json(rows.map(r => ({ uid:r.uid, role:r.role, acceptsBookings:Boolean(r.accepts_bookings), firstName:r.first_name || '', lastName:r.last_name || '', bio:r.bio || '' })));
  } catch (error) { next(error); }
});
router.patch('/team/:businessId/members/:uid/role', (req, res) => {
  const { businessId, uid } = req.params;
  const role = req.body.role;
  if (req.membership.role !== 'manager') return res.status(403).json({ error: 'Only managers can change roles.' });
  if (!['manager','assistant_manager','employee'].includes(role)) return res.status(400).json({ error: 'Choose a valid role.' });
  const result = db.transaction(() => {
    const target = member(businessId, uid);
    if (!target) return [404, { error:'This person is no longer a member.' }];
    const b = businesses.getById(businessId);
    if (b.creator_uid === uid && role !== 'manager') return [409, { error:'The business creator must remain a manager.' }];
    if (target.role === 'manager' && role !== 'manager' &&
        db.prepare("SELECT COUNT(*) AS n FROM business_members WHERE business_id=? AND role='manager'").get(businessId).n <= 1) {
      return [409, { error:'A business must have at least one manager.' }];
    }
    db.prepare('UPDATE business_members SET role=? WHERE business_id=? AND uid=?').run(role,businessId,uid);
    return [200, { success:true }];
  })();
  res.status(result[0]).json(result[1]);
});
router.patch('/team/:businessId/members/:uid/booking-settings', (req,res) => {
  if(req.membership.role !== 'manager') return res.status(403).json({error:'Only managers can configure appointment workers.'});
  if(typeof req.body.acceptsBookings !== 'boolean') return res.status(400).json({error:'acceptsBookings must be true or false.'});
  const target=member(req.params.businessId,req.params.uid);
  if(!target) return res.status(404).json({error:'Member not found.'});
  const person=profile(req.params.uid);
  if(req.body.acceptsBookings && (!person.firstName.trim() || !person.lastName.trim())) return res.status(422).json({error:'This member must save their first and last name in Profile before taking appointments.'});
  db.prepare('UPDATE business_members SET accepts_bookings=? WHERE business_id=? AND uid=?').run(req.body.acceptsBookings?1:0,req.params.businessId,req.params.uid);
  res.json({success:true});
});
module.exports = router;
