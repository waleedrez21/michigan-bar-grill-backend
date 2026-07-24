const express = require("express");
const { postSend, postConfirm } = require("../controllers/verification.controller");

const router = express.Router();

// No resolveBusiness middleware — verification happens before signup,
// before any API key exists for this person.
router.post("/send", postSend);
router.post("/confirm", postConfirm);

module.exports = router;
