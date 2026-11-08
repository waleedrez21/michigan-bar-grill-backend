const express = require('express');
const db = require('../db/db');
const businesses = require('../db/businessesRepo');
const requireUser = require('../middleware/firebaseUser');
const firebase = require('../services/firebaseAdmin.service');
const router = express.Router();
router.use(['/me','/team'],requireUser);

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
router.post('/me/push-tokens',(req,res)=>{
  const token=req.body.token;if(typeof token!=='string'||token.length<20||token.length>4096)return res.status(400).json({error:'Invalid push token.'});
  db.prepare('INSERT INTO push_tokens(token,uid,updated_at) VALUES(?,?,?) ON CONFLICT(token) DO UPDATE SET uid=excluded.uid,updated_at=excluded.updated_at').run(token,req.user.uid,new Date().toISOString());res.json({success:true});
});
router.delete('/me/push-tokens',(req,res)=>{db.prepare('DELETE FROM push_tokens WHERE token=? AND uid=?').run(typeof req.body.token==='string'?req.body.token:'',req.user.uid);res.json({success:true});});
router.post('/me/verify-email',async(req,res,next)=>{
 try{
  if(typeof req.body.verificationToken!=='string'||!req.user.email)return res.status(400).json({error:'Email verification proof required.'});
  const hash=require('node:crypto').createHash('sha256').update(req.body.verificationToken).digest('hex');
  const grant=db.prepare('SELECT * FROM email_verification_grants WHERE token_hash=? AND email=? AND expires_at>?').get(hash,req.user.email.toLowerCase().trim(),new Date().toISOString());
  if(!grant)return res.status(400).json({error:'Email verification expired. Request a new code.'});
  db.prepare('DELETE FROM email_verification_grants WHERE token_hash=?').run(hash);
  await firebase.markEmailVerified(req.user.uid);res.json({success:true});
 }catch(error){next(error);}
});
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
router.post('/team/join', require('../middleware/securityLimits').join, (req, res) => {
  if (typeof req.body.code !== 'string') return res.status(400).json({ error: 'A business code is required.' });
  const b = businesses.getByCode(req.body.code.trim().toUpperCase());
  if (!b) return res.status(404).json({ error: 'No business found with that code.' });
  const existing = member(b.id, req.user.uid);
  if (existing) return res.json(businessJSON(b, existing.role));
  db.prepare("INSERT INTO join_requests(business_id,uid,status) VALUES(?,?,'pending') ON CONFLICT(business_id,uid) DO NOTHING").run(b.id,req.user.uid);
  const request = db.prepare('SELECT status FROM join_requests WHERE business_id=? AND uid=?').get(b.id,req.user.uid);
  if(request.status === 'rejected') return res.status(403).json({error:'Your request was declined. Ask the business manager to invite you again.'});
  res.status(202).json({businessId:b.id,businessName:b.name,businessType:b.business_type||'',code:b.code,apiKey:'',pendingApproval:true});
});
router.get('/me/join-requests', (req,res)=>res.json(db.prepare("SELECT j.business_id AS businessId,b.name AS businessName,j.status FROM join_requests j JOIN businesses b ON b.id=j.business_id WHERE j.uid=?").all(req.user.uid)));
router.delete('/me/join-requests/:businessId', (req,res)=>{
  db.prepare('DELETE FROM join_requests WHERE uid=? AND business_id=?').run(req.user.uid,req.params.businessId);res.json({success:true});
});
router.delete('/me/account',async(req,res,next)=>{
  try {
    if(!Number.isFinite(req.user.auth_time) || Date.now()/1000-req.user.auth_time>300) return res.status(401).json({error:'For your security, sign out and sign in again, then delete your account within five minutes.'});
    const completed=await require('../services/accountDeletion.service').remove(req.user);res.json({success:true,completed});
  } catch(error){next(error);}
});
router.use('/team/:businessId', (req, res, next) => {
  req.membership = member(req.params.businessId, req.user.uid);
  if (!req.membership) return res.status(403).json({ error: 'You must belong to this business.' });
  next();
});
function managerOnly(req,res){if(req.membership.role!=='manager'){res.status(403).json({error:'Only managers can approve or remove members.'});return false;}return true;}
router.get('/team/:businessId/join-requests',(req,res)=>{
 if(!managerOnly(req,res))return;
 res.json(db.prepare("SELECT j.uid, j.status, p.first_name AS firstName, p.last_name AS lastName FROM join_requests j LEFT JOIN user_profiles p ON p.uid=j.uid WHERE j.business_id=? AND j.status='pending'").all(req.params.businessId));
});
router.post('/team/:businessId/join-requests/:uid',(req,res)=>{
 if(!managerOnly(req,res))return;
 if(!['approve','reject'].includes(req.body.decision))return res.status(400).json({error:'Choose approve or reject.'});
 const {businessId,uid}=req.params;
 const result=db.transaction(()=>{
  const request=db.prepare("SELECT * FROM join_requests WHERE business_id=? AND uid=? AND status='pending'").get(businessId,uid);
  if(!request || db.prepare('SELECT uid FROM account_deletions WHERE uid=?').get(uid))return false;
  if(req.body.decision==='approve')db.prepare("INSERT OR IGNORE INTO business_members(business_id,uid,role) VALUES(?,?,'employee')").run(businessId,uid);
  db.prepare("UPDATE join_requests SET status=? WHERE business_id=? AND uid=?").run(req.body.decision==='approve'?'approved':'rejected',businessId,uid);return true;
 })();
 if(!result)return res.status(404).json({error:'Pending request not found.'});
 res.json({success:true});
});
router.delete('/team/:businessId/members/:uid',async(req,res,next)=>{
 try{
 if(!managerOnly(req,res))return;
 const {businessId,uid}=req.params;
 const target=member(businessId,uid);
 if(!target)return res.status(404).json({error:'Member not found.'});
 if(target.role==='manager')return res.status(409).json({error:'Change this manager to an employee first. The creator and last manager remain protected.'});
 await require('../services/accountDeletion.service').detach(uid,businessId);
 res.json({success:true});
 }catch(error){next(error);}
});
router.get('/team/:businessId/clock/weekly', (req, res, next) => {
  if (req.membership.role !== 'manager') {
    return res.status(403).json({ error: 'Only managers can view team hours.' });
  }
  const offset = req.query.weeksAgo ?? '0';
  if (typeof offset !== 'string' || !/^\d{1,2}$/.test(offset) || Number(offset) > 52) {
    return res.status(400).json({ error: 'Choose a week within the last 52 weeks.' });
  }
  try {
    res.set('Cache-Control', 'no-store');
    res.json(require('../services/timeClock.service').weeklyHours(req.params.businessId, Number(offset)));
  } catch (error) {
    next(error);
  }
});
router.get('/team/:businessId/me/clock',(req,res)=>res.json(require('../services/timeClock.service').get(req.params.businessId,req.user.uid)));
router.post('/team/:businessId/me/clock',(req,res,next)=>{try{res.json(require('../services/timeClock.service').change(req.params.businessId,req.user.uid,req.body.action));}catch(error){next(error);}});
router.get('/team/:businessId/members', async (req, res, next) => {
  try {
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
  if(req.body.acceptsBookings && !require('../services/workerAvailability.service').get(req.params.businessId,req.params.uid).weekly.some(day=>day.intervals.length)) return res.status(422).json({error:'This member must save working hours in My availability before taking appointments.'});
  db.prepare('UPDATE business_members SET accepts_bookings=? WHERE business_id=? AND uid=?').run(req.body.acceptsBookings?1:0,req.params.businessId,req.params.uid);
  res.json({success:true});
});
router.get('/team/:businessId/me/availability',(req,res,next)=>{
  try{res.json(require('../services/workerAvailability.service').get(req.params.businessId,req.user.uid));}catch(error){next(error);}
});
router.put('/team/:businessId/me/availability',(req,res,next)=>{
  try{res.json(require('../services/workerAvailability.service').save(req.params.businessId,req.user.uid,req.body));}catch(error){next(error);}
});
router.post('/team/:businessId/bookings/:id/respond',async(req,res,next)=>{
  try{
    if(!/^\d+$/.test(req.params.id))return res.status(400).json({error:'Invalid appointment ID.'});
    res.json(await require('../services/bookingLifecycle.service').respond(businesses.getById(req.params.businessId),req.user.uid,Number(req.params.id),req.body.decision));
  }catch(error){next(error);}
});
function sameManualInput(row,input){
  try{
    const instant=require('../services/workerBooking.service').instant;
    return row.worker_uid===input.workerUid && row.customer_name===input.customerName.trim() &&
      (row.customer_email||null)===(input.customerEmail?.trim()||null) &&
      (row.customer_phone||null)===(input.customerPhone||null) && (row.notes||null)===(input.notes||null) &&
      instant(row.start_time)===instant(input.startDateTime) && (row.service_id||null)===(input.serviceId||null) && (row.service_id || instant(row.end_time)===instant(input.endDateTime));
  }catch{return false;}
}
router.post('/team/:businessId/bookings/manual',async(req,res,next)=>{
  try{
    const service=require('../services/workerBooking.service');
    const business=businesses.getById(req.params.businessId);
    if(!service.staffBusiness(business))return res.status(422).json({error:'Manual worker appointments are available for appointment businesses.'});
    const input=Object.fromEntries(['requestId','customerName','customerEmail','customerPhone','notes','workerUid','startDateTime','endDateTime','serviceId'].map(key=>[key,req.body[key]]));
    const requestId=input.requestId;
    if(typeof requestId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))return res.status(400).json({error:'A valid request ID is required.'});
    if(typeof input.workerUid!=='string' || !input.workerUid)return res.status(400).json({error:'Choose the worker for this appointment.'});
    const manages=['manager','assistant_manager'].includes(req.membership.role);
    if(input.workerUid!==req.user.uid && !manages)return res.status(403).json({error:'You can only add appointments to your own schedule.'});
    if(input.customerPhone!=null && (typeof input.customerPhone!=='string'||input.customerPhone.length>80))return res.status(400).json({error:'Phone must be text of at most 80 characters.'});
    if(input.notes!=null && (typeof input.notes!=='string'||input.notes.length>2000))return res.status(400).json({error:'Notes must be text of at most 2000 characters.'});
    if(typeof input.customerName!=='string'||input.customerName.length>160)return res.status(400).json({error:'Enter a customer name of at most 160 characters.'});
    const existing=db.prepare('SELECT * FROM bookings WHERE business_id=? AND created_by_uid=? AND manual_request_id=?').get(business.id,req.user.uid,requestId);
    if(existing){
      if(!sameManualInput(existing,input))return res.status(409).json({error:`This form already created appointment #${existing.id}. Close it and check the schedule before adding another.`});
      return res.json(service.resultFor(existing));
    }
    const result=await service.create(business,input,'app',{manual:true,actorUid:req.user.uid,requestId});
    const created=db.prepare('SELECT * FROM bookings WHERE id=?').get(result.id);
    if(!sameManualInput(created,input))return res.status(409).json({error:`This form already created appointment #${created.id}. Check the schedule before adding another.`});
    res.status(201).json(result);
  }catch(error){
    // A simultaneous retry may reach the conflict check after the first
    // request reserved its slot. Return that same appointment, not a duplicate.
    const existing=typeof req.body.requestId==='string'?db.prepare('SELECT * FROM bookings WHERE business_id=? AND created_by_uid=? AND manual_request_id=?').get(req.params.businessId,req.user.uid,req.body.requestId):null;
    if(existing && error.status===409){
      if(!sameManualInput(existing,req.body))return res.status(409).json({error:`This form already created appointment #${existing.id}. Check the schedule before adding another.`});
      return res.json(require('../services/workerBooking.service').resultFor(existing));
    }
    next(error);
  }
});
function manages(req,res){if(!['manager','assistant_manager'].includes(req.membership.role)){res.status(403).json({error:'Manager access required.'});return false;}return true;}
router.get('/team/:businessId/services',(req,res,next)=>{try{res.json(require('../services/appointmentCatalog.service').list(req.params.businessId,true));}catch(e){next(e);}});
router.post('/team/:businessId/services',(req,res,next)=>{try{if(!manages(req,res))return;res.status(201).json(require('../services/appointmentCatalog.service').save(req.params.businessId,req.body));}catch(e){next(e);}});
router.put('/team/:businessId/services/:id',(req,res,next)=>{try{if(!manages(req,res))return;res.json(require('../services/appointmentCatalog.service').save(req.params.businessId,req.body,req.params.id));}catch(e){next(e);}});
router.post('/team/:businessId/bookings/:id/cancel',async(req,res,next)=>{
 try{const change=require('../services/bookingChanges.service'),row=change.get(Number(req.params.id),req.params.businessId);if(row.worker_uid!==req.user.uid&&!['manager','assistant_manager'].includes(req.membership.role))return res.status(403).json({error:'You can only change your own appointments.'});res.json(await change.cancel(businesses.getById(req.params.businessId),row.id,req.body.reason||''));}catch(e){next(e);}
});
router.post('/team/:businessId/bookings/:id/reschedule',async(req,res,next)=>{
 try{const change=require('../services/bookingChanges.service'),row=change.get(Number(req.params.id),req.params.businessId);const manager=['manager','assistant_manager'].includes(req.membership.role);if(row.worker_uid!==req.user.uid&&!manager)return res.status(403).json({error:'You can only change your own appointments.'});if(req.body.workerUid&&req.body.workerUid!==req.user.uid&&!manager)return res.status(403).json({error:'Only managers can reassign another worker.'});res.json(await change.reschedule(businesses.getById(req.params.businessId),row.id,req.body,req.user.uid));}catch(e){next(e);}
});
router.get('/team/:businessId/operations',(req,res,next)=>{
 try{if(!manages(req,res))return;require('../services/bookingLifecycle.service').expire();
  const b=req.params.businessId;
  const pending=db.prepare("SELECT * FROM bookings WHERE business_id=? AND status='pending_worker' ORDER BY response_deadline").all(b);
  const issues=db.prepare("SELECT * FROM bookings WHERE business_id=? AND status IN ('calendar_review','cancellation_review','pending_calendar','cancelling','rescheduling') ORDER BY start_time").all(b);
  const notifications=db.prepare(`SELECT n.id,n.booking_id,n.event,n.recipient,n.attempts,n.next_attempt_at FROM booking_notifications n JOIN bookings b ON b.id=n.booking_id WHERE b.business_id=? AND n.sent_at IS NULL ORDER BY n.attempts DESC,n.id LIMIT 100`).all(b);
  const noPush=db.prepare(`SELECT m.uid,p.first_name,p.last_name FROM business_members m LEFT JOIN user_profiles p ON p.uid=m.uid WHERE m.business_id=? AND m.accepts_bookings=1 AND NOT EXISTS (SELECT 1 FROM push_tokens t WHERE t.uid=m.uid)`).all(b).map(w=>({uid:w.uid,name:`${w.first_name||''} ${w.last_name||''}`.trim()||'Member'}));
  res.json({pending,calendarIssues:issues,notifications,workersWithoutPush:noPush,emailConfigured:require('../services/email.service').isConfigured()});
 }catch(e){next(e);}
});
router.post('/team/:businessId/notifications/:id/retry',(req,res,next)=>{
 try{if(!manages(req,res))return;const row=db.prepare('SELECT n.id FROM booking_notifications n JOIN bookings b ON b.id=n.booking_id WHERE n.id=? AND b.business_id=? AND n.sent_at IS NULL').get(Number(req.params.id),req.params.businessId);if(!row)return res.status(404).json({error:'Queued notification not found.'});db.prepare('UPDATE booking_notifications SET next_attempt_at=NULL WHERE id=?').run(row.id);res.json({success:true});}catch(e){next(e);}
});
router.post('/team/:businessId/bookings/:id/reconcile',async(req,res,next)=>{try{if(!manages(req,res))return;res.json(await require('../services/bookingChanges.service').reconcile(businesses.getById(req.params.businessId),Number(req.params.id)));}catch(e){next(e);}});
router.get('/team/:businessId/bookings/:id',(req,res,next)=>{
 try{const row=require('../services/bookingChanges.service').get(Number(req.params.id),req.params.businessId);if(row.worker_uid!==req.user.uid&&!['manager','assistant_manager'].includes(req.membership.role))return res.status(403).json({error:'You can only view your own appointments.'});res.json(row);}catch(e){next(e);}
});
module.exports = router;
