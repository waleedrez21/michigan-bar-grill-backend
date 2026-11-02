const db=require('../db/db');
const calendar=require('./googleCalendar.service');
function fail(message,status=400){const e=new Error(message);e.status=status;e.publicMessage=message;throw e;}
function utc(value){
 if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) fail('Enter a valid date and time.');
 const date=new Date(value.slice(0,10)+'T12:00:00Z');
 const parts=value.slice(11).match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
 if(!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value.slice(0,10) || +parts[1]>23 || +parts[2]>59 || +(parts[3]||0)>59) fail('Enter a valid date and time.');
 const result=calendar.toUtcDate(value,calendar.BUSINESS_TIMEZONE).getTime();
 if(!Number.isFinite(result)) fail('Enter a valid date and time.');
 return result;
}
const empty=()=>Array.from({length:7},(_,weekday)=>({weekday,intervals:[]}));
function get(businessId,uid){
 const row=db.prepare('SELECT * FROM worker_availability WHERE business_id=? AND uid=?').get(businessId,uid);
 return {weekly:row?JSON.parse(row.weekly_json):empty(),timeOff:row?JSON.parse(row.time_off_json):[],timeZone:calendar.BUSINESS_TIMEZONE};
}
function minutes(text){if(typeof text!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) fail('Hours must use HH:mm (00:00–23:59).');return +text.slice(0,2)*60 + +text.slice(3);}
function normalize(input){
 if(!Array.isArray(input.weekly) || input.weekly.length!==7 || !Array.isArray(input.timeOff) || input.timeOff.length>100) fail('Provide seven weekdays and at most 100 time-off blocks.');
 const seen=new Set();
 const weekly=input.weekly.map(day=>{
  if(!day || !Number.isInteger(day.weekday)||day.weekday<0||day.weekday>6||seen.has(day.weekday)||!Array.isArray(day.intervals)||day.intervals.length>6) fail('Each weekday must appear once with at most six working intervals.');
  seen.add(day.weekday);
  const intervals=day.intervals.map(i=>{if(!i||typeof i!=='object'||minutes(i.end)<=minutes(i.start))fail('A working interval must end after it starts.');return {start:i.start,end:i.end};}).sort((a,b)=>minutes(a.start)-minutes(b.start));
  for(let i=1;i<intervals.length;i++)if(minutes(intervals[i].start)<minutes(intervals[i-1].end))fail('Working intervals cannot overlap.');
  return {weekday:day.weekday,intervals};
 }).sort((a,b)=>a.weekday-b.weekday);
 const timeOff=input.timeOff.map(block=>{
  if(!block || typeof block!=='object')fail('Enter a valid time-off block.');
  const from=utc(block.start),to=utc(block.end);
  if(to<=from)fail('Time off must end after it starts.');
  if(block.note!=null && (typeof block.note!=='string'||block.note.length>160))fail('Time-off notes must be at most 160 characters.');
  return {start:new Date(from).toISOString(),end:new Date(to).toISOString(),note:block.note||''};
 });
 return {weekly,timeOff};
}
function localParts(time){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:calendar.BUSINESS_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time)).reduce((a,p)=>{a[p.type]=p.value;return a;},{});
 const date=`${p.year}-${p.month}-${p.day}`;
 return {date,weekday:new Date(date+'T12:00:00Z').getUTCDay(),minute:+p.hour*60 + +p.minute + +p.second/60 + (time%1000)/60000};
}
function covers(schedule,from,to){
 const a=localParts(from),b=localParts(to);
 if(a.date!==b.date||to<=from)return false;
 const intervals=schedule.weekly.find(d=>d.weekday===a.weekday)?.intervals||[];
 let covered=a.minute;
 for(const i of intervals){const start=minutes(i.start),end=minutes(i.end);if(start<=covered&&end>covered)covered=end;}
 if(covered<b.minute)return false;
 return !schedule.timeOff.some(block=>utc(block.start)<to&&utc(block.end)>from);
}
function available(businessId,uid,from,to){return covers(get(businessId,uid),from,to);}
function save(businessId,uid,input){
 const schedule=normalize(input);
 db.transaction(()=>{
  const rows=db.prepare("SELECT id,start_time,end_time,status,response_deadline FROM bookings WHERE business_id=? AND worker_uid=? AND status IN ('confirmed','pending_worker','pending_calendar','calendar_review','cancellation_review','cancelling','rescheduling')").all(businessId,uid);
  const conflict=rows.find(row=>utc(row.end_time)>Date.now() && !(row.status==='pending_worker'&&Date.parse(row.response_deadline)<=Date.now()) && !covers(schedule,utc(row.start_time),utc(row.end_time)));
  if(conflict)fail(`This change conflicts with appointment #${conflict.id}. Resolve that appointment before changing these hours.`,409);
  db.prepare(`INSERT INTO worker_availability(business_id,uid,weekly_json,time_off_json) VALUES(?,?,?,?)
   ON CONFLICT(business_id,uid) DO UPDATE SET weekly_json=excluded.weekly_json,time_off_json=excluded.time_off_json`).run(businessId,uid,JSON.stringify(schedule.weekly),JSON.stringify(schedule.timeOff));
 })();
 return {...schedule,timeZone:calendar.BUSINESS_TIMEZONE};
}
module.exports={get,save,available,covers,utc};
