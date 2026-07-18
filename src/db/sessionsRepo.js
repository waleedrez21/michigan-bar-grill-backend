const db = require("./db");

function getHistory(sessionId, businessId) {
  const row = db
    .prepare(`SELECT history_json FROM chat_sessions WHERE id = ? AND business_id = ?`)
    .get(sessionId, businessId);
  return row ? JSON.parse(row.history_json) : [];
}

function saveHistory(sessionId, businessId, history) {
  const json = JSON.stringify(history);
  db.prepare(
    `INSERT INTO chat_sessions (id, business_id, history_json, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET history_json = excluded.history_json, updated_at = CURRENT_TIMESTAMP`
  ).run(sessionId, businessId, json);
}

module.exports = { getHistory, saveHistory };
