const db=require('./db');
function owned(sessionId,businessId,uid){
 const row=db.prepare('SELECT * FROM chat_sessions WHERE id=?').get(sessionId);
 if(row&&(row.business_id!==businessId||(row.owner_uid||null)!==(uid||null))){const e=new Error('Conversation unavailable. Start a new conversation.');e.status=403;e.publicMessage=e.message;throw e;}return row;
}
function getHistory(id,businessId,uid){const row=owned(id,businessId,uid);return row?JSON.parse(row.history_json):[];}
function saveHistory(id,businessId,history,uid){owned(id,businessId,uid);db.prepare('INSERT INTO chat_sessions(id,business_id,history_json,owner_uid) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET history_json=excluded.history_json,updated_at=CURRENT_TIMESTAMP WHERE business_id=excluded.business_id AND owner_uid IS excluded.owner_uid').run(id,businessId,JSON.stringify(history),uid||null);}
module.exports={getHistory,saveHistory};
