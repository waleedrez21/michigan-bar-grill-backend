const express = require("express");
const { postSend, postConfirm } = require("../controllers/verification.controller");

const router = express.Router();
const rateLimit = require('express-rate-limit');
router.use(rateLimit({windowMs: 15*60*1000, max: 30, standardHeaders: true, legacyHeaders: false}));

// No resolveBusiness middleware — verification happens before signup,
// before any API key exists for this person.
router.post("/send", postSend);
router.post("/confirm", postConfirm);

module.exports = router;
