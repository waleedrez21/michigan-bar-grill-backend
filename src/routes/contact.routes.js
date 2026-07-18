const express = require("express");
const rateLimit = require("express-rate-limit");
const resolveBusiness = require("../middleware/resolveBusiness");
const { postContact } = require("../controllers/contact.controller");

const router = express.Router();
const contactLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.post("/", resolveBusiness, contactLimiter, postContact);

module.exports = router;
