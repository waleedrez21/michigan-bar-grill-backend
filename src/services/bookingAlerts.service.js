const db=require('../db/db');
const firebase=require('./firebaseAdmin.service');
function schedule(){
 const now=Date.now(),iso=new Date(now).toISOString();
 const insert=db.prepare('INSERT OR IGNORE INTO booking_notifications(booking_id,event,recipient) VALUES(?,?,?)');
 const confirmed=db.prepare("SELECT id,start_time,customer_email FROM bookings WHERE status='confirmed' AND worker_uid IS NOT NULL AND start_time>? AND start_time<=?").all(iso,new Date(now+24*3600000).toISOString());
 for(const row of confirmed){if(!row.customer_email)continue;const remaining=Date.parse(row.start_time)-now;insert.run(row.id,remaining<=2*3600000?'reminder_2h':'reminder_24h','customer');}
 const pending=db.prepare("SELECT id,created_at FROM bookings WHERE status='pending_worker' AND response_deadline>? AND response_deadline<=?").all(iso,new Date(now+15*60000).toISOString());
 for(const row of pending){if(Date.parse(row.created_at.replace(' ','T')+'Z')>now-60000)continue;insert.run(row.id,'response_reminder','worker');insert.run(row.id,'response_reminder','worker_push');}
}
async function push(n,title,body){
 const tokens=db.prepare('SELECT token FROM push_tokens WHERE uid=?').all(n.worker_uid);
 if(!tokens.length)return {sent:false};
 let allSent=true;
 for(const {token} of tokens){
  const result=await firebase.sendPush(token,{title,body},{businessId:n.business_id,bookingId:String(n.booking_id)});
  if(result.invalid)db.prepare('DELETE FROM push_tokens WHERE token=?').run(token);
  else if(!result.sent)allSent=false;
 }
 return {sent:allSent};
}
module.exports={schedule,push};
