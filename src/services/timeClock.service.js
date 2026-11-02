const db=require('../db/db');
function get(businessId,uid){const row=db.prepare('SELECT clock_in FROM clock_sessions WHERE business_id=? AND uid=? AND clock_out IS NULL').get(businessId,uid);return {clockIn:row?.clock_in||null};}
function change(businessId,uid,action){
 if(!['in','out'].includes(action)){const e=new Error('Choose clock in or clock out.');e.status=400;e.publicMessage=e.message;throw e;}
 return db.transaction(()=>{
 const now=new Date().toISOString();
 if(action==='in')db.prepare('INSERT OR IGNORE INTO clock_sessions(business_id,uid,clock_in) VALUES(?,?,?)').run(businessId,uid,now);
 else db.prepare('UPDATE clock_sessions SET clock_out=? WHERE business_id=? AND uid=? AND clock_out IS NULL').run(now,businessId,uid);
 return get(businessId,uid);
 })();
}
module.exports={get,change};
