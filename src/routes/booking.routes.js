const express = require("express");
const resolveBusiness = require("../middleware/resolveBusiness");
const { getAvailability, createBooking, listBookings, listWorkers } = require("../controllers/booking.controller");

const router = express.Router();

router.get('/customer.js',(req,res)=>res.type('application/javascript').send(require('../services/customerBookingPage.service').script()));
function customer(req){const db=require('../db/db');const row=db.prepare('SELECT * FROM bookings WHERE status_token=?').get(req.params.token);if(!row){const e=new Error('Appointment not found.');e.status=404;e.publicMessage=e.message;throw e;}return {row,business:require('../db/businessesRepo').getById(row.business_id)};}
router.get('/status/:token',(req,res,next)=>{
 try{const life=require('../services/bookingLifecycle.service');life.expire();const status=life.publicStatus(req.params.token);res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');if(req.query.view==='page')return res.type('html').send(require('../services/customerBookingPage.service').page());res.json(status);}catch(e){next(e);}
});
router.get('/status/:token/options',async(req,res,next)=>{
 try{const {row,business}=customer(req);const booking=require('../services/workerBooking.service');const services=require('../services/appointmentCatalog.service').list(business.id);const result={services,workers:booking.workers(business.id),availability:{slots:[]}};
 if(req.query.date)result.availability=await booking.availability(req.query.date,business,{workerUid:req.query.workerUid||row.worker_uid,serviceId:req.query.serviceId||row.service_id,excludeBookingId:row.id,excludeGoogleEventId:row.google_event_id});res.set('Cache-Control','no-store');res.json(result);}catch(e){next(e);}
});
router.post('/status/:token/cancel',async(req,res,next)=>{try{const {row,business}=customer(req);res.json(await require('../services/bookingChanges.service').cancel(business,row.id,req.body.reason||''));}catch(e){next(e);}});
router.post('/status/:token/reschedule',async(req,res,next)=>{try{const {row,business}=customer(req);res.json(await require('../services/bookingChanges.service').reschedule(business,row.id,req.body));}catch(e){next(e);}});
router.use(resolveBusiness);

router.get("/availability", getAvailability);
router.get("/workers", listWorkers);
router.get("/services",(req,res)=>res.json(require("../services/appointmentCatalog.service").list(req.business.id)));
router.post("/", createBooking);
router.get("/", require("../middleware/firebaseUser"), listBookings); // owner's app schedule screen calls this

module.exports = router;
