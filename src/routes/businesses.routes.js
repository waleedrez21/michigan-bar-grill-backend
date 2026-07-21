const express = require("express");
const { postSignup, getByCode } = require("../controllers/businesses.controller");

const router = express.Router();

// No resolveBusiness middleware here on purpose — these two routes are how
// the app GETS a business/API key in the first place, so they can't require
// one already being set.
router.post("/signup", postSignup);
router.get("/by-code/:code", getByCode);

module.exports = router;
