const db = require("./db");

function getByApiKey(apiKey) {
  return db.prepare(`SELECT * FROM businesses WHERE api_key = ?`).get(apiKey);
}

function getById(id) {
  return db.prepare(`SELECT * FROM businesses WHERE id = ?`).get(id);
}

/** Used by the app's login screen — looks up a business by its short
 *  human-facing signup code (e.g. "MBG-4821"), not the internal id/slug. */
function getByCode(code) {
  return db.prepare(`SELECT * FROM businesses WHERE code = ?`).get(code);
}

function create({ id, name, apiKey, googleCalendarId, openHour, closeHour, closedDay, restaurantInfo, menuItems, code }) {
  db.prepare(`
    INSERT INTO businesses (id, name, api_key, google_calendar_id, open_hour, close_hour, closed_day, restaurant_info_json, menu_items_json, code)
    VALUES (@id, @name, @apiKey, @googleCalendarId, @openHour, @closeHour, @closedDay, @restaurantInfoJson, @menuItemsJson, @code)
  `).run({
    id,
    name,
    apiKey,
    googleCalendarId,
    openHour: openHour ?? 9,
    closeHour: closeHour ?? 20,
    closedDay: closedDay ?? 1,
    restaurantInfoJson: JSON.stringify(restaurantInfo),
    menuItemsJson: JSON.stringify(menuItems || []),
    code: code || null,
  });
  return getById(id);
}

function listAll() {
  return db.prepare(`SELECT id, name, google_calendar_id, created_at FROM businesses`).all();
}

function updateMenuItems(id, menuItems) {
  db.prepare(`UPDATE businesses SET menu_items_json = ? WHERE id = ?`).run(JSON.stringify(menuItems), id);
  return getById(id);
}

/** Parses the stored JSON blob back into a usable object. */
function parsedInfo(business) {
  return JSON.parse(business.restaurant_info_json);
}

module.exports = { getByApiKey, getById, getByCode, create, listAll, parsedInfo, updateMenuItems };
