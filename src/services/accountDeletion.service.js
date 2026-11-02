const db=require('../db/db'),firebase=require('./firebaseAdmin.service'),calendar=require('./googleCalendar.service'),businesses=require('../db/businessesRepo');
const running=new Set();
async function cancelFuture(rows){
 for(const row of rows){
  const business=businesses.getById(row.business_id);
  // Delete deterministic events too, covering a prior interrupted creation.
  if(business.google_calendar_id)await calendar.cancelBookingEvent(row.google_event_id||calendar.bookingEventId(business.id,row.id),business);
  db.transaction(()=>{
   db.prepare("UPDATE bookings SET status='cancelled',cancellation_reason='Staff account removed',responded_at=? WHERE id=?").run(new Date().toISOString(),row.id);
   require('./bookingLifecycle.service').enqueue(row.id,'cancelled');
  })();
 }
}
async function detach(uid,businessId){
 // Stop new assignments before waiting for Google. On failure the manager can retry.
 db.prepare('UPDATE business_members SET accepts_bookings=0 WHERE uid=? AND business_id=?').run(uid,businessId);
 const rows=db.prepare("SELECT * FROM bookings WHERE worker_uid=? AND business_id=? AND end_time>? AND status NOT IN ('cancelled','failed','expired','declined') ORDER BY id DESC").all(uid,businessId,new Date().toISOString());
 await cancelFuture(rows);
 db.transaction(()=>{
  db.prepare('DELETE FROM business_members WHERE uid=? AND business_id=?').run(uid,businessId);
  db.prepare('DELETE FROM worker_availability WHERE uid=? AND business_id=?').run(uid,businessId);
  db.prepare("INSERT INTO join_requests(business_id,uid,status) VALUES(?,?,'rejected') ON CONFLICT(business_id,uid) DO UPDATE SET status='rejected'").run(businessId,uid);
 })();
}
async function perform(uid){
 if(running.has(uid))return false;running.add(uid);
 try{
 const job=db.prepare('SELECT * FROM account_deletions WHERE uid=?').get(uid);if(!job)return true;
 await firebase.revokeUser(uid);
 db.prepare('UPDATE business_members SET accepts_bookings=0 WHERE uid=?').run(uid);
 // Let any already-started calendar operation finish before deleting its event.
 const recent=db.prepare("SELECT id FROM bookings WHERE worker_uid=? AND status IN ('pending_calendar','rescheduling','cancelling') AND responded_at>?").get(uid,new Date(Date.now()-120000).toISOString());
 if(recent)return false;
 const future=db.prepare("SELECT * FROM bookings WHERE worker_uid=? AND end_time>? AND status NOT IN ('cancelled','failed','expired','declined') ORDER BY id DESC").all(uid,new Date().toISOString());
 await cancelFuture(future);
 await firebase.deleteAccountData(uid,job.email);
 const ownCustomer=job.email?db.prepare('SELECT * FROM bookings WHERE lower(customer_email)=?').all(job.email):[];
 // Remove personal details from WorkBay-created Google events before local scrubbing.
 const assigned=db.prepare('SELECT * FROM bookings WHERE worker_uid=?').all(uid);
 for(const row of [...new Map([...assigned,...ownCustomer].map(row=>[row.id,row])).values()]){
  const business=businesses.getById(row.business_id);
  if(row.google_event_id&&business.google_calendar_id)await calendar.redactBookingEvent(row.google_event_id,business,{customer:ownCustomer.some(c=>c.id===row.id),worker:row.worker_uid===uid});
 }
 db.transaction(()=>{
  db.prepare("DELETE FROM booking_notifications WHERE recipient IN ('worker','worker_push') AND booking_id IN (SELECT id FROM bookings WHERE worker_uid=?)").run(uid);
  for(const table of ['user_profiles','business_members','worker_availability','push_tokens','join_requests'])db.prepare(`DELETE FROM ${table} WHERE uid=?`).run(uid);
  db.prepare('DELETE FROM chat_sessions WHERE owner_uid=?').run(uid);
  db.prepare('DELETE FROM clock_sessions WHERE uid=?').run(uid);
  db.prepare('UPDATE bookings SET worker_uid=NULL,worker_name=NULL WHERE worker_uid=?').run(uid);
  db.prepare('UPDATE bookings SET created_by_uid=NULL,manual_request_id=NULL WHERE created_by_uid=?').run(uid);
  db.prepare('UPDATE businesses SET creator_uid=NULL WHERE creator_uid=?').run(uid);
  for(const service of db.prepare('SELECT id,worker_uids_json FROM appointment_services').all()){
   const filtered=JSON.parse(service.worker_uids_json).filter(value=>value!==uid);
   db.prepare('UPDATE appointment_services SET worker_uids_json=? WHERE id=?').run(JSON.stringify(filtered),service.id);
  }
  if(job.email){
   db.prepare("UPDATE bookings SET customer_name='Deleted customer',customer_email=NULL,customer_phone=NULL,notes=NULL WHERE lower(customer_email)=?").run(job.email);
   db.prepare("UPDATE orders SET customer_name='Deleted customer',customer_email=NULL,customer_phone=NULL WHERE lower(customer_email)=?").run(job.email);
   db.prepare('DELETE FROM verification_codes WHERE email=?').run(job.email);
   db.prepare('DELETE FROM contact_messages WHERE lower(email)=?').run(job.email);
  }
 })();
 await firebase.deleteUser(uid);
 db.prepare('DELETE FROM account_deletions WHERE uid=?').run(uid);
 return true;
 }finally{running.delete(uid);}
}
async function remove(user){
 const email=user.email_verified&&typeof user.email==='string'?user.email.trim().toLowerCase():null;
 db.prepare('INSERT OR IGNORE INTO account_deletions(uid,email) VALUES(?,?)').run(user.uid,email);
 db.prepare('DELETE FROM push_tokens WHERE uid=?').run(user.uid);
 try{return await perform(user.uid);}catch(error){console.error('[account-deletion] queued for retry');return false;}
}
async function retry(){for(const row of db.prepare('SELECT uid FROM account_deletions LIMIT 20').all()){try{await perform(row.uid);}catch(error){console.error('[account-deletion] retry deferred');}}}
module.exports={remove,detach,retry};

async function customerRequests(){
 for(const request of db.prepare('SELECT * FROM privacy_requests WHERE completed_at IS NULL LIMIT 20').all()){
  const rows=db.prepare('SELECT * FROM bookings WHERE lower(customer_email)=?').all(request.email);
  for(const row of rows){const business=businesses.getById(row.business_id);if(row.google_event_id&&business.google_calendar_id)await calendar.redactBookingEvent(row.google_event_id,business,{customer:true,worker:false});}
  db.transaction(()=>{
   db.prepare("UPDATE bookings SET customer_name='Deleted customer',customer_email=NULL,customer_phone=NULL,notes=NULL WHERE lower(customer_email)=?").run(request.email);
   db.prepare("UPDATE orders SET customer_name='Deleted customer',customer_email=NULL,customer_phone=NULL WHERE lower(customer_email)=?").run(request.email);
   db.prepare('DELETE FROM contact_messages WHERE lower(email)=?').run(request.email);
   // Anonymous chat histories cannot safely be attributed by email; purge histories
   // containing that exact email conservatively without exposing anyone else's history.
   const needle=request.email.toLowerCase();
   for(const row of db.prepare('SELECT id,history_json FROM chat_sessions').all())if(row.history_json.toLowerCase().includes(needle))db.prepare('DELETE FROM chat_sessions WHERE id=?').run(row.id);
   db.prepare('DELETE FROM privacy_requests WHERE id=?').run(request.id);
  })();
 }
}
module.exports.customerRequests=customerRequests;
