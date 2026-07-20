const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dbPath = process.env.DB_PATH || "./data/database.sqlite";
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  -- One row per restaurant/client using the platform. The website AI agent
  -- and the owner's app both scope every request to a business via its
  -- api_key, so bookings never leak across businesses.
  CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY,                    -- slug, e.g. "michigan-bar-grill"
    name TEXT NOT NULL,
    api_key TEXT NOT NULL UNIQUE,           -- sent as the X-API-Key header
    google_calendar_id TEXT NOT NULL,       -- this business's banquet/booking calendar
    open_hour INTEGER NOT NULL DEFAULT 9,
    close_hour INTEGER NOT NULL DEFAULT 20,
    closed_day INTEGER NOT NULL DEFAULT 1,  -- 0=Sun ... 6=Sat
    restaurant_info_json TEXT NOT NULL,     -- menu/hours/about fed to the AI agent
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    reason TEXT,
    message TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    google_event_id TEXT,
    customer_name TEXT NOT NULL,
    customer_email TEXT,
    customer_phone TEXT,
    party_size INTEGER,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    notes TEXT,
    source TEXT DEFAULT 'agent', -- 'agent' | 'manual' | 'app'
    status TEXT DEFAULT 'confirmed', -- 'confirmed' | 'cancelled'
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_bookings_business ON bookings(business_id);

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    history_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- One row per online order (cart checked out via Stripe). Separate from
  -- bookings/banquet hall reservations — this is for food orders.
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    stripe_session_id TEXT UNIQUE,
    customer_name TEXT,
    customer_email TEXT,
    customer_phone TEXT,
    items_json TEXT NOT NULL,     -- [{ id, name, price, quantity }, ...]
    subtotal_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'paid' | 'completed' | 'cancelled'
    source TEXT DEFAULT 'agent',  -- 'agent' | 'website'
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_orders_business ON orders(business_id);
`);

// ---- Migrations for columns added after initial release ----
// better-sqlite3 has no "ADD COLUMN IF NOT EXISTS", so we check first.
function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}
if (!columnExists("businesses", "menu_items_json")) {
  db.exec(`ALTER TABLE businesses ADD COLUMN menu_items_json TEXT NOT NULL DEFAULT '[]'`);
}

module.exports = db;
