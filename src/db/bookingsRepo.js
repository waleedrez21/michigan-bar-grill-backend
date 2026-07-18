const db = require("./db");

function insertBooking({
  businessId,
  googleEventId,
  customerName,
  customerEmail,
  customerPhone,
  partySize,
  startTime,
  endTime,
  notes,
  source = "agent",
}) {
  const stmt = db.prepare(`
    INSERT INTO bookings
      (business_id, google_event_id, customer_name, customer_email, customer_phone, party_size, start_time, end_time, notes, source)
    VALUES (@businessId, @googleEventId, @customerName, @customerEmail, @customerPhone, @partySize, @startTime, @endTime, @notes, @source)
  `);
  const info = stmt.run({
    businessId,
    googleEventId: googleEventId || null,
    customerName,
    customerEmail: customerEmail || null,
    customerPhone: customerPhone || null,
    partySize: partySize || null,
    startTime,
    endTime,
    notes: notes || null,
    source,
  });
  return info.lastInsertRowid;
}

/** Scoped to one business — this is what the owner's app schedule screen calls. */
function listBookings(businessId) {
  return db
    .prepare(`SELECT * FROM bookings WHERE business_id = ? ORDER BY start_time DESC`)
    .all(businessId);
}

function cancelBooking(id, businessId) {
  db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ? AND business_id = ?`).run(id, businessId);
}

module.exports = { insertBooking, listBookings, cancelBooking };
