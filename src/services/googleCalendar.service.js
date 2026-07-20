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

// All business hours and bookings are interpreted in this fixed timezone,
// REGARDLESS of what timezone the server itself happens to run in (e.g.
// Railway's containers run in UTC, but Windsor, Ontario is Eastern time).
// Without this, "5pm" from a customer would get stored as 5pm UTC and
// display 4-5 hours off once viewed in Calendar or the app.
const BUSINESS_TIMEZONE = "America/Toronto"; // Windsor, ON shares this zone

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

// ---- Timezone-safe date helpers ------------------------------------------
// These exist so date/time math never depends on the server's own local
// timezone (which can differ between your Mac, Railway, or anywhere else
// this ends up running) — everything is explicitly anchored to
// BUSINESS_TIMEZONE instead.

/** True if a datetime string already carries an explicit UTC offset ("Z" or "+hh:mm"). */
function hasExplicitOffset(str) {
  return /Z$|[+-]\d{2}:\d{2}$/.test(str);
}

/** Splits a plain "YYYY-MM-DDTHH:mm:ss" string into its literal number parts. No timezone math. */
function parseWallClock(str) {
  const clean = str.replace("Z", "");
  const [datePart, timePart = "00:00:00"] = clean.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second = 0] = timePart.split(":").map(Number);
  return { year, month, day, hour, minute, second };
}

/** Day of week (0=Sun..6=Sat) for a calendar date, independent of any timezone. */
function weekdayOf({ year, month, day }) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Breaks a real Date instant into its wall-clock components AS SEEN in `timeZone`. */
function getZonedParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => {
    if (p.type !== "literal") acc[p.type] = Number(p.value);
    return acc;
  }, {});
  return parts;
}

/**
 * Converts a wall-clock string (e.g. "2026-07-22T17:00:00", no offset)
 * that represents a moment in `timeZone` into the correct absolute UTC
 * Date. This is what lets "5pm" from the AI/customer become the right
 * real-world instant, whatever the server's own timezone is.
 */
function zonedTimeToUtc(wallClockStr, timeZone) {
  const wall = parseWallClock(wallClockStr);
  const utcGuess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const zonedAsIfUtc = getZonedParts(new Date(utcGuess), timeZone);
  const zonedGuessAsUtc = Date.UTC(
    zonedAsIfUtc.year,
    zonedAsIfUtc.month - 1,
    zonedAsIfUtc.day,
    zonedAsIfUtc.hour,
    zonedAsIfUtc.minute,
    zonedAsIfUtc.second
  );
  const offset = zonedGuessAsUtc - utcGuess;
  return new Date(utcGuess - offset);
}

/** Converts either an absolute (has "Z"/offset) or wall-clock string into a true UTC Date. */
function toUtcDate(str, timeZone) {
  return hasExplicitOffset(str) ? new Date(str) : zonedTimeToUtc(str, timeZone);
}

/** Gets the business-local calendar parts (year/month/day/hour/minute) for either kind of string. */
function toLocalParts(str, timeZone) {
  return hasExplicitOffset(str) ? getZonedParts(new Date(str), timeZone) : parseWallClock(str);
}

/**
 * For sending to the Google Calendar events.insert API: if we already
 * have an absolute instant (has "Z"/offset), pass it through unchanged.
 * If it's a bare wall-clock string, pair it with an explicit timeZone so
 * Google interprets the numbers as local time in that zone rather than UTC.
 */
function toGoogleEventDateTime(str, timeZone) {
  if (hasExplicitOffset(str)) return { dateTime: str };
  return { dateTime: str, timeZone };
}
// ---------------------------------------------------------------------------

/**
 * Returns true if the given datetime range falls within the business's
 * configured hours, correctly accounting for the business's real timezone.
 */
function isWithinBusinessHours(startISO, endISO, business) {
  const start = toLocalParts(startISO, BUSINESS_TIMEZONE);
  const end = toLocalParts(endISO, BUSINESS_TIMEZONE);

  if (weekdayOf(start) === business.closed_day || weekdayOf(end) === business.closed_day) return false;
  if (start.hour < business.open_hour) return false;
  if (end.hour > business.close_hour || (end.hour === business.close_hour && end.minute > 0)) {
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
  const startUtc = toUtcDate(startISO, BUSINESS_TIMEZONE);
  const endUtc = toUtcDate(endISO, BUSINESS_TIMEZONE);

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: startUtc.toISOString(),
      timeMax: endUtc.toISOString(),
      items: [{ id: business.google_calendar_id }],
    },
  });
  const busy = res.data.calendars?.[business.google_calendar_id]?.busy || [];
  return busy.length === 0;
}

/**
 * Given a date (YYYY-MM-DD), return 1-hour candidate windows within this
 * business's hours, each flagged free or busy against their calendar.
 * All hours are interpreted in BUSINESS_TIMEZONE regardless of server TZ.
 */
async function getAvailabilityForDate(dateStr, business) {
  const dateParts = parseWallClock(`${dateStr}T00:00:00`);
  if (weekdayOf(dateParts) === business.closed_day) {
    return { open: false, reason: "Closed that day", slots: [] };
  }

  const buildSlots = (busyRangesUtc) => {
    const slots = [];
    for (let hour = business.open_hour; hour < business.close_hour; hour++) {
      const slotStartLocal = `${dateStr}T${String(hour).padStart(2, "0")}:00:00`;
      const slotEndLocal = `${dateStr}T${String(hour + 1).padStart(2, "0")}:00:00`;
      const slotStartUtc = zonedTimeToUtc(slotStartLocal, BUSINESS_TIMEZONE);
      const slotEndUtc = zonedTimeToUtc(slotEndLocal, BUSINESS_TIMEZONE);
      const overlaps = busyRangesUtc.some((b) => slotStartUtc < b.end && slotEndUtc > b.start);

      const hour12 = ((hour + 11) % 12) + 1;
      const ampm = hour < 12 ? "AM" : "PM";

      slots.push({
        start: slotStartUtc.toISOString(),
        end: slotEndUtc.toISOString(),
        label: `${hour12}:00 ${ampm}`,
        free: !overlaps,
      });
    }
    return slots;
  };

  if (MOCK_MODE) {
    return { open: true, slots: buildSlots([]) }; // everything free
  }

  const calendar = getCalendarClient();
  const dayStartUtc = zonedTimeToUtc(`${dateStr}T00:00:00`, BUSINESS_TIMEZONE);
  const dayEndUtc = zonedTimeToUtc(`${dateStr}T23:59:59`, BUSINESS_TIMEZONE);

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: dayStartUtc.toISOString(),
      timeMax: dayEndUtc.toISOString(),
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
    start: toGoogleEventDateTime(startISO, BUSINESS_TIMEZONE),
    end: toGoogleEventDateTime(endISO, BUSINESS_TIMEZONE),
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
