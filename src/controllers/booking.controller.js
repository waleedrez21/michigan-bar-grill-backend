const calendarService = require("../services/googleCalendar.service");
const bookingsRepo = require("../db/bookingsRepo");
const workerBookings = require("../services/workerBooking.service");
const db = require("../db/db");

async function getAvailability(req, res, next) {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "`date` query param (YYYY-MM-DD) is required." });
    const result = workerBookings.staffBusiness(req.business)
      ? await workerBookings.availability(date, req.business, {workerUid:req.query.workerUid,workerName:req.query.workerName})
      : await calendarService.getAvailabilityForDate(date, req.business);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function createBooking(req, res, next) {
  try {
    const business = req.business;
    if (workerBookings.staffBusiness(business)) {
      return res.status(201).json(await workerBookings.create(business,req.body,'website'));
    }
    const { customerName, customerEmail, customerPhone, partySize, startDateTime, endDateTime, notes } = req.body;

    if (!customerName || !startDateTime || !endDateTime) {
      return res.status(400).json({ error: "customerName, startDateTime, and endDateTime are required." });
    }
    if (!calendarService.isWithinBusinessHours(startDateTime, endDateTime, business)) {
      return res.status(422).json({ error: "Requested time is outside business hours or on a closed day." });
    }
    const free = await calendarService.isSlotFree(startDateTime, endDateTime, business);
    if (!free) {
      return res.status(409).json({ error: "That time is already booked." });
    }

    const event = await calendarService.createBookingEvent({
      business,
      customerName,
      customerEmail,
      customerPhone,
      partySize,
      startISO: startDateTime,
      endISO: endDateTime,
      notes,
    });

    const id = bookingsRepo.insertBooking({
      businessId: business.id,
      googleEventId: event.id,
      customerName,
      customerEmail,
      customerPhone,
      partySize,
      startTime: startDateTime,
      endTime: endDateTime,
      notes,
      source: "manual",
    });

    res.status(201).json({ id, googleEventId: event.id, htmlLink: event.htmlLink });
  } catch (err) {
    next(err);
  }
}

// This is what the owner's app calls for its "Schedule" screen —
// always scoped to req.business, so one business never sees another's bookings.
function listBookings(req, res, next) {
  try {
    const membership = db.prepare('SELECT role FROM business_members WHERE business_id=? AND uid=?').get(req.business.id,req.user.uid);
    if(!membership) return res.status(403).json({error:'You must belong to this business.'});
    const team = req.query.scope === 'team';
    if(team && membership.role !== 'manager' && membership.role !== 'assistant_manager') return res.status(403).json({error:'Only managers can view the team schedule.'});
    if(req.query.workerUid && !(team && ['manager','assistant_manager'].includes(membership.role)) && req.query.workerUid !== req.user.uid) return res.status(403).json({error:'You can only view your own appointments.'});
    let rows=bookingsRepo.listBookings(req.business.id).filter(row=>!['cancelled','failed'].includes(row.status) && (team || row.status === 'confirmed'));
    if(!team) rows=rows.filter(row=>row.worker_uid === req.user.uid);
    else if(req.query.workerUid) rows=rows.filter(row=>row.worker_uid === req.query.workerUid);
    rows.sort((a,b)=>workerBookings.instant(a.start_time)-workerBookings.instant(b.start_time));
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

function listWorkers(req,res,next) {
  try { res.json(workerBookings.workers(req.business.id)); } catch(error) { next(error); }
}
module.exports = { getAvailability, createBooking, listBookings, listWorkers };
