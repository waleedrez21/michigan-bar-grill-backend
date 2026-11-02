const db=require('../db/db'),lifecycle=require('./bookingLifecycle.service'),firebase=require('./firebaseAdmin.service'),email=require('./email.service'),alerts=require('./bookingAlerts.service');
let running=false;
function current(n){
 if(n.event==='requested'||n.event==='response_reminder')return n.status==='pending_worker';
 if(n.event.startsWith('reminder_')){const remaining=Date.parse(n.start_time)-Date.now();return n.status==='confirmed'&&remaining>0&&(n.event!=='reminder_24h'||remaining>2*3600000);}
 return n.event===n.status;
}
async function run(){
 if(running)return;running=true;
 try{
  lifecycle.expire();alerts.schedule();
  await require('./accountDeletion.service').retry();
  await require('./accountDeletion.service').customerRequests();
  await require('./retention.service').run();
  const rows=db.prepare(`SELECT n.*,b.business_id,b.customer_email,b.customer_name,b.worker_uid,b.worker_name,b.start_time,b.status,b.status_token,b.response_deadline,b.service_name,b.price_cents,b.currency,b.replaces_booking_id,
   businesses.name AS business_name FROM booking_notifications n JOIN bookings b ON b.id=n.booking_id JOIN businesses ON businesses.id=b.business_id
   WHERE n.sent_at IS NULL AND (n.next_attempt_at IS NULL OR n.next_attempt_at<=?) ORDER BY n.id LIMIT 100`).all(new Date().toISOString());
  for(const n of rows){
   if(!current(n)){db.prepare('UPDATE booking_notifications SET sent_at=? WHERE id=?').run(new Date().toISOString(),n.id);continue;}
   let sent=false;
   try{
    const date=new Date(n.start_time).toLocaleString('en-CA',{timeZone:'America/Toronto'});
    const base=process.env.PUBLIC_API_URL||(process.env.RAILWAY_PUBLIC_DOMAIN?`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`:'https://michigan-bar-grill-backend-production.up.railway.app');
    const link=`${base.replace(/\/$/,'')}/api/bookings/status/${n.status_token}?view=page`;
    const messages={requested:'Awaiting worker confirmation — this appointment is not confirmed.',confirmed:'Your appointment is confirmed.',declined:'The worker declined this request. No alternative was assigned.',expired:'This request expired. Please book again.',calendar_review:'Calendar confirmation needs review. Your appointment is not confirmed.',cancellation_review:'Calendar cancellation needs review. The time remains held; contact the business.',cancelled:'This appointment was cancelled. If it was rescheduled, check the replacement appointment.',response_reminder:'Appointment request expires soon. Please accept or decline in WorkBay.',reminder_24h:'Reminder: your confirmed appointment is within 24 hours.',reminder_2h:'Reminder: your confirmed appointment is within two hours.'};
    const text=messages[n.event]||n.event;
    const worker=n.recipient!=='customer';
    const title=n.event==='response_reminder'?'Request expires soon':n.event==='requested'?'New appointment request — action needed':`Appointment ${n.event.replaceAll('_',' ')} — ${n.business_name}`;
    if(n.recipient==='worker_push')sent=(await alerts.push(n,title,`${text} ${date} (America/Toronto). Open WorkBay for details.`)).sent;
    else {
     const to=worker?await firebase.userEmail(n.worker_uid):n.customer_email;
     const service=n.service_name?`\nService: ${n.service_name}${n.price_cents!=null?' — '+n.currency+' '+(n.price_cents/100).toFixed(2):''}`:'';
     const original=n.replaces_booking_id?db.prepare('SELECT status FROM bookings WHERE id=?').get(n.replaces_booking_id):null;
     const originalMessage=original&&['confirmed','rescheduling','calendar_review'].includes(original.status)?'\nThis is a reschedule request; the original appointment remains held until the replacement is accepted or the original is separately cancelled.':'';
     const body=`${n.business_name}\n${text}${worker?'':originalMessage}\n${worker?'Customer: '+n.customer_name:'Worker: '+n.worker_name}\nWhen: ${date} (America/Toronto)${service}\n${worker?'Open WorkBay > Schedule to view or respond.':'Manage appointment: '+link}${n.status==='pending_worker'?'\nResponse deadline: '+new Date(n.response_deadline).toLocaleString('en-CA',{timeZone:'America/Toronto'}):''}\nReference #${n.booking_id}`;
     sent=(await email.sendBookingUpdate({to,subject:title,text:body,idempotencyKey:`booking-${n.booking_id}-${n.event}-${n.recipient}`})).sent;
    }
   }catch(error){console.error('[booking-notification] Delivery deferred:',n.id);}
   if(sent)db.prepare('UPDATE booking_notifications SET sent_at=? WHERE id=?').run(new Date().toISOString(),n.id);
   else db.prepare('UPDATE booking_notifications SET attempts=attempts+1,next_attempt_at=? WHERE id=?').run(new Date(Date.now()+Math.min(3600000,60000*2**Math.min(n.attempts,6))).toISOString(),n.id);
  }
 }finally{running=false;}
}
function start(){const tick=()=>run().catch(error=>console.error('[booking-maintenance]',error.message));tick();const timer=setInterval(tick,30000);timer.unref();return timer;}
module.exports={run,start};
