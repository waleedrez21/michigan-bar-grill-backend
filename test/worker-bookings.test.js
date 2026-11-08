const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbay-workers-'));
process.env.DB_PATH=path.join(directory,'test.sqlite');
process.env.DEEPSEEK_API_KEY='test-unused';
const db=require('../src/db/db');
const businesses=require('../src/db/businessesRepo');
const calendar=require('../src/services/googleCalendar.service');
calendar.isWorkerSlotFree=async()=>true;
calendar.workerBusyBlocks=async()=>[];
calendar.createBookingEvent=async()=>{await new Promise(resolve=>setTimeout(resolve,10));return {id:'event-'+Math.random(),htmlLink:'https://example.test/event'};};
require('../src/services/firebaseAdmin.service').verifyIdToken=async uid=>({uid});
const service=require('../src/services/workerBooking.service');
const lifecycle=require('../src/services/bookingLifecycle.service');
const hours=require('../src/services/workerAvailability.service');
const {runTool}=require('../src/services/deepseek.service');
const express=require('express');
const app=express();app.use(express.json());
app.use('/api/bookings',require('../src/routes/booking.routes'));
app.use('/api/team-admin',require('../src/routes/team.routes'));
app.use(require('../src/middleware/errorHandler'));
function business(id){return businesses.create({id,name:id,apiKey:id,googleCalendarId:'calendar',restaurantInfo:{},businessType:'Barbershop',code:id});}
function worker(b,uid,first,last,role='employee',enabled=1){
 db.prepare('INSERT OR IGNORE INTO user_profiles (uid,first_name,last_name) VALUES (?,?,?)').run(uid,first,last);
 db.prepare('INSERT INTO business_members (business_id,uid,role,accepts_bookings) VALUES (?,?,?,?)').run(b.id,uid,role,enabled);
 hours.save(b.id,uid,{weekly:Array.from({length:7},(_,weekday)=>({weekday,intervals:[{start:'09:00',end:'20:00'}]})),timeOff:[]});
}
const input=(hour=10,other={})=>({customerName:'Customer',customerEmail:'customer@example.test',customerPhone:'5551234567',startDateTime:`2030-11-05T${hour}:00:00`,endDateTime:`2030-11-05T${hour+1}:00:00`,...other});
test('worker-specific bookings, conflicts, automatic assignment, assistant tools and authorization',async()=>{
 const b=business('shop'),other=business('other');
 worker(b,'alex','Alex','Smith');worker(b,'sam','Sam','Lee');worker(b,'manager','Boss','Owner','manager',0);
 worker(other,'other-worker','Other','Worker');
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const req=(route,uid,method='GET',body)=>fetch(base+route,{method,headers:{'Content-Type':'application/json','X-API-Key':'shop',...(uid?{Authorization:`Bearer ${uid}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal(calendar.eventBlocksWorker({extendedProperties:{private:{workerUid:'alex'}}},'sam'),false);
  assert.equal(calendar.eventBlocksWorker({extendedProperties:{private:{workerUid:'alex'}}},'alex'),true);
  assert.equal(calendar.eventBlocksWorker({},'sam'),true);
  assert.equal(calendar.eventBlocksWorker({status:'cancelled'},'sam'),false);
  assert.equal(calendar.eventBlocksWorker({transparency:'transparent'},'sam'),false);
  assert.deepEqual(service.workers(b.id).map(w=>w.uid),['alex','sam']);
  const first=await runTool('create_booking',input(10,{workerUid:'alex',workerName:'Alex'}),b);
  assert.equal(first.success,true);assert.equal(first.workerUid,'alex');assert.equal(first.workerName,'Alex Smith');
  const conflict=await runTool('create_booking',input(10,{workerName:'Alex Smith'}),b);
  assert.equal(conflict.success,false);assert.match(conflict.error,/unavailable/);
  // A different worker can accept the exact same time.
  const automatic=await service.create(b,input(10));assert.equal(automatic.workerUid,'sam');
  await assert.rejects(service.create(b,input(10)),e=>e.status===409);
  await assert.rejects(service.create(b,input(11,{workerUid:'other-worker'})),e=>e.status===422);
  await assert.rejects(service.create(b,input(11,{workerUid:'sam',workerName:'Alex Smith'})),e=>e.status===422);
  // Adjacent is free; partial overlaps and long windows are rejected.
  await assert.rejects(service.create(b,input(10,{workerUid:'alex',startDateTime:'2030-11-05T10:30:00',endDateTime:'2030-11-05T11:30:00'})),e=>e.status===409);
  const adjacent=await service.create(b,input(11,{workerUid:'alex'}));assert.equal(adjacent.workerUid,'alex');
  await assert.rejects(service.create(b,input(11,{workerUid:'alex',endDateTime:'2030-11-05T10:00:00'})),e=>e.status===422);
  await assert.rejects(service.create(b,input(11,{workerUid:'alex',startDateTime:'2026-02-30T11:00:00'})),e=>e.status===400);
  // Equivalent offset timestamps still conflict with the local appointment.
  await assert.rejects(service.create(b,input(10,{workerUid:'alex',startDateTime:'2030-11-05T15:00:00Z',endDateTime:'2030-11-05T16:00:00Z'})),e=>e.status===409);
  const available=await service.availability('2030-11-05',b,{workerUid:'sam'});
  assert.equal(available.slots.find(s=>s.label==='10:00 AM').free,false);
  assert.equal(available.slots.find(s=>s.label==='11:00 AM').free,true);
  await assert.rejects(service.availability('2026-02-30',b),e=>e.status===400);
  // Two concurrent requests cannot reserve the same worker.
  const race=await Promise.allSettled([service.create(b,input(13,{workerUid:'alex'})),service.create(b,input(13,{workerUid:'alex'}))]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  const parallel=await Promise.all([service.create(b,input(14,{workerUid:'alex'})),service.create(b,input(14,{workerUid:'sam'}))]);
  assert.equal(parallel.length,2);
  worker(b,'alex2','Alex','Jones');
  await assert.rejects(service.create(b,input(15,{workerName:'Alex'})),e=>e.status===422 && /More than one/.test(e.message));
  // Unauthenticated/shared-key clients cannot retrieve customer schedules.
  assert.equal((await req('/api/bookings',null)).status,401);
  assert.equal((await req('/api/bookings','outsider')).status,403);
  assert.equal((await req('/api/bookings?scope=team','sam')).status,403);
  assert.equal((await req('/api/bookings?workerUid=alex','sam')).status,403);
  const mine=await (await req('/api/bookings','sam')).json();assert(mine.length>0);assert(mine.every(row=>row.worker_uid==='sam'));
  const team=await (await req('/api/bookings?scope=team','manager')).json();assert(team.some(row=>row.worker_uid==='alex'));assert(team.some(row=>row.worker_uid==='sam'));
  const publicWorkers=await (await req('/api/bookings/workers',null)).json();assert(publicWorkers.every(row=>Object.keys(row).sort().join(',')==='name,uid'));
  // Managers configure who takes appointments; employees cannot self-enable.
  assert.equal((await req('/api/team-admin/team/shop/members/manager/booking-settings','alex','PATCH',{acceptsBookings:true})).status,403);
  assert.equal((await req('/api/team-admin/team/shop/members/manager/booking-settings','manager','PATCH',{acceptsBookings:true})).status,200);
  assert(service.workers(b.id).some(w=>w.uid==='manager'));
  assert.equal((await req('/api/team-admin/team/shop/members/manager/booking-settings','manager','PATCH',{acceptsBookings:false})).status,200);
  // Public website creation shares the same assignment service.
  const web=await req('/api/bookings',null,'POST',input(15,{workerUid:'sam'}));assert.equal(web.status,201);assert.equal((await web.json()).workerUid,'sam');
  const restaurant = business('michigan-bar-grill');
  worker(restaurant, 'restaurant-worker', 'Restaurant', 'Worker');
  const reservations = require('../src/db/bookingsRepo');
  const shared = reservations.insertBooking({
    businessId: restaurant.id, customerName: 'Banquet guest', customerEmail: 'private@example.test',
    customerPhone: '5551234567', notes: 'Window table',
    partySize: 12, startTime: '2030-11-06T18:00:00Z', endTime: '2030-11-06T20:00:00Z',
  });
  const restaurantRequest = uid => fetch(base + '/api/bookings?scope=mine', {
    headers: { 'X-API-Key': restaurant.id, Authorization: 'Bearer ' + uid },
  });
  const restaurantResponse = await restaurantRequest('restaurant-worker');
  assert.equal(restaurantResponse.status, 200);
  const [reservation] = await restaurantResponse.json();
  assert.equal(reservation.id, Number(shared));
  assert.equal(reservation.party_size, 12);
  assert.equal(reservation.customer_email, 'private@example.test');
  assert.equal(reservation.customer_phone, '5551234567');
  assert.equal(reservation.notes, 'Window table');
  assert.equal((await restaurantRequest('sam')).status, 403);

  // Calendar uncertainty is never confirmed and still blocks the interval.
  calendar.createBookingEvent=async()=>{throw new Error('Calendar timeout');};
  const waiting=await service.create(b,input(16,{workerUid:'sam'}));
  assert.equal(waiting.status,'pending_worker');
  await assert.rejects(lifecycle.respond(b,'sam',waiting.id,'accept'),e=>e.status===503);
  assert.equal(db.prepare("SELECT status FROM bookings WHERE worker_uid='sam' AND start_time='2030-11-05T21:00:00.000Z'").get().status,'calendar_review');
  await assert.rejects(service.create(b,input(16,{workerUid:'sam'})),e=>e.status===409);
  // Unlinked shops still receive real, assigned app bookings.
  const unlinked={...b,google_calendar_id:''};
  assert.equal((await service.create(unlinked,input(17,{workerUid:'sam'}))).workerUid,'sam');
 }finally{await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(directory,{recursive:true,force:true});}
});
