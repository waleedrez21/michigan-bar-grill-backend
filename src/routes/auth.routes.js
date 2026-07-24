const express = require("express");
const { postResetPassword } = require("../controllers/auth.controller");

const router = express.Router();

router.post("/reset-password", postResetPassword);

module.exports = router;
