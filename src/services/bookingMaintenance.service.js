const db=require('../db/db');
const lifecycle=require('./bookingLifecycle.service');
const firebase=require('./firebaseAdmin.service');
const email=require('./email.service');
let running=false;
async function run(){
 if(running)return;running=true;
 try{
  lifecycle.expire();
  const notifications=db.prepare(`SELECT n.*,b.customer_email,b.customer_name,b.worker_uid,b.worker_name,b.start_time,b.status,b.status_token,b.response_deadline,
   businesses.name AS business_name FROM booking_notifications n JOIN bookings b ON b.id=n.booking_id JOIN businesses ON businesses.id=b.business_id
   WHERE n.sent_at IS NULL AND (n.next_attempt_at IS NULL OR n.next_attempt_at<=?) ORDER BY n.id LIMIT 25`).all(new Date().toISOString());
  for(const n of notifications){
   if((n.event==='requested' && n.status!=='pending_worker') || (n.event!=='requested' && n.event!==n.status)){
    db.prepare('UPDATE booking_notifications SET sent_at=? WHERE id=?').run(new Date().toISOString(),n.id);continue;
   }
   let sent=false;
   try{
    const to=n.recipient==='worker'?await firebase.userEmail(n.worker_uid):n.customer_email;
    const date=new Date(n.start_time).toLocaleString('en-CA',{timeZone:'America/Toronto'});
    const base=process.env.PUBLIC_API_URL || (process.env.RAILWAY_PUBLIC_DOMAIN?`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`:'https://michigan-bar-grill-backend-production.up.railway.app');
    const link=`${base.replace(/\/$/,'')}/api/bookings/status/${n.status_token}?view=page`;
    const statusText={requested:'Awaiting worker confirmation — this appointment is not confirmed.',confirmed:'Your appointment is confirmed.',declined:'The worker declined this request. Please choose another time or worker. No alternative was assigned.',expired:'The worker did not accept before the deadline. This request expired; please book again.',calendar_review:'Calendar confirmation needs review. Your appointment is not confirmed. Please contact the business.'}[n.event];
    const worker=n.recipient==='worker';
    const text=worker?`New appointment request at ${n.business_name}\nCustomer: ${n.customer_name}\nWhen: ${date} (America/Toronto)\nRespond in WorkBay > My bookings before ${n.response_deadline}.\nReference #${n.booking_id}`:
      `${n.business_name}\n${statusText}${n.event==='requested'?'\nResponse deadline: '+new Date(n.response_deadline).toLocaleString('en-CA',{timeZone:'America/Toronto'})+' (America/Toronto)':''}\nWorker: ${n.worker_name}\nWhen: ${date} (America/Toronto)\nTrack status: ${link}\nReference #${n.booking_id}`;
    sent=(await email.sendBookingUpdate({to,subject:worker?'New appointment request — action needed':`Appointment ${n.event==='requested'?'request received':n.event} — ${n.business_name}`,text,idempotencyKey:`booking-${n.booking_id}-${n.event}-${n.recipient}`})).sent;
   }catch(error){console.error('[booking-notification] Delivery deferred for notification',n.id);}
   if(sent)db.prepare('UPDATE booking_notifications SET sent_at=? WHERE id=?').run(new Date().toISOString(),n.id);
   else db.prepare('UPDATE booking_notifications SET attempts=attempts+1,next_attempt_at=? WHERE id=?').run(new Date(Date.now()+Math.min(3600000,60000*2**Math.min(n.attempts,6))).toISOString(),n.id);
  }
 }finally{running=false;}
}
function start(){
 const tick=()=>run().catch(error=>console.error('[booking-maintenance] Retry on next tick:',error.message));
 tick();const timer=setInterval(tick,30000);timer.unref();return timer;
}
module.exports={run,start};
