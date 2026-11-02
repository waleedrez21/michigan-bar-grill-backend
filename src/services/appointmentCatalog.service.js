const crypto=require('crypto');
const db=require('../db/db');
function fail(status,message){const e=new Error(message);e.status=status;e.publicMessage=message;throw e;}
function encode(r){return {id:r.id,name:r.name,durationMinutes:r.duration_minutes,priceCents:r.price_cents,currency:r.currency,workerUids:JSON.parse(r.worker_uids_json),active:Boolean(r.active)};}
function list(businessId,includeInactive=false){return db.prepare(`SELECT * FROM appointment_services WHERE business_id=? ${includeInactive?'':'AND active=1'} ORDER BY name COLLATE NOCASE`).all(businessId).map(encode);}
function save(businessId,input,id){
 if(typeof input.name!=='string'||!input.name.trim()||input.name.length>100)fail(400,'Enter a service name (up to 100 characters).');
 if(!Number.isInteger(input.durationMinutes)||input.durationMinutes<5||input.durationMinutes>480)fail(400,'Duration must be 5–480 minutes.');
 if(!Number.isInteger(input.priceCents)||input.priceCents<0||input.priceCents>1000000||!['CAD','USD'].includes(input.currency))fail(400,'Enter a valid price in CAD or USD.');
 if(typeof input.active!=='boolean'||!Array.isArray(input.workerUids)||!input.workerUids.length||input.workerUids.length>100||new Set(input.workerUids).size!==input.workerUids.length)fail(400,'Choose at least one worker, without duplicates.');
 for(const uid of input.workerUids)if(typeof uid!=='string'||!db.prepare('SELECT 1 FROM business_members WHERE business_id=? AND uid=?').get(businessId,uid))fail(422,'Every selected worker must belong to this business.');
 if(id&&!db.prepare('SELECT 1 FROM appointment_services WHERE business_id=? AND id=?').get(businessId,id))fail(404,'Service not found.');
 id=id||crypto.randomUUID();
 db.prepare(`INSERT INTO appointment_services(id,business_id,name,duration_minutes,price_cents,currency,worker_uids_json,active) VALUES(?,?,?,?,?,?,?,?)
 ON CONFLICT(id) DO UPDATE SET name=excluded.name,duration_minutes=excluded.duration_minutes,price_cents=excluded.price_cents,currency=excluded.currency,worker_uids_json=excluded.worker_uids_json,active=excluded.active`).run(id,businessId,input.name.trim(),input.durationMinutes,input.priceCents,input.currency,JSON.stringify(input.workerUids),input.active?1:0);
 return list(businessId,true).find(s=>s.id===id);
}
function selected(businessId,serviceId){
 if(serviceId==null||serviceId===''){
  if(list(businessId).length)fail(422,'Choose a service from this business’s service list.');
  return null;
 }
 const service=list(businessId).find(s=>s.id===serviceId);
 if(!service)fail(422,'This service is no longer available. Choose an active service.');
 return service;
}
module.exports={list,save,selected};
