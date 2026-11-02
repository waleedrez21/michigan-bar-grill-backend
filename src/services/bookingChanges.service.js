const db=require('../db/db'),calendar=require('./googleCalendar.service'),lifecycle=require('./bookingLifecycle.service');
function fail(status,message){const e=new Error(message);e.status=status;e.publicMessage=message;throw e;}
function get(id,businessId){const row=db.prepare('SELECT * FROM bookings WHERE id=? AND business_id=?').get(id,businessId);if(!row)fail(404,'Appointment not found.');return row;}
async function cancel(business,id,reason=''){
 if(typeof reason!=='string'||reason.length>500)fail(400,'Cancellation reason must be at most 500 characters.');
 const booking=db.transaction(()=>{
  const row=get(id,business.id);
  if(row.status==='cancelled')return row;
  if(Date.parse(row.end_time)<=Date.now())fail(409,'Past appointments cannot be cancelled.');
  if(!['confirmed','pending_worker','cancellation_review'].includes(row.status))fail(409,'This appointment cannot be cancelled in its current state.');
  const children=db.prepare("SELECT * FROM bookings WHERE replaces_booking_id=? AND status NOT IN ('declined','expired','cancelled','failed')").all(id);
  if(children.some(c=>c.status!=='pending_worker'))fail(409,'A calendar change is being processed. Ask your manager to review it.');
  for(const child of children){db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(child.id);lifecycle.enqueue(child.id,'cancelled');}
  db.prepare("UPDATE bookings SET status='cancelling',cancellation_reason=? WHERE id=?").run(reason.trim(),id);
  return row;
 })();
 if(booking.status==='cancelled')return {success:true,status:'cancelled'};
 try{
  if(booking.google_event_id && business.google_calendar_id)await calendar.cancelBookingEvent(booking.google_event_id,business);
  db.transaction(()=>{db.prepare("UPDATE bookings SET status='cancelled',responded_at=? WHERE id=?").run(new Date().toISOString(),id);lifecycle.enqueue(id,'cancelled');})();
  return {success:true,status:'cancelled'};
 }catch(error){db.transaction(()=>{db.prepare("UPDATE bookings SET status='cancellation_review' WHERE id=?").run(id);lifecycle.enqueue(id,'cancellation_review');})();fail(503,'Calendar cancellation needs review. The time remains held until your manager resolves it.');}
}
async function reschedule(business,id,input,actorUid){
 const old=get(id,business.id);
 if(typeof input.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId))fail(400,'A request ID is required.');
 const requester=actorUid||'customer:'+old.id;
 const existing=db.prepare('SELECT * FROM bookings WHERE business_id=? AND created_by_uid=? AND manual_request_id=?').get(business.id,requester,input.requestId);
 if(existing){
  if(existing.replaces_booking_id!==old.id || Date.parse(existing.start_time)!==require('./workerBooking.service').instant(input.startDateTime) || existing.worker_uid!==(input.workerUid||old.worker_uid) || (existing.service_id||null)!==(input.serviceId||old.service_id||null))fail(409,'That request ID already belongs to a different change.');
  return require('./workerBooking.service').resultFor(existing);
 }
 if(old.status!=='confirmed')fail(409,'Only confirmed appointments can be rescheduled. Cancel a pending request and book again.');
 if(Date.parse(old.end_time)<=Date.now())fail(409,'Past appointments cannot be rescheduled.');
 const serviceId=input.serviceId||old.service_id;
 const duration=old.service_duration_minutes||Math.round((Date.parse(old.end_time)-Date.parse(old.start_time))/60000);
 const start=require('./workerBooking.service').instant(input.startDateTime);
 if(start<=Date.now())fail(422,'Choose a new appointment time in the future.');
 const workerUid=input.workerUid||old.worker_uid;
 // A customer token is sufficient only for this appointment's own details.
 const body={customerName:old.customer_name,customerEmail:old.customer_email,customerPhone:old.customer_phone,notes:old.notes,
  workerUid,serviceId,startDateTime:new Date(start).toISOString(),endDateTime:new Date(start+duration*60000).toISOString()};
 return require('./workerBooking.service').create(business,body,actorUid?'app':'customer',{manual:true,actorUid:requester,requestId:input.requestId,replacesBookingId:old.id,excludeGoogleEventId:old.google_event_id});
}
async function reconcile(business,id){
 const row=get(id,business.id);
 const child=db.prepare("SELECT id FROM bookings WHERE replaces_booking_id=? AND status IN ('calendar_review','pending_calendar') ORDER BY id DESC LIMIT 1").get(row.id);
 if(child)return reconcile(business,child.id);
 if(['pending_calendar','cancelling'].includes(row.status)&&Date.parse(row.responded_at||row.created_at.replace(' ','T')+'Z')>Date.now()-120000)fail(409,'This calendar operation may still be running. Wait two minutes before retrying.');
 if(row.status==='cancellation_review'||row.status==='cancelling'){
  if(row.status==='cancelling')db.prepare("UPDATE bookings SET status='cancellation_review' WHERE id=?").run(id);
  return cancel(business,id,row.cancellation_reason||'');
 }
 if(!['calendar_review','pending_calendar'].includes(row.status))fail(409,'This appointment does not need calendar review.');
 // Existing Google events have deterministic IDs. A retry can find the original
 // event instead of creating another event after a timed-out insert.
 db.prepare("UPDATE bookings SET status='pending_calendar',responded_at=? WHERE id=?").run(new Date().toISOString(),row.id);
 try{
 const event=await calendar.findBookingEvent(business,row.id,row.google_event_id);
 if(event && (event.status==='cancelled'||!event.start||!event.end||require('./workerAvailability.service').utc(event.start.dateTime)!==Date.parse(row.start_time)||require('./workerAvailability.service').utc(event.end.dateTime)!==Date.parse(row.end_time)||event.extendedProperties?.private?.workerUid!==row.worker_uid))fail(409,'The calendar event does not match this appointment. Resolve the event manually before retrying.');
 return await lifecycle.confirmReserved(business,{...row,google_event_id:event?.id||null,reconciling:true});
 }catch(error){db.prepare("UPDATE bookings SET status='calendar_review' WHERE id=? AND status='pending_calendar'").run(row.id);throw error;}
}
module.exports={get,cancel,reschedule,reconcile};
