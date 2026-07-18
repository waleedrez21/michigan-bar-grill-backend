const express = require("express");
const rateLimit = require("express-rate-limit");
const resolveBusiness = require("../middleware/resolveBusiness");
const { postMessage } = require("../controllers/chat.controller");

const router = express.Router();

// Chat hits the DeepSeek API, so keep it reasonably rate-limited per IP.
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

router.post("/", resolveBusiness, chatLimiter, postMessage);

module.exports = router;
