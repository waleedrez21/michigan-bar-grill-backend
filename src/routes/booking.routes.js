const express = require("express");
const resolveBusiness = require("../middleware/resolveBusiness");
const { getAvailability, createBooking, listBookings } = require("../controllers/booking.controller");

const router = express.Router();

router.use(resolveBusiness);

router.get("/availability", getAvailability);
router.post("/", createBooking);
router.get("/", listBookings); // owner's app schedule screen calls this

module.exports = router;
