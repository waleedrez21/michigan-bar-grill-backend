const calendarService = require("../services/googleCalendar.service");
const bookingsRepo = require("../db/bookingsRepo");

async function getAvailability(req, res, next) {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "`date` query param (YYYY-MM-DD) is required." });
    const result = await calendarService.getAvailabilityForDate(date, req.business);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function createBooking(req, res, next) {
  try {
    const business = req.business;
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
    res.json(bookingsRepo.listBookings(req.business.id));
  } catch (err) {
    next(err);
  }
}

module.exports = { getAvailability, createBooking, listBookings };
