const express = require("express");
const resolveBusiness = require("../middleware/resolveBusiness");
const { getAvailability, createBooking, listBookings, listWorkers } = require("../controllers/booking.controller");

const router = express.Router();

router.use(resolveBusiness);

router.get("/availability", getAvailability);
router.get("/workers", listWorkers);
router.post("/", createBooking);
router.get("/", require("../middleware/firebaseUser"), listBookings); // owner's app schedule screen calls this

module.exports = router;
