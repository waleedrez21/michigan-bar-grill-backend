const express = require("express");
const rateLimit = require("express-rate-limit");
const resolveBusiness = require("../middleware/resolveBusiness");
const { postMessage } = require("../controllers/chat.controller");

const router = express.Router();

// Chat hits the DeepSeek API, so keep it reasonably rate-limited per IP.
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

router.post("/", resolveBusiness, chatLimiter, async(req,res,next)=>{
 if(!req.get('Authorization'))return next();
 return require('../middleware/firebaseUser')(req,res,next);
}, postMessage);

module.exports = router;
