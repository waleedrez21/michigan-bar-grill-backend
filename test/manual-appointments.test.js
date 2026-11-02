const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbay-manual-'));
process.env.DB_PATH=path.join(directory,'database.sqlite');
const db=require('../src/db/db'),repo=require('../src/db/businessesRepo');
const hours=require('../src/services/workerAvailability.service');
const calendar=require('../src/services/googleCalendar.service');
let events=0;calendar.isWorkerSlotFree=async()=>true;calendar.createBookingEvent=async()=>({id:'event-'+(++events)});
require('../src/services/firebaseAdmin.service').verifyIdToken=async uid=>({uid});
const express=require('express'),app=express();app.use(express.json());app.use('/api',require('../src/routes/team.routes'));
app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.publicMessage||error.message}));
const input=(hour,workerUid='worker',other={})=>({requestId:crypto.randomUUID(),customerName:'Walk-in customer',workerUid,startDateTime:`2030-11-05T${hour}:00:00`,endDateTime:`2030-11-05T${hour}:30:00`,...other});
test('manual self bookings, colleague requests, walk-ins, idempotency and authorization',async()=>{
 const business=repo.create({id:'shop',name:'Shop',apiKey:'key',googleCalendarId:'calendar',restaurantInfo:{},businessType:'Barbershop',code:'SHOP'});
 repo.create({id:'other-shop',name:'Other',apiKey:'other',googleCalendarId:'',restaurantInfo:{},businessType:'Barbershop',code:'OTHER'});
 for(const [uid,role] of [['worker','employee'],['other','employee'],['manager','manager'],['assistant','assistant_manager']]){
  db.prepare('INSERT INTO user_profiles(uid,first_name,last_name) VALUES(?,?,?)').run(uid,uid,'Smith');
  db.prepare('INSERT INTO business_members(business_id,uid,role,accepts_bookings) VALUES(?,?,?,1)').run('shop',uid,role);
  hours.save('shop',uid,{weekly:Array.from({length:7},(_,weekday)=>({weekday,intervals:[{start:'09:00',end:'20:00'}]})),timeOff:[]});
 }
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=(body,uid='worker',shop='shop')=>fetch(`${base}/api/team/${shop}/bookings/manual`,{method:'POST',headers:{'Content-Type':'application/json',...(uid?{Authorization:'Bearer '+uid}:{})},body:JSON.stringify(body)});
 const realNow=Date.now;
 try{
  assert.equal((await post(input(10),null)).status,401);
  assert.equal((await post(input(10),'outsider')).status,403);
  assert.equal((await post(input(10),'worker','other-shop')).status,403);
  assert.equal((await post(input(10,'other'),'worker')).status,403);
  assert.equal((await post(input(10,'missing'),'manager')).status,422);
  assert.equal((await post(input(10,'worker',{requestId:'bad'}))).status,400);
  assert.equal((await post(input(10,'worker',{customerEmail:0}))).status,400);
  const ownInput=input(10,'worker',{source:'website',actorUid:'manager'});
  const own=await post(ownInput);assert.equal(own.status,201);
  const saved=await own.json();assert.equal(saved.status,'confirmed');assert.equal(events,1);
  const row=db.prepare('SELECT * FROM bookings WHERE id=?').get(saved.id);
  assert(row.responded_at);assert.equal(row.source,'app');assert.equal(row.created_by_uid,'worker');assert.equal(row.customer_email,null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM booking_notifications WHERE booking_id=?').get(saved.id).n,0);
  const again=await (await post(ownInput)).json();assert.equal(again.id,saved.id);assert.equal(events,1);
  assert.equal((await post({...ownInput,customerName:'Changed customer'})).status,409);
  assert.equal((await post(input(10))).status,409); // no override of occupied slot
  const assigned=await (await post(input(11,'worker'),'manager')).json();assert.equal(assigned.status,'pending_worker');assert.equal(events,1);
  assert.equal(db.prepare('SELECT role FROM business_members WHERE uid=?').get('worker').role,'employee');
  assert.equal(db.prepare("SELECT count(*) AS n FROM booking_notifications WHERE booking_id=? AND recipient='worker'").get(assigned.id).n,1);
  const assistant=await post(input(12,'worker'),'assistant');assert.equal(assistant.status,201);assert.equal((await assistant.json()).status,'pending_worker');
  const retry=input(13);
  const racing=await Promise.all([post(retry),post(retry)]);const values=await Promise.all(racing.map(r=>r.json()));
  assert.equal(values[0].id,values[1].id);assert.equal(db.prepare('SELECT count(*) AS n FROM bookings WHERE manual_request_id=?').get(retry.requestId).n,1);
  // A current walk-in can be entered despite a few minutes of elapsed time.
  Date.now=()=>hours.utc('2030-11-05T15:05:00');
  const walk=await (await post(input(15))).json();assert.equal(walk.status,'confirmed');
  const colleagueWalk=await (await post(input(15,'other'),'manager')).json();assert.equal(colleagueWalk.status,'pending_worker');
  assert(Date.parse(colleagueWalk.responseDeadline)>Date.now());
  assert(Date.parse(colleagueWalk.responseDeadline)<=Date.now()+15*60000);
  assert.equal((await post(input(14))).status,422); // cannot insert old history
  assert.equal((await post(input(20))).status,422); // business closing hours
 }finally{Date.now=realNow;await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(directory,{recursive:true,force:true});}
});
