const db=require('../db/db');
module.exports=function(req,res,next){
 const membership=db.prepare('SELECT role FROM business_members WHERE business_id=? AND uid=?').get(req.business.id,req.user.uid);
 if(!membership)return res.status(403).json({error:'Approved business membership required.'});
 req.membership=membership;next();
};
