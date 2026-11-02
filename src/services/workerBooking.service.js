const db = require('../db/db');
const calendar = require('./googleCalendar.service');
const hours=require('./workerAvailability.service');
const lifecycle=require('./bookingLifecycle.service');
const staffBusiness = business => Boolean(business.business_type && business.business_type !== 'Restaurant');
function fail(status, message) { const e = new Error(message);e.status = status;e.publicMessage = message;throw e; }
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) fail(400,'Use a valid ISO date and time.');
  const date=value.slice(0,10), timePart=value.slice(11).match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  const check=new Date(date+'T12:00:00Z');
  if(!Number.isFinite(check.getTime()) || check.toISOString().slice(0,10)!==date || Number(timePart[1])>23 || Number(timePart[2])>59 || Number(timePart[3]||0)>59) fail(400,'Use a valid ISO date and time.');
  const time = calendar.toUtcDate(value, calendar.BUSINESS_TIMEZONE).getTime();
  if (!Number.isFinite(time)) fail(400,'Use a valid ISO date and time.');
  return time;
}
function window(start, end, business) {
  const from = instant(start), to = instant(end);
  const localDay = value => new Intl.DateTimeFormat('en-CA',{timeZone:calendar.BUSINESS_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
  if (to <= from || localDay(from) !== localDay(to)) fail(422,'Choose an end time after the start on the same day.');
  if (!calendar.isWithinBusinessHours(start,end,business)) fail(422,'Requested time is outside business hours or on a closed day.');
  return [from,to];
}
function workers(businessId) {
  return db.prepare(`SELECT m.uid, p.first_name, p.last_name FROM business_members m
    JOIN user_profiles p ON p.uid=m.uid WHERE m.business_id=? AND m.accepts_bookings=1
    AND trim(p.first_name)<>'' AND trim(p.last_name)<>'' ORDER BY p.first_name COLLATE NOCASE, p.last_name COLLATE NOCASE, m.uid`)
    .all(businessId).map(row => ({uid:row.uid,name:`${row.first_name} ${row.last_name}`}));
}
function choosePool(business, {workerUid,workerName} = {}) {
  let pool = workers(business.id);
  if (workerUid != null && (typeof workerUid !== 'string' || !workerUid)) fail(400,'Choose a valid worker.');
  if (workerName != null && typeof workerName !== 'string') fail(400,'Choose a valid worker name.');
  if (workerName) {
    const query = workerName.trim().toLocaleLowerCase();
    pool = pool.filter(w => w.name.toLocaleLowerCase() === query || w.name.split(' ')[0].toLocaleLowerCase() === query);
    if (pool.length > 1) fail(422,'More than one worker has that name. Ask for their full name.');
    if (!pool.length) fail(422,'No worker with that name is taking appointments. Ask the customer to choose from the worker list.');
  }
  if (workerUid) {
    pool = pool.filter(w => w.uid === workerUid);
    if (!pool.length) fail(422,'That worker is not taking appointments at this business, or the requested name does not match.');
  }
  if (!pool.length) fail(422,'No workers are enabled for appointments yet. Please contact the business.');
  return pool;
}
function localFree(businessId, workerUid, from, to) {
  lifecycle.expire();
  if(!hours.available(businessId,workerUid,from,to))return false;
  // Unassigned legacy appointments reserve the entire shop until assigned.
  const rows = db.prepare(`SELECT start_time,end_time FROM bookings WHERE business_id=?
    AND status NOT IN ('cancelled','failed','declined','expired') AND (worker_uid=? OR worker_uid IS NULL)`).all(businessId,workerUid);
  return !rows.some(row => instant(row.start_time) < to && instant(row.end_time) > from);
}
async function availability(date, business, preference = {}) {
  const parsed = new Date(date+'T12:00:00Z');
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date) fail(400,'Use a valid date (YYYY-MM-DD).');
  const pool = choosePool(business,preference);
  const day = new Date(date+'T12:00:00Z').getUTCDay();
  if (day === business.closed_day) return {open:false,reason:'Closed that day',slots:[],workers:pool};
  const slots = [];
  for(let hour=business.open_hour;hour<business.close_hour;hour++) {
    const start = `${date}T${String(hour).padStart(2,'0')}:00:00`;
    const end = `${date}T${String(hour+1).padStart(2,'0')}:00:00`;
    const from=instant(start),to=instant(end);
    const available=[];
    for(const worker of pool) {
      if(localFree(business.id,worker.uid,from,to) && await calendar.isWorkerSlotFree(start,end,business,worker.uid)) available.push(worker);
    }
    slots.push({start:new Date(from).toISOString(),end:new Date(to).toISOString(),label:`${((hour+11)%12)+1}:00 ${hour<12?'AM':'PM'}`,free:available.length>0,workers:available});
  }
  return {open:true,slots,workers:pool};
}
async function create(business, input, source = 'agent', options = {}) {
  const manual=options.manual === true;
  if(manual && (!options.actorUid || !options.requestId))fail(400,'Manual appointments require a signed-in creator and request ID.');
  if((!manual || (input.customerEmail!=null && input.customerEmail!=='')) && (typeof input.customerEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customerEmail) || input.customerEmail.length>254)) fail(400,'An email address is required for appointment status updates.');
  if (typeof input.customerName !== 'string' || !input.customerName.trim()) fail(400,'Customer name is required.');
  const [from,to] = window(input.startDateTime,input.endDateTime,business);
  if((!manual && from<=Date.now()) || (manual && (from<Date.now()-15*60000 || to<=Date.now())))fail(422,'Choose a future appointment or a walk-in starting within the last 15 minutes.');
  const pool = choosePool(business,input);
  // Balance no-preference bookings using assigned appointments on that local day.
  const date = new Intl.DateTimeFormat('en-CA',{timeZone:calendar.BUSINESS_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(from));
  const dayStart=instant(date+'T00:00:00'),dayEnd=instant(date+'T23:59:59');
  const count = uid => db.prepare("SELECT start_time FROM bookings WHERE business_id=? AND worker_uid=? AND status NOT IN ('cancelled','failed','declined','expired')").all(business.id,uid).filter(row => {const t=instant(row.start_time);return t>=dayStart && t<=dayEnd;}).length;
  pool.sort((a,b)=>count(a.uid)-count(b.uid) || a.uid.localeCompare(b.uid));
  for (const worker of pool) {
    if(!localFree(business.id,worker.uid,from,to) || !await calendar.isWorkerSlotFree(input.startDateTime,input.endDateTime,business,worker.uid)) continue;
    // Reserve before awaiting Google; recheck inside the write transaction so
    // simultaneous website requests cannot claim the same worker and window.
    const reservation = db.transaction(() => {
      if(manual){
        const existing=db.prepare('SELECT * FROM bookings WHERE business_id=? AND created_by_uid=? AND manual_request_id=?').get(business.id,options.actorUid,options.requestId);
        if(existing)return {existing};
      }
      const enabled = workers(business.id).some(w=>w.uid===worker.uid);
      if(!enabled || !localFree(business.id,worker.uid,from,to)) return null;
      const start=new Date(from).toISOString();
      const token=lifecycle.token(),deadline=manual && from<=Date.now()?new Date(Math.min(Date.now()+15*60000,to)).toISOString():lifecycle.responseDeadline(start);
      const selfAccepted=manual && worker.uid===options.actorUid;
      const status=selfAccepted?'pending_calendar':'pending_worker';
      const id=Number(db.prepare(`INSERT INTO bookings (business_id,customer_name,customer_email,customer_phone,party_size,start_time,end_time,notes,source,status,worker_uid,worker_name,response_deadline,status_token,created_by_uid,manual_request_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(business.id,input.customerName.trim(),input.customerEmail?.trim()||null,input.customerPhone||null,input.partySize||null,start,new Date(to).toISOString(),input.notes||null,source,status,worker.uid,worker.name,selfAccepted?null:deadline,token,manual?options.actorUid:null,manual?options.requestId:null).lastInsertRowid);
      if(selfAccepted)db.prepare('UPDATE bookings SET responded_at=? WHERE id=?').run(new Date().toISOString(),id);
      else lifecycle.enqueue(id,'requested');
      return {id,token,deadline,selfAccepted};
    })();
    if(!reservation) continue;
    if(reservation.existing)return resultFor(reservation.existing);
    if(reservation.selfAccepted){
      const row=db.prepare('SELECT * FROM bookings WHERE id=?').get(reservation.id);
      await lifecycle.confirmReserved(business,row);
      return resultFor(db.prepare('SELECT * FROM bookings WHERE id=?').get(row.id));
    }
    return {success:true,id:reservation.id,status:'pending_worker',confirmationRequired:true,
      responseDeadline:reservation.deadline,statusToken:reservation.token,workerUid:worker.uid,workerName:worker.name,
      googleEventId:null,htmlLink:null,message:'Request received. This appointment is awaiting worker acceptance and is not confirmed.'};
  }
  fail(409,input.workerUid || input.workerName ? 'That worker is unavailable at that time. Offer another time or ask before choosing another worker.' : 'No worker is available at that time. Please choose another time.');
}
function resultFor(row){
 return {success:true,id:row.id,status:row.status,confirmationRequired:row.status==='pending_worker',responseDeadline:row.response_deadline,statusToken:row.status_token,workerUid:row.worker_uid,workerName:row.worker_name,googleEventId:row.google_event_id,htmlLink:null};
}
module.exports={staffBusiness,workers,availability,create,instant,resultFor};
