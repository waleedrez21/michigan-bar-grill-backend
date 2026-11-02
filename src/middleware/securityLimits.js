const rateLimit=require('express-rate-limit');
module.exports={
 join:rateLimit({windowMs:15*60*1000,max:20,standardHeaders:true,legacyHeaders:false}),
 publicWrite:rateLimit({windowMs:15*60*1000,max:60,standardHeaders:true,legacyHeaders:false})
};
