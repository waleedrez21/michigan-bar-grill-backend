const express = require("express");
const resolveBusiness = require("../middleware/resolveBusiness");
const { getAvailability, createBooking, listBookings, listWorkers } = require("../controllers/booking.controller");

const router = express.Router();

// A cryptographically random status token is required; this response never
// exposes customer contact details or a business API key.
router.get('/status/:token',(req,res,next)=>{
  try {
    const lifecycle=require('../services/bookingLifecycle.service');
    lifecycle.expire();
    const status=lifecycle.publicStatus(req.params.token);
    res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');
    if(req.query.view!=='page')return res.json(status);
    const escape=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const labels={pending_worker:'Awaiting worker confirmation',confirmed:'Confirmed',declined:'Declined — please choose another time',expired:'Request expired — please book again',calendar_review:'Calendar confirmation needs review',pending_calendar:'Finalizing calendar confirmation',cancelled:'Cancelled'};
    res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="30"><title>Appointment status</title></head><body style="font:18px system-ui;max-width:560px;margin:60px auto;padding:24px"><h1>Appointment status</h1><h2>${escape(labels[status.status]||status.status)}</h2><p>Worker: ${escape(status.workerName)}</p><p>${escape(new Date(status.start).toLocaleString('en-CA',{timeZone:'America/Toronto'}))} (America/Toronto)</p><p>Reference #${status.id}</p><p>This page refreshes every 30 seconds.</p></body></html>`);
  }catch(error){next(error);}
});
router.use(resolveBusiness);

router.get("/availability", getAvailability);
router.get("/workers", listWorkers);
router.post("/", createBooking);
router.get("/", require("../middleware/firebaseUser"), listBookings); // owner's app schedule screen calls this

module.exports = router;
