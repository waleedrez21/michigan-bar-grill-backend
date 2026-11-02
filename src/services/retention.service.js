const db=require('../db/db');
let lastRun=0;
async function run(){
 if(Date.now()-lastRun<3600000)return;lastRun=Date.now();
 db.prepare("DELETE FROM verification_codes WHERE datetime(created_at)<datetime('now','-1 day')").run();
 db.prepare("DELETE FROM email_verification_grants WHERE expires_at<?").run(new Date().toISOString());
 db.prepare("DELETE FROM chat_sessions WHERE datetime(updated_at)<datetime('now','-30 days')").run();
 db.prepare("DELETE FROM contact_messages WHERE datetime(created_at)<datetime('now','-90 days')").run();
 db.prepare("DELETE FROM push_tokens WHERE datetime(updated_at)<datetime('now','-90 days')").run();
 db.prepare("DELETE FROM join_requests WHERE status<>'approved' AND datetime(created_at)<datetime('now','-90 days')").run();
 // Calendar redaction must succeed before removing local contacts.
 const rows=db.prepare("SELECT * FROM bookings WHERE datetime(end_time)<datetime('now','-365 days') AND (customer_email IS NOT NULL OR customer_phone IS NOT NULL OR notes IS NOT NULL OR worker_name IS NOT NULL)").all();
 for(const row of rows){
  const business=require('../db/businessesRepo').getById(row.business_id);
  if(row.google_event_id&&business.google_calendar_id)await require('./googleCalendar.service').redactBookingEvent(row.google_event_id,business,{customer:true,worker:true});
  db.prepare("UPDATE bookings SET customer_name='Archived customer',customer_email=NULL,customer_phone=NULL,notes=NULL,worker_uid=NULL,worker_name=NULL,created_by_uid=NULL,manual_request_id=NULL,status_token=NULL WHERE id=?").run(row.id);
 }
 db.prepare("UPDATE orders SET customer_name='Archived customer',customer_email=NULL,customer_phone=NULL WHERE datetime(created_at)<datetime('now','-365 days')").run();
 db.prepare("DELETE FROM clock_sessions WHERE clock_out IS NOT NULL AND datetime(clock_out)<datetime('now','-365 days')").run();
}
module.exports={run};
