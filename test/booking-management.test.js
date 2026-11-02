const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbay-management-'));process.env.DB_PATH=path.join(directory,'db.sqlite');
const db=require('../src/db/db'),repo=require('../src/db/businessesRepo'),hours=require('../src/services/workerAvailability.service');
const calendar=require('../src/services/googleCalendar.service'),life=require('../src/services/bookingLifecycle.service'),change=require('../src/services/bookingChanges.service');
const booking=require('../src/services/workerBooking.service'),catalog=require('../src/services/appointmentCatalog.service'),alerts=require('../src/services/bookingAlerts.service');
const firebase=require('../src/services/firebaseAdmin.service');firebase.verifyIdToken=async uid=>({uid});firebase.legacyMemberships=async()=>[];
calendar.isWorkerSlotFree=async()=>true;calendar.workerBusyBlocks=async()=>[];let deletes=0,inserts=0;
const googleEvents=new Map();
calendar.createBookingEvent=async input=>{inserts++;const event={id:'event-'+input.bookingId,start:{dateTime:input.startISO},end:{dateTime:input.endISO},extendedProperties:{private:{workerUid:input.workerUid}}};googleEvents.set(input.bookingId,event);return event;};
calendar.findBookingEvent=async(b,id)=>googleEvents.get(id)||null;calendar.cancelBookingEvent=async()=>{deletes++;};
const express=require('express'),app=express();app.use(express.json());app.use('/api',require('../src/routes/team.routes'));app.use('/api/bookings',require('../src/routes/booking.routes'));app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.publicMessage||e.message}));
const input=(hour,uid='worker',serviceId)=>({requestId:crypto.randomUUID(),customerName:'Client',customerEmail:'client@example.test',workerUid:uid,startDateTime:`2030-11-05T${hour}:00:00`,endDateTime:`2030-11-05T${hour+1}:00:00`,serviceId});
test('service catalog, customer/staff changes, calendar recovery, manager oversight, reminders and push',async()=>{
 const b=repo.create({id:'shop',name:'Shop',apiKey:'key',googleCalendarId:'calendar',restaurantInfo:{},businessType:'Barbershop',code:'SHOP'});
 repo.create({id:'other-shop',name:'Other',apiKey:'other-key',googleCalendarId:'',restaurantInfo:{},businessType:'Barbershop',code:'OTHER'});
 for(const [uid,role] of [['worker','employee'],['sam','employee'],['manager','manager']]){
  db.prepare('INSERT INTO user_profiles(uid,first_name,last_name) VALUES(?,?,?)').run(uid,uid,'Smith');
  db.prepare('INSERT INTO business_members(business_id,uid,role,accepts_bookings) VALUES(?,?,?,1)').run(b.id,uid,role);
  hours.save(b.id,uid,{weekly:Array.from({length:7},(_,weekday)=>({weekday,intervals:[{start:'09:00',end:'20:00'}]})),timeOff:[]});
 }
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const http=(route,uid='manager',method='GET',body)=>fetch(base+route,{method,headers:{'Content-Type':'application/json','X-API-Key':'key',...(uid?{Authorization:'Bearer '+uid}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const realNow=Date.now;
 try{
  const serviceInput={name:'Haircut',durationMinutes:30,priceCents:2500,currency:'CAD',workerUids:['worker'],active:true};
  assert.equal((await http('/api/team/shop/services','worker','POST',serviceInput)).status,403);
  assert.equal((await http('/api/team/shop/services','manager','POST',{...serviceInput,workerUids:['outsider']})).status,422);
  const created=await http('/api/team/shop/services','manager','POST',serviceInput);assert.equal(created.status,201);const service=await created.json();
  assert.equal((await http('/api/bookings/services',null)).status,200);
  await assert.rejects(booking.create(b,input(10)),e=>e.status===422);
  await assert.rejects(booking.create(b,input(10,'sam',service.id)),e=>e.status===422);
  const pending=await booking.create(b,input(10,'worker',service.id));const pendingRow=change.get(pending.id,b.id);
  assert.equal(Date.parse(pendingRow.end_time)-Date.parse(pendingRow.start_time),30*60000);assert.equal(pendingRow.price_cents,2500);
  catalog.save(b.id,{...serviceInput,priceCents:3000,durationMinutes:45},service.id);
  assert.equal(change.get(pending.id,b.id).price_cents,2500); // snapshots do not change
  const windows=await booking.availability('2030-11-05',b,{serviceId:service.id});
  assert(windows.slots.some(s=>s.label==='9:15 AM'));assert.equal(Date.parse(windows.slots[0].end)-Date.parse(windows.slots[0].start),45*60000);
  await life.respond(b,'worker',pending.id,'accept');
  const moveInput={requestId:crypto.randomUUID(),workerUid:'worker',serviceId:service.id,startDateTime:'2030-11-05T11:00:00'};
  const moved=await change.reschedule(b,pending.id,moveInput);assert.equal(moved.status,'pending_worker');assert.equal(change.get(pending.id,b.id).status,'confirmed');
  await life.respond(b,'worker',moved.id,'decline');assert.equal(life.publicStatus(moved.statusToken).original.status,'confirmed');assert.equal(change.get(pending.id,b.id).status,'confirmed');
  const movedAgain=await change.reschedule(b,pending.id,{...moveInput,requestId:crypto.randomUUID()});
  await life.respond(b,'worker',movedAgain.id,'accept');assert.equal(change.get(pending.id,b.id).status,'cancelled');assert.equal(change.get(movedAgain.id,b.id).status,'confirmed');assert(deletes>0);
  const own=await booking.create(b,input(12,'worker',service.id),'app',{manual:true,actorUid:'worker',requestId:crypto.randomUUID()});
  assert.equal((await http(`/api/team/shop/bookings/${own.id}/cancel`,'sam','POST',{})).status,403);
  assert.equal((await http('/api/bookings/status/not-a-token/cancel',null,'POST',{})).status,404);
  const cancel=await http(`/api/bookings/status/${own.statusToken}/cancel`,null,'POST',{reason:'Customer changed plans'});assert.equal(cancel.status,200);assert.equal(change.get(own.id,b.id).status,'cancelled');
  assert.equal((await change.cancel(b,own.id)).status,'cancelled');
  const bookingPage=await http(`/api/bookings/status/${movedAgain.statusToken}?view=page`,null);assert.match(await bookingPage.text(),/Request a new time/);
  const script=await(await http('/api/bookings/customer.js',null)).text();assert.doesNotThrow(()=>new Function(script));
  assert.equal((await http('/api/team/shop/operations','worker')).status,403);
  const dashboard=await(await http('/api/team/shop/operations')).json();assert(Array.isArray(dashboard.notifications));assert(dashboard.workersWithoutPush.some(w=>w.uid==='worker'));
  // Customer rescheduling is a request; original confirmed booking stays held.
  const customerMove=await http(`/api/bookings/status/${movedAgain.statusToken}/reschedule`,null,'POST',{...moveInput,requestId:crypto.randomUUID(),startDateTime:'2030-11-05T13:00:00'});assert.equal(customerMove.status,200);
  const customerChild=await customerMove.json();assert.equal(customerChild.status,'pending_worker');assert.equal(change.get(movedAgain.id,b.id).status,'confirmed');
  await change.cancel(b,movedAgain.id);assert.equal(change.get(customerChild.id,b.id).status,'cancelled');
  // Calendar insert timeout after creation is reconciled without another event.
  const timed=await booking.create(b,input(14,'worker',service.id));const normalInsert=calendar.createBookingEvent;
  calendar.createBookingEvent=async value=>{await normalInsert(value);throw new Error('timeout');};
  await assert.rejects(life.respond(b,'worker',timed.id,'accept'),e=>e.status===503);const before=inserts;
  calendar.createBookingEvent=normalInsert;
  await change.reconcile(b,timed.id);assert.equal(inserts,before);assert.equal(change.get(timed.id,b.id).status,'confirmed');
  calendar.cancelBookingEvent=async()=>{throw new Error('timeout');};await assert.rejects(change.cancel(b,timed.id),e=>e.status===503);assert.equal(change.get(timed.id,b.id).status,'cancellation_review');
  calendar.cancelBookingEvent=async()=>{deletes++;};await change.reconcile(b,timed.id);assert.equal(change.get(timed.id,b.id).status,'cancelled');
  // Identity-scoped token registration and invalid-token cleanup.
  const token='valid-push-token-123456789';assert.equal((await http('/api/me/push-tokens','worker','POST',{token})).status,200);
  await http('/api/me/push-tokens','sam','DELETE',{token});assert.equal(db.prepare('SELECT uid FROM push_tokens WHERE token=?').get(token).uid,'worker');
  firebase.sendPush=async()=>({sent:true});assert((await alerts.push({worker_uid:'worker',business_id:b.id,booking_id:own.id},'Title','Body')).sent);
  firebase.sendPush=async()=>({invalid:true,sent:false});await alerts.push({worker_uid:'worker',business_id:b.id,booking_id:own.id},'Title','Body');assert.equal(db.prepare('SELECT 1 FROM push_tokens WHERE token=?').get(token),undefined);
  const expiring=await booking.create(b,input(17,'worker',service.id));
  db.prepare("UPDATE bookings SET response_deadline=?,created_at='2000-01-01 00:00:00' WHERE id=?").run(new Date(Date.now()+10*60000).toISOString(),expiring.id);
  alerts.schedule();alerts.schedule();
  assert.equal(db.prepare("SELECT count(*) AS n FROM booking_notifications WHERE booking_id=? AND event='response_reminder'").get(expiring.id).n,2);
  const notification=db.prepare('SELECT id FROM booking_notifications WHERE booking_id=? AND sent_at IS NULL LIMIT 1').get(expiring.id);
  assert.equal((await http(`/api/team/shop/notifications/${notification.id}/retry`,'worker','POST',{})).status,403);
  assert.equal((await http(`/api/team/shop/notifications/${notification.id}/retry`,'manager','POST',{})).status,200);
  assert.equal((await http(`/api/team/shop/bookings/${own.id}`,'sam')).status,403);
  assert.equal((await http(`/api/team/shop/bookings/${own.id}`,'worker')).status,200);
  // Reminder enqueueing is once per appointment/event and excludes cancelled rows.
  const reminder=await booking.create(b,input(16,'worker',service.id),'app',{manual:true,actorUid:'worker',requestId:crypto.randomUUID()});
  Date.now=()=>Date.parse(change.get(reminder.id,b.id).start_time)-23*3600000;alerts.schedule();alerts.schedule();
  assert.equal(db.prepare("SELECT count(*) AS n FROM booking_notifications WHERE booking_id=? AND event='reminder_24h'").get(reminder.id).n,1);
  Date.now=()=>Date.parse(change.get(reminder.id,b.id).start_time)-3600000;alerts.schedule();
  assert.equal(db.prepare("SELECT count(*) AS n FROM booking_notifications WHERE booking_id=? AND event='reminder_2h'").get(reminder.id).n,1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM booking_notifications WHERE booking_id=? AND event LIKE 'reminder_%'").get(own.id).n,0);
 }finally{Date.now=realNow;await new Promise(r=>server.close(r));db.close();fs.rmSync(directory,{recursive:true,force:true});}
});
