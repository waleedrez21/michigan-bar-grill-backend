const crypto=require('crypto');
const db=require('../db/db');
const calendar=require('./googleCalendar.service');
const availability=require('./workerAvailability.service');
function fail(status,message){const e=new Error(message);e.status=status;e.publicMessage=message;throw e;}
function enqueue(id,event){
 const insert=db.prepare('INSERT OR IGNORE INTO booking_notifications(booking_id,event,recipient) VALUES(?,?,?)');
 if(db.prepare('SELECT customer_email FROM bookings WHERE id=?').get(id)?.customer_email)insert.run(id,event,'customer');
 const booking=db.prepare('SELECT source,created_by_uid,worker_uid,replaces_booking_id FROM bookings WHERE id=?').get(id);
 const ownConfirmation=event==='confirmed'&&booking?.source==='app'&&booking.created_by_uid===booking.worker_uid&&!booking.replaces_booking_id;
 if(!ownConfirmation&&['requested','cancelled','confirmed','declined','expired','calendar_review','cancellation_review'].includes(event))insert.run(id,event,'worker');
 if(!ownConfirmation&&['requested','cancelled','confirmed','declined','expired'].includes(event))insert.run(id,event,'worker_push');
}
function expire(){
 return db.transaction(()=>{
  const now=new Date().toISOString();
  const rows=db.prepare("SELECT id FROM bookings WHERE status='pending_worker' AND response_deadline<=?").all(now);
  for(const row of rows){db.prepare("UPDATE bookings SET status='expired',responded_at=? WHERE id=? AND status='pending_worker'").run(now,row.id);enqueue(row.id,'expired');}
  return rows.length;
 })();
}
function token(){return crypto.randomBytes(32).toString('hex');}
function responseDeadline(start){
 const raw=Number(process.env.BOOKING_RESPONSE_MINUTES||120);
 const minutes=Number.isFinite(raw)&&raw>0?Math.min(raw,1440):120;
 return new Date(Math.min(Date.now()+minutes*60000,Date.parse(start))).toISOString();
}
function publicStatus(value){
 const row=db.prepare('SELECT * FROM bookings WHERE status_token=?').get(value);
 if(!row)fail(404,'Appointment request not found.');
 const replacement=db.prepare('SELECT status,status_token,worker_name,start_time FROM bookings WHERE replaces_booking_id=? ORDER BY id DESC LIMIT 1').get(row.id);
 const parent=row.replaces_booking_id?db.prepare('SELECT id,status,status_token,start_time FROM bookings WHERE id=?').get(row.replaces_booking_id):null;
 return {original:parent?{id:parent.id,status:parent.status,statusToken:parent.status_token,start:parent.start_time}:null,serviceName:row.service_name,priceCents:row.price_cents,currency:row.currency,serviceId:row.service_id,workerUid:row.worker_uid,replacement:replacement?{status:replacement.status,statusToken:replacement.status_token,workerName:replacement.worker_name,start:replacement.start_time}:null,id:row.id,status:row.status,workerName:row.worker_name,start:row.start_time,end:row.end_time,responseDeadline:row.response_deadline};
}
async function respond(business,uid,id,decision){
 if(!['accept','decline'].includes(decision))fail(400,'Choose accept or decline.');
 expire();
 const booking=db.transaction(()=>{
  const row=db.prepare('SELECT * FROM bookings WHERE id=? AND business_id=? AND worker_uid=?').get(id,business.id,uid);
  if(!row)fail(404,'Appointment request not found for your account.');
  if(row.status!=='pending_worker' || Date.parse(row.response_deadline)<=Date.now() || (row.source!=='app' && Date.parse(row.start_time)<=Date.now()) || Date.parse(row.end_time)<=Date.now())fail(409,'This request has already been answered or expired.');
  const now=new Date().toISOString();
  if(decision==='accept' && !calendar.isWithinBusinessHours(row.start_time,row.end_time,business))fail(409,'This appointment is outside the current business opening hours. Decline the request or contact your manager.');
  if(decision==='accept' && !availability.available(business.id,uid,availability.utc(row.start_time),availability.utc(row.end_time)))fail(409,'This appointment is outside your current availability.');
  db.prepare('UPDATE bookings SET status=?,responded_at=? WHERE id=? AND status=?').run(decision==='decline'?'declined':'pending_calendar',now,row.id,'pending_worker');
  if(decision==='decline')enqueue(row.id,'declined');
  return row;
 })();
 if(decision==='decline')return {success:true,status:'declined'};
 return confirmReserved(business,booking);
}
// Only call after the request has been accepted by its worker or that
// worker has created their own manual appointment through the trusted route.
async function confirmReserved(business,booking){
 const id=booking.id,uid=booking.worker_uid;
 const parent=booking.replaces_booking_id?db.prepare('SELECT * FROM bookings WHERE id=? AND business_id=?').get(booking.replaces_booking_id,business.id):null;
 if(parent && !['confirmed','rescheduling','calendar_review'].includes(parent.status))fail(409,'The original appointment changed. Ask your manager to review this request.');
 if(parent)db.prepare("UPDATE bookings SET status='rescheduling' WHERE id=?").run(parent.id);
 try{
  if(!await calendar.isWorkerSlotFree(booking.start_time,booking.end_time,business,uid,[booking.google_event_id,parent?.google_event_id].filter(Boolean))){
   if(booking.reconciling&&booking.google_event_id){if(parent)db.prepare("UPDATE bookings SET status='calendar_review' WHERE id=?").run(parent.id);fail(409,'Another calendar event conflicts with this existing appointment. Resolve it manually before retrying.');}
   db.transaction(()=>{db.prepare("UPDATE bookings SET status='declined' WHERE id=?").run(id);enqueue(id,'declined');})();
   if(parent)db.prepare("UPDATE bookings SET status='confirmed' WHERE id=?").run(parent.id);
   fail(409,'Your calendar is no longer free. The request was declined and the customer will be notified.');
  }
  const event=booking.reconciling&&booking.google_event_id?{id:booking.google_event_id}:business.google_calendar_id?await calendar.createBookingEvent({business,customerName:booking.customer_name,customerEmail:booking.customer_email,
   customerPhone:booking.customer_phone,partySize:booking.party_size,startISO:booking.start_time,endISO:booking.end_time,notes:booking.notes,workerUid:uid,workerName:booking.worker_name,bookingId:booking.id}):null;
  if(business.google_calendar_id && !event?.id)throw new Error('Calendar did not return an event ID.');
  if(parent?.google_event_id && business.google_calendar_id)await calendar.cancelBookingEvent(parent.google_event_id,business);
  db.transaction(()=>{
   if(parent){db.prepare("UPDATE bookings SET status='cancelled',cancellation_reason='Rescheduled' WHERE id=?").run(parent.id);enqueue(parent.id,'cancelled');}
   db.prepare("UPDATE bookings SET status='confirmed',google_event_id=? WHERE id=?").run(event?.id||null,id);enqueue(id,'confirmed');})();
  return {success:true,status:'confirmed'};
 }catch(error){
  if(error.publicMessage)throw error;
  db.transaction(()=>{if(parent)db.prepare("UPDATE bookings SET status='calendar_review' WHERE id=?").run(parent.id);db.prepare("UPDATE bookings SET status='calendar_review' WHERE id=?").run(id);enqueue(id,'calendar_review');})();
  fail(503,'Calendar confirmation needs review. This appointment is not confirmed; contact your manager.');
 }
}
module.exports={expire,enqueue,token,responseDeadline,publicStatus,respond,confirmReserved};
