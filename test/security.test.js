const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workbay-security-'));
process.env.DB_PATH=path.join(dir,'db.sqlite');process.env.DEEPSEEK_API_KEY='audit-dummy-not-a-real-key';
const db=require('../src/db/db'),repo=require('../src/db/businessesRepo'),firebase=require('../src/services/firebaseAdmin.service'),calendar=require('../src/services/googleCalendar.service');
let deleted=[],verified=[],revoke=[],cleanup=[],failCalendar=false;
firebase.verifyIdToken=async uid=>({uid,email:uid+'@example.test',email_verified:true,auth_time:uid==='stale'?1:Math.floor(Date.now()/1000)});
firebase.markEmailVerified=async uid=>verified.push(uid);
firebase.revokeUser=async uid=>revoke.push(uid);
firebase.deleteUser=async uid=>deleted.push(uid);
firebase.deleteAccountData=async uid=>cleanup.push(uid);
calendar.cancelBookingEvent=async()=>{if(failCalendar)throw Error('offline');};
calendar.redactBookingEvent=async()=>{if(failCalendar)throw Error('offline');};
require('../src/services/email.service').sendVerificationCode=async()=>({sent:true});
let aiCalls=0;require('../src/services/deepseek.service').chat=async(b,history,message)=>{aiCalls++;return {reply:'ok',history:[...history,{role:'user',content:message}]};};
const express=require('express'),app=express();app.use(express.json());
app.use('/api',require('../src/routes/privacy.routes'));app.use('/api',require('../src/routes/team.routes'));
app.use('/api/auth',require('../src/routes/auth.routes'));app.use('/api/verification',require('../src/routes/verification.routes'));
app.use('/api/businesses',require('../src/routes/businesses.routes'));app.use('/api/orders',require('../src/routes/orders.routes'));app.use('/api/chat',require('../src/routes/chat.routes'));
app.use(require('../src/middleware/errorHandler'));
function member(uid,b='shop',role='employee'){
 db.prepare('INSERT OR IGNORE INTO user_profiles(uid,first_name,last_name) VALUES(?,?,?)').run(uid,uid,'Test');
 db.prepare('INSERT OR IGNORE INTO business_members(business_id,uid,role) VALUES(?,?,?)').run(b,uid,role);
}
function booking(email,worker='worker',future=true){return Number(db.prepare("INSERT INTO bookings(business_id,customer_name,customer_email,customer_phone,notes,worker_uid,worker_name,start_time,end_time,google_event_id,created_by_uid) VALUES('shop','Customer',?,'555-0100','private notes',?,'Worker Test',?,?,'google-event',?)").run(email,worker,future?'2032-11-05T10:00:00Z':'2020-11-05T10:00:00Z',future?'2032-11-05T11:00:00Z':'2020-11-05T11:00:00Z',worker).lastInsertRowid);}
test('release security boundaries and resilient privacy cleanup',async()=>{
 repo.create({id:'shop',name:'Shop',apiKey:'public-key',googleCalendarId:'calendar',restaurantInfo:{},businessType:'Barbershop',code:'SHOP'});
 repo.create({id:'other',name:'Other',apiKey:'other-key',googleCalendarId:'',restaurantInfo:{},businessType:'Barbershop',code:'OTHER'});
 member('manager','shop','manager');member('worker');member('other','other','manager');
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const req=(p,uid,method='GET',body,key='public-key')=>fetch(base+'/api'+p,{method,headers:{'Content-Type':'application/json','X-API-Key':key,...(uid?{Authorization:'Bearer '+uid}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  await test('legacy reset is disabled even after email verification',async()=>{
   require('../src/db/verificationRepo').insertCode('worker@example.test');
   db.prepare('UPDATE verification_codes SET verified=1').run();
   assert.equal((await req('/auth/reset-password',null,'POST',{email:'worker@example.test',newPassword:'Attacker123!'})).status,410);
  });
  await test('expired, reused and repeatedly guessed codes are rejected; proof is email-bound',async()=>{
   const verification=require('../src/db/verificationRepo');
   const expired=verification.insertCode('expired@example.test');db.prepare('UPDATE verification_codes SET expires_at=? WHERE email=?').run(new Date(Date.now()-60000).toISOString(),'expired@example.test');
   assert.equal((await req('/verification/confirm',null,'POST',{email:'expired@example.test',code:expired.code})).status,400);
   const item=verification.insertCode('worker@example.test');
   const confirmed=await req('/verification/confirm',null,'POST',{email:'worker@example.test',code:item.code});assert.equal(confirmed.status,200);const proof=(await confirmed.json()).verificationToken;
   assert.equal((await req('/verification/confirm',null,'POST',{email:'worker@example.test',code:item.code})).status,400);
   assert.equal((await req('/me/verify-email','manager','POST',{verificationToken:proof})).status,400);
   assert.equal((await req('/me/verify-email','worker','POST',{verificationToken:proof})).status,200);
   assert.deepEqual(verified,['worker']);
   assert.equal((await req('/me/verify-email','worker','POST',{verificationToken:proof})).status,400);
   verification.insertCode('guess@example.test');for(let n=0;n<5;n++)assert.equal((await req('/verification/confirm',null,'POST',{email:'guess@example.test',code:'wrong'})).status,400);
   assert.equal((await req('/verification/confirm',null,'POST',{email:'guess@example.test',code:'wrong'})).status,429);
  });
  await test('pending member cannot read, approve self, change role, or obtain API key',async()=>{
   const join=await req('/team/join','new','POST',{code:'SHOP',role:'manager'});assert.equal(join.status,202);const body=await join.json();assert.equal(body.pendingApproval,true);assert.equal(body.apiKey,'');
   assert.deepEqual(await (await req('/me/businesses','new')).json(),[]);
   assert.equal((await req('/team/shop/members','new')).status,403);
   assert.equal((await req('/team/shop/join-requests/new','new','POST',{decision:'approve'})).status,403);
   assert.equal((await req('/team/shop/join-requests/new','worker','POST',{decision:'approve'})).status,403);
   assert.equal((await req('/businesses/by-code/SHOP',null)).status,401);
   assert.equal((await req('/businesses/by-code/SHOP','new')).status,403);
   assert.equal((await req('/team/shop/join-requests/new','manager','POST',{decision:'approve'})).status,200);
   assert.equal((await req('/team/shop/members','new')).status,200);
   assert.equal(db.prepare("SELECT role FROM business_members WHERE uid='new'").get().role,'employee');
   assert.equal((await req('/team/shop/join-requests/new','manager','POST',{decision:'approve'})).status,404);
   assert.equal((await req('/team/shop/members/new','manager','DELETE')).status,200);
   assert.equal((await req('/team/shop/members','new')).status,403);
   assert.equal((await req('/team/join','new','POST',{code:'SHOP'})).status,403);
  });
  await test('orders require an approved member of the identified business',async()=>{
   const id=require('../src/db/ordersRepo').insertOrder({businessId:'shop',customerName:'Private',customerEmail:'customer@example.test',items:[],subtotalCents:100,status:'paid'});
   assert.equal((await req('/orders',null)).status,401);
   assert.equal((await req('/orders','other')).status,403);
   assert.equal((await req(`/orders/${id}/complete`,null,'POST',{})).status,401);
   assert.equal((await req(`/orders/${id}/complete`,'other','POST',{})).status,403);
   assert.equal((await req('/orders','worker')).status,200);
   assert.equal((await req(`/orders/${id}/complete`,'worker','POST',{})).status,409);
   assert.equal((await req(`/orders/${id}/accept`,'worker','POST',{})).status,200);
   assert.equal((await req(`/orders/${id}/complete`,'worker','POST',{})).status,200);
  });
  await test('Stripe confirms payment once and only alerts devices in that business',async()=>{
   const orders=require('../src/db/ordersRepo');
   const stripe=require('../src/services/stripe.service');
   const webhook=require('../src/controllers/stripeWebhook.controller').handleStripeWebhook;
   const id=orders.insertOrder({businessId:'shop',stripeSessionId:'test-order-payment',items:[{quantity:1,name:'Steak & Eggs'}],subtotalCents:1799});
   db.prepare("INSERT INTO push_tokens(token,uid,updated_at) VALUES('shop-order-token','manager',CURRENT_TIMESTAMP),('other-order-token','other',CURRENT_TIMESTAMP)").run();
   const originalPush=firebase.sendPush, originalConstruct=stripe.constructWebhookEvent;
   const pushes=[];
   firebase.sendPush=async (...args)=>{pushes.push(args);return {sent:true};};
   const session={id:'test-order-payment',payment_status:'unpaid',currency:'cad',amount_total:1799};
   let type='checkout.session.completed';
   stripe.constructWebhookEvent=()=>({type,data:{object:session}});
   const deliver=()=>webhook({headers:{}},{json:()=>{}},err=>{throw err;});
   try {
    await deliver();
    assert.equal(pushes.length,0);
    session.payment_status='paid';
    type='checkout.session.async_payment_succeeded';
    await Promise.all([deliver(),deliver()]);
    assert.deepEqual(pushes,[['shop-order-token',{title:'WorkBay',body:'New order — $17.99 — 1x Steak & Eggs'},{businessId:'shop',orderId:String(id)}]]);
    assert.equal(orders.transitionOrder(id,'shop','paid','accepted'),200);
    await deliver();
    assert.equal(orders.getByStripeSessionId(session.id).status,'accepted');
    assert.equal(pushes.length,1);
   } finally {
    stripe.constructWebhookEvent=originalConstruct;
    firebase.sendPush=originalPush;
    db.prepare("DELETE FROM push_tokens WHERE token IN ('shop-order-token','other-order-token')").run();
   }
  });
  await test('clock records use server identity/time and tenant scope',async()=>{
   assert.equal((await req('/team/shop/me/clock','new','POST',{action:'in',uid:'manager'})).status,403);
   const first=await (await req('/team/shop/me/clock','worker','POST',{action:'in',uid:'manager',clockIn:'1900'})).json();assert.ok(first.clockIn.startsWith(new Date().getUTCFullYear()+''));
   await req('/team/shop/me/clock','worker','POST',{action:'in'});
   assert.equal(db.prepare("SELECT count(*) AS n FROM clock_sessions WHERE uid='worker'").get().n,1);
   assert.equal((await req('/team/other/me/clock','worker')).status,403);
   await req('/team/shop/me/clock','worker','POST',{action:'out'});
   assert.equal((await (await req('/team/shop/me/clock','worker')).json()).clockIn,null);
  });
  await test('weekly hours are manager-only and clip shifts at Toronto week boundaries',async()=>{
   const route='/team/shop/clock/weekly';
   assert.equal((await req(route,'worker')).status,403);
   assert.equal((await req(route,'other')).status,403);
   assert.equal((await req(route+'?weeksAgo=53','manager')).status,400);
   assert.equal((await req(route,'manager')).status,200);
   const add=db.prepare('INSERT INTO clock_sessions(business_id,uid,clock_in,clock_out) VALUES(?,?,?,?)');
   const shift=add.run('shop','worker','2026-11-02T04:00:00.000Z','2026-11-02T06:30:00.000Z').lastInsertRowid;
   try {
    const report=require('../src/services/timeClock.service').weeklyHours('shop',0,new Date('2026-11-04T18:00:00Z'));
    assert.equal(report.startDate,'2026-11-02');
    assert.equal(report.totalSeconds,5400);
    assert.equal(report.employees.find(employee=>employee.uid==='worker').totalSeconds,5400);
    assert.equal(report.employees.find(employee=>employee.uid==='manager').totalSeconds,0);
   } finally { db.prepare('DELETE FROM clock_sessions WHERE id=?').run(shift); }
  });
  await test('AI requires explicit consent; sessions cannot cross business or account',async()=>{
   assert.equal((await req('/chat',null,'POST',{message:'private'})).status,428);assert.equal(aiCalls,0);
   const response=await req('/chat','worker','POST',{message:'hello',aiConsent:'2026-11-02'});assert.equal(response.status,200);const {sessionId}=await response.json();
   assert.equal((await req('/chat','manager','POST',{message:'continue',sessionId,aiConsent:'2026-11-02'})).status,403);
   assert.equal((await req('/chat','worker','POST',{message:'continue',sessionId,aiConsent:'2026-11-02'},'other-key')).status,403);
   assert.equal(aiCalls,1);
  });
  await test('deletion requires recent sign-in and retries external failures without reporting completed',async()=>{
   assert.equal((await req('/me/account','stale','DELETE')).status,401);
   const future=booking('client@example.test');const past=booking('worker@example.test','worker',false);
   db.prepare("INSERT INTO worker_availability(business_id,uid) VALUES('shop','worker')").run();db.prepare("INSERT INTO push_tokens(token,uid,updated_at) VALUES('test-device','worker',?)").run(new Date().toISOString());
   failCalendar=true;const response=await req('/me/account','worker','DELETE');assert.deepEqual(await response.json(),{success:true,completed:false});
   assert.equal((await req('/me/profile','worker')).status,403);assert.ok(db.prepare("SELECT uid FROM account_deletions WHERE uid='worker'").get());assert.equal(deleted.length,0);
   failCalendar=false;await require('../src/services/accountDeletion.service').retry();
   for(const table of ['user_profiles','business_members','worker_availability','push_tokens','clock_sessions'])assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE uid='worker'`).get().n,0);
   assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(future).status,'cancelled');
   const anonymized=db.prepare('SELECT * FROM bookings WHERE id=?').get(past);assert.equal(anonymized.customer_email,null);assert.equal(anonymized.worker_uid,null);assert.equal(anonymized.notes,null);
   assert.ok(deleted.includes('worker'));assert.ok(cleanup.includes('worker'));assert.ok(revoke.includes('worker'));
   assert.equal(db.prepare("SELECT count(*) AS n FROM chat_sessions WHERE owner_uid='worker'").get().n,0);
   assert.ok(db.prepare("SELECT uid FROM user_profiles WHERE uid='manager'").get());
  });
  await test('customer privacy requests require separate, single-use email proof',async()=>{
   const id=booking('customer@example.test','manager',false),v=require('../src/db/verificationRepo');
   const wrong=v.insertCode('customer@example.test');assert.equal((await req('/privacy/requests',null,'POST',{email:'customer@example.test',code:wrong.code})).status,400);
   const right=v.insertCode('customer@example.test','privacy');const request=await req('/privacy/requests',null,'POST',{email:'customer@example.test',code:right.code});assert.equal(request.status,202);
   assert.equal((await req('/privacy/requests',null,'POST',{email:'customer@example.test',code:right.code})).status,400);
   await require('../src/services/accountDeletion.service').customerRequests();
   assert.equal(db.prepare('SELECT customer_email FROM bookings WHERE id=?').get(id).customer_email,null);
   for(const route of ['/privacy','/terms','/privacy.js','/legal.css'])assert.equal((await req(route,null)).status,200);
  });
 }finally{await new Promise(r=>server.close(r));db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
