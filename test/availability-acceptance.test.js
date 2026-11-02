const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbay-acceptance-'));
process.env.DB_PATH=path.join(directory,'db.sqlite');
const db=require('../src/db/db');
const repo=require('../src/db/businessesRepo');
const calendar=require('../src/services/googleCalendar.service');
let events=0;
calendar.isWorkerSlotFree=async()=>true;
calendar.createBookingEvent=async()=>{events++;return {id:'google-'+events};};
const firebase=require('../src/services/firebaseAdmin.service');
firebase.verifyIdToken=async uid=>({uid});firebase.userEmail=async uid=>uid+'@example.test';
const email=require('../src/services/email.service');
const deliveries=[];
email.sendBookingUpdate=async message=>{deliveries.push(message);return {sent:true};};
const hours=require('../src/services/workerAvailability.service');
const bookings=require('../src/services/workerBooking.service');
const lifecycle=require('../src/services/bookingLifecycle.service');
const maintenance=require('../src/services/bookingMaintenance.service');
const express=require('express');const app=express();app.use(express.json());
app.use('/api/bookings',require('../src/routes/booking.routes'));
app.use('/api',require('../src/routes/team.routes'));app.use(require('../src/middleware/errorHandler'));
const weekly=()=>Array.from({length:7},(_,weekday)=>({weekday,intervals:weekday===2?[{start:'09:00',end:'12:00'},{start:'13:00',end:'17:00'}]:[]}));
const schedule=()=>({weekly:weekly(),timeOff:[{start:'2030-11-05T14:00:00',end:'2030-11-05T15:00:00',note:'Appointment'}]});
const request=(hour=10)=>({customerName:'Client',customerEmail:'client@example.test',workerUid:'worker',startDateTime:`2030-11-05T${hour}:00:00`,endDateTime:`2030-11-05T${hour+1}:00:00`});
test('saved availability, pending holds, assigned-worker decisions, expiry and status emails',async()=>{
 const b=repo.create({id:'shop',name:'Shop',apiKey:'key',googleCalendarId:'calendar',restaurantInfo:{},businessType:'Barbershop',code:'SHOP'});
 for(const [uid,role] of [['worker','employee'],['manager','manager'],['other','employee']]){
  db.prepare('INSERT INTO business_members(business_id,uid,role,accepts_bookings) VALUES(?,?,?,1)').run(b.id,uid,role);
  db.prepare('INSERT INTO user_profiles(uid,first_name,last_name) VALUES(?,?,?)').run(uid,uid,'Smith');
 }
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const http=(route,uid,method='GET',body)=>fetch(base+route,{method,headers:{'Content-Type':'application/json','X-API-Key':'key',...(uid?{Authorization:'Bearer '+uid}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  await assert.rejects(bookings.create(b,request()),e=>e.status===409); // no saved hours
  assert.equal((await http('/api/team/shop/me/availability','outsider')).status,403);
  const save=await http('/api/team/shop/me/availability','worker','PUT',schedule());assert.equal(save.status,200);
  assert.equal(hours.get(b.id,'worker').weekly[2].intervals.length,2);
  const minute=value=>hours.utc('2030-11-05T'+value+':00');
  assert(hours.available(b.id,'worker',minute('09:00'),minute('12:00')));
  assert(!hours.available(b.id,'worker',minute('11:30'),minute('12:30'))); // lunch
  assert(!hours.available(b.id,'worker',minute('14:00'),minute('15:00'))); // time off
  assert(!hours.available(b.id,'worker',minute('16:00'),minute('17:30')));
  assert(!hours.available(b.id,'worker',hours.utc('2030-11-06T10:00:00'),hours.utc('2030-11-06T11:00:00'))); // day off
  await assert.rejects(bookings.create(b,request(12)),e=>e.status===409);
  await assert.rejects(bookings.create(b,request(14)),e=>e.status===409);
  assert.throws(()=>hours.save(b.id,'worker',{weekly:[null,...weekly().slice(1)],timeOff:[]}),e=>e.status===400);
  const overlap=schedule();overlap.weekly[2].intervals.push({start:'10:00',end:'11:00'});
  assert.throws(()=>hours.save(b.id,'worker',overlap),e=>e.status===400);
  const pending=await bookings.create(b,request());
  assert.equal(pending.status,'pending_worker');assert.equal(events,0);
  assert(Date.parse(pending.responseDeadline)<=Date.now()+120*60000);
  await assert.rejects(bookings.create(b,request()),e=>e.status===409);
  const blocked=schedule();blocked.weekly[2].intervals=[];
  assert.throws(()=>hours.save(b.id,'worker',blocked),e=>e.status===409);
  const status=await (await http('/api/bookings/status/'+pending.statusToken,null)).json();
  assert.equal(status.status,'pending_worker');assert.equal(status.customer_email,undefined);assert.equal(status.customer_name,undefined);
  assert.equal((await http('/api/bookings/status/not-a-token',null)).status,404);
  assert.equal((await http(`/api/team/shop/bookings/${pending.id}/respond`,'manager','POST',{decision:'accept'})).status,404);
  assert.equal((await http(`/api/team/shop/bookings/${pending.id}/respond`,'other','POST',{decision:'accept'})).status,404);
  await maintenance.run();
  assert(deliveries.some(d=>d.to==='worker@example.test'));
  assert(deliveries.some(d=>d.to==='client@example.test'&&d.text.includes('not confirmed')));
  const accepted=await http(`/api/team/shop/bookings/${pending.id}/respond`,'worker','POST',{decision:'accept'});
  assert.equal(accepted.status,200);assert.equal((await accepted.json()).status,'confirmed');assert.equal(events,1);
  assert.equal((await http(`/api/team/shop/bookings/${pending.id}/respond`,'worker','POST',{decision:'decline'})).status,409);
  await maintenance.run();assert(deliveries.some(d=>d.to==='client@example.test'&&d.text.includes('appointment is confirmed')));
  const before=deliveries.length;await maintenance.run();assert.equal(deliveries.length,before);
  const declined=await bookings.create(b,request(11));
  assert.equal((await lifecycle.respond(b,'worker',declined.id,'decline')).status,'declined');
  const retry=await bookings.create(b,request(11)); // slot released
  db.prepare('UPDATE bookings SET response_deadline=? WHERE id=?').run('2000-01-01T00:00:00.000Z',retry.id);
  lifecycle.expire();assert.equal(lifecycle.publicStatus(retry.statusToken).status,'expired');
  await assert.rejects(lifecycle.respond(b,'worker',retry.id,'accept'),e=>e.status===409);
  const replacement=await bookings.create(b,request(11));assert.equal(replacement.status,'pending_worker');
  await lifecycle.respond(b,'worker',replacement.id,'decline');
  const uncertain=await bookings.create(b,request(13));
  calendar.createBookingEvent=async()=>{throw new Error('network timeout');};
  await assert.rejects(lifecycle.respond(b,'worker',uncertain.id,'accept'),e=>e.status===503);
  assert.equal(lifecycle.publicStatus(uncertain.statusToken).status,'calendar_review');
  await assert.rejects(bookings.create(b,request(13)),e=>e.status===409);
  const busy=await bookings.create(b,request(15));calendar.isWorkerSlotFree=async()=>false;
  await assert.rejects(lifecycle.respond(b,'worker',busy.id,'accept'),e=>e.status===409);
  assert.equal(lifecycle.publicStatus(busy.statusToken).status,'declined');
  calendar.isWorkerSlotFree=async()=>true;
  const race=await bookings.create({...b,google_calendar_id:''},request(16));
  const answers=await Promise.allSettled([lifecycle.respond({...b,google_calendar_id:''},'worker',race.id,'accept'),lifecycle.respond({...b,google_calendar_id:''},'worker',race.id,'accept')]);
  assert.equal(answers.filter(a=>a.status==='fulfilled').length,1);
  assert.throws(()=>hours.save(b.id,'worker',blocked),e=>e.status===409); // confirmed commitments stay protected
  email.sendBookingUpdate=async()=>({sent:false});
  await maintenance.run();
  const deferred=db.prepare('SELECT * FROM booking_notifications WHERE sent_at IS NULL AND attempts>0').all();
  assert(deferred.length>0);assert(deferred.every(row=>Date.parse(row.next_attempt_at)>Date.now()));
  email.sendBookingUpdate=async message=>{deliveries.push(message);return {sent:true};};
  db.prepare("UPDATE booking_notifications SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE sent_at IS NULL").run();
  await maintenance.run();
  assert.equal(db.prepare('SELECT count(*) AS n FROM booking_notifications WHERE sent_at IS NULL').get().n,0);
  assert(deliveries.some(d=>d.text.includes('expired')));
  assert(deliveries.some(d=>d.text.includes('declined')));
 }finally{await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(directory,{recursive:true,force:true});}
});
