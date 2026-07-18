const db = require("./db");

function getByApiKey(apiKey) {
  return db.prepare(`SELECT * FROM businesses WHERE api_key = ?`).get(apiKey);
}

function getById(id) {
  return db.prepare(`SELECT * FROM businesses WHERE id = ?`).get(id);
}

function create({ id, name, apiKey, googleCalendarId, openHour, closeHour, closedDay, restaurantInfo }) {
  db.prepare(`
    INSERT INTO businesses (id, name, api_key, google_calendar_id, open_hour, close_hour, closed_day, restaurant_info_json)
    VALUES (@id, @name, @apiKey, @googleCalendarId, @openHour, @closeHour, @closedDay, @restaurantInfoJson)
  `).run({
    id,
    name,
    apiKey,
    googleCalendarId,
    openHour: openHour ?? 9,
    closeHour: closeHour ?? 20,
    closedDay: closedDay ?? 1,
    restaurantInfoJson: JSON.stringify(restaurantInfo),
  });
  return getById(id);
}

function listAll() {
  return db.prepare(`SELECT id, name, google_calendar_id, created_at FROM businesses`).all();
}

/** Parses the stored JSON blob back into a usable object. */
function parsedInfo(business) {
  return JSON.parse(business.restaurant_info_json);
}

module.exports = { getByApiKey, getById, create, listAll, parsedInfo };
