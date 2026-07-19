const { google } = require("googleapis");

// ---- Mock mode ----------------------------------------------------------
// Set MOCK_CALENDAR=true in .env to bypass real Google Calendar entirely.
// Every slot reports as free, and "creating a booking" just fabricates an
// event ID instead of calling Google. This lets you test the full chat ->
// booking -> SQLite -> app flow before Google Calendar is set up.
// Remove MOCK_CALENDAR from .env (or set it to false) once real Calendar
// credentials are in place — mock mode ignores the real calendar entirely,
// so two people could "book" the same slot without it noticing.
const MOCK_MODE = process.env.MOCK_CALENDAR === "true";
if (MOCK_MODE) {
  console.warn(
    "[googleCalendar] MOCK_CALENDAR=true — using fake availability/bookings, NOT real Google Calendar."
  );
}
// --------------------------------------------------------------------------

function loadCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not set. See .env.example for setup instructions."
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the full service account key as a single line."
    );
  }
}

// One shared service account authenticates for every business — each
// business just needs to share their own calendar with this account's
// email during onboarding (see scripts/createBusiness.js).
let calendarClient = null;
function getCalendarClient() {
  if (calendarClient) return calendarClient;
  const credentials = loadCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  calendarClient = google.calendar({ version: "v3", auth });
  return calendarClient;
}

/**
 * Returns true if the given local datetime range falls within the
 * business's configured hours.
 */
function isWithinBusinessHours(startISO, endISO, business) {
  const start = new Date(startISO);
  const end = new Date(endISO);

  if (start.getDay() === business.closed_day || end.getDay() === business.closed_day) return false;
  if (start.getHours() < business.open_hour) return false;
  if (
    end.getHours() > business.close_hour ||
    (end.getHours() === business.close_hour && end.getMinutes() > 0)
  ) {
    return false;
  }
  return true;
}

/**
 * Check whether a business's calendar is free for the given window.
 */
async function isSlotFree(startISO, endISO, business) {
  if (MOCK_MODE) return true;

  const calendar = getCalendarClient();
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: new Date(startISO).toISOString(),
      timeMax: new Date(endISO).toISOString(),
      items: [{ id: business.google_calendar_id }],
    },
  });
  const busy = res.data.calendars?.[business.google_calendar_id]?.busy || [];
  return busy.length === 0;
}

/**
 * Given a date (YYYY-MM-DD), return 1-hour candidate windows within this
 * business's hours, each flagged free or busy against their calendar.
 */
async function getAvailabilityForDate(dateStr, business) {
  const day = new Date(`${dateStr}T12:00:00`).getDay();
  if (day === business.closed_day) {
    return { open: false, reason: "Closed that day", slots: [] };
  }

  const buildSlots = (busyRanges) => {
    const slots = [];
    for (let hour = business.open_hour; hour < business.close_hour; hour++) {
      const slotStart = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:00:00`);
      const slotEnd = new Date(`${dateStr}T${String(hour + 1).padStart(2, "0")}:00:00`);
      const overlaps = busyRanges.some((b) => slotStart < b.end && slotEnd > b.start);
      slots.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        label: slotStart.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
        free: !overlaps,
      });
    }
    return slots;
  };

  if (MOCK_MODE) {
    return { open: true, slots: buildSlots([]) }; // everything free
  }

  const calendar = getCalendarClient();
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59`);

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      items: [{ id: business.google_calendar_id }],
    },
  });
  const busyRanges = (res.data.calendars?.[business.google_calendar_id]?.busy || []).map((b) => ({
    start: new Date(b.start),
    end: new Date(b.end),
  }));

  return { open: true, slots: buildSlots(busyRanges) };
}

/**
 * Create a confirmed booking on this business's shared Google Calendar.
 * The owner's app reads from the same calendar (via GET /api/bookings,
 * which mirrors this into SQLite too), so it shows up there right away.
 */
async function createBookingEvent({
  business,
  customerName,
  customerEmail,
  customerPhone,
  partySize,
  startISO,
  endISO,
  notes,
}) {
  if (MOCK_MODE) {
    return {
      id: "mock_" + Date.now(),
      htmlLink: "https://calendar.google.com/mock-event-not-real",
    };
  }

  const calendar = getCalendarClient();

  const event = {
    summary: `Booking — ${customerName}`,
    description: [
      `Party size: ${partySize || "n/a"}`,
      `Phone: ${customerPhone || "n/a"}`,
      `Email: ${customerEmail || "n/a"}`,
      notes ? `Notes: ${notes}` : null,
      "",
      "Booked via AI agent — please follow up to confirm catering & deposit.",
    ]
      .filter(Boolean)
      .join("\n"),
    start: { dateTime: startISO },
    end: { dateTime: endISO },
    // NOTE: deliberately NOT including an "attendees" field. Basic service
    // account keys (without Google Workspace domain-wide delegation) are
    // forbidden from adding attendees to an event at all — Google throws
    // "forbiddenForServiceAccounts" even with sendUpdates:"none". The
    // customer's email is still recorded in the description above and in
    // our own database, just not as a calendar invite.
  };

  const res = await calendar.events.insert({
    calendarId: business.google_calendar_id,
    requestBody: event,
    sendUpdates: "none",
  });

  return res.data; // includes res.data.id (google_event_id) and htmlLink
}

async function cancelBookingEvent(googleEventId, business) {
  if (MOCK_MODE) return;

  const calendar = getCalendarClient();
  await calendar.events.delete({ calendarId: business.google_calendar_id, eventId: googleEventId });
}

module.exports = {
  isWithinBusinessHours,
  isSlotFree,
  getAvailabilityForDate,
  createBookingEvent,
  cancelBookingEvent,
};
