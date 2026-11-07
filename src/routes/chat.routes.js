const express = require("express");
const rateLimit = require("express-rate-limit");
const { resolvePublicBusiness } = require("../middleware/resolveBusiness");
const { postMessage } = require("../controllers/chat.controller");

const router = express.Router();
router.get('/widget',(req,res)=>res.type('html').send(require('../services/chatWidget.service').page()));
router.get('/widget.js',(req,res)=>res.type('js').send(require('../services/chatWidget.service').script()));

// Chat hits the DeepSeek API, so keep it reasonably rate-limited per IP.
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

router.post("/", resolvePublicBusiness, chatLimiter, async(req,res,next)=>{
 if(!req.get('Authorization'))return next();
 return require('../middleware/firebaseUser')(req,res,next);
}, postMessage);

module.exports = router;
