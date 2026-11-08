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
if (!columnExists("businesses", "code")) {
  // Short human-friendly signup/login code (e.g. "MBG-4821"), separate
  // from the internal `id` slug. SQLite does NOT allow ADD COLUMN ...
  // UNIQUE directly, so we add a plain column here and enforce
  // uniqueness with a separate index below instead.
  db.exec(`ALTER TABLE businesses ADD COLUMN code TEXT`);
}
if (!columnExists("businesses", "business_type")) {
  db.exec(`ALTER TABLE businesses ADD COLUMN business_type TEXT`);
}
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_code ON businesses(code)`);

// Verification codes for confirming an email address belongs to the
// person signing up, BEFORE their real Firebase account gets created.
// Not scoped to a business — this happens before any business exists
// for this person.
db.exec(`
  CREATE TABLE IF NOT EXISTS verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_verification_codes_email ON verification_codes(email);
`);

module.exports = db;

// Account identities and roles are server-owned; a business API key alone
// never grants permission to manage members. Existing businesses stay unclaimed.
if (!columnExists('businesses', 'creator_uid')) {
  db.exec('ALTER TABLE businesses ADD COLUMN creator_uid TEXT');
}
db.exec(`
  CREATE TABLE IF NOT EXISTS user_profiles (
    uid TEXT PRIMARY KEY,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS business_members (
    business_id TEXT NOT NULL REFERENCES businesses(id),
    uid TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee'
      CHECK(role IN ('manager', 'assistant_manager', 'employee')),
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(business_id, uid)
  );
  CREATE INDEX IF NOT EXISTS idx_business_members_uid ON business_members(uid);
`);

if (!columnExists('business_members', 'accepts_bookings')) {
  db.exec('ALTER TABLE business_members ADD COLUMN accepts_bookings INTEGER NOT NULL DEFAULT 0');
}
if (!columnExists('bookings', 'worker_uid')) {
  db.exec('ALTER TABLE bookings ADD COLUMN worker_uid TEXT');
}
if (!columnExists('bookings', 'worker_name')) {
  db.exec('ALTER TABLE bookings ADD COLUMN worker_name TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_bookings_worker ON bookings(business_id, worker_uid, status)');

if (!columnExists('bookings', 'response_deadline')) db.exec('ALTER TABLE bookings ADD COLUMN response_deadline TEXT');
if (!columnExists('bookings', 'responded_at')) db.exec('ALTER TABLE bookings ADD COLUMN responded_at TEXT');
if (!columnExists('bookings', 'status_token')) db.exec('ALTER TABLE bookings ADD COLUMN status_token TEXT');
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_status_token ON bookings(status_token);
  CREATE TABLE IF NOT EXISTS worker_availability (
    business_id TEXT NOT NULL, uid TEXT NOT NULL,
    weekly_json TEXT NOT NULL DEFAULT '[]', time_off_json TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY(business_id,uid)
  );
  CREATE TABLE IF NOT EXISTS booking_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL,
    event TEXT NOT NULL, recipient TEXT NOT NULL, sent_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT,
    UNIQUE(booking_id,event,recipient)
  );
`);

if (!columnExists('bookings','created_by_uid')) db.exec('ALTER TABLE bookings ADD COLUMN created_by_uid TEXT');
if (!columnExists('bookings','manual_request_id')) db.exec('ALTER TABLE bookings ADD COLUMN manual_request_id TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_booking_request ON bookings(business_id,created_by_uid,manual_request_id)');

for (const [name,type] of Object.entries({service_id:'TEXT',service_name:'TEXT',service_duration_minutes:'INTEGER',price_cents:'INTEGER',currency:'TEXT',replaces_booking_id:'INTEGER',cancellation_reason:'TEXT'})) {
  if(!columnExists('bookings',name))db.exec(`ALTER TABLE bookings ADD COLUMN ${name} ${type}`);
}
db.exec(`
 CREATE TABLE IF NOT EXISTS appointment_services (
  id TEXT PRIMARY KEY,business_id TEXT NOT NULL,name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,price_cents INTEGER NOT NULL,currency TEXT NOT NULL,
  worker_uids_json TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1
 );
 CREATE INDEX IF NOT EXISTS idx_appointment_services_business ON appointment_services(business_id);
 CREATE TABLE IF NOT EXISTS push_tokens (token TEXT PRIMARY KEY,uid TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_push_tokens_uid ON push_tokens(uid);
`);

db.exec(`
 CREATE TABLE IF NOT EXISTS join_requests (business_id TEXT NOT NULL,uid TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(business_id,uid));
 CREATE TABLE IF NOT EXISTS account_deletions (uid TEXT PRIMARY KEY,requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS clock_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT,business_id TEXT NOT NULL,uid TEXT,clock_in TEXT NOT NULL,clock_out TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS idx_clock_active ON clock_sessions(business_id,uid) WHERE clock_out IS NULL;
`);

if (!columnExists('account_deletions','email')) db.exec('ALTER TABLE account_deletions ADD COLUMN email TEXT');
if (!columnExists('chat_sessions','owner_uid')) db.exec('ALTER TABLE chat_sessions ADD COLUMN owner_uid TEXT');

if (!columnExists('verification_codes','purpose')) db.exec("ALTER TABLE verification_codes ADD COLUMN purpose TEXT NOT NULL DEFAULT 'signup'");
db.exec(`CREATE TABLE IF NOT EXISTS email_verification_grants(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS privacy_requests(id TEXT PRIMARY KEY,email TEXT NOT NULL,requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_at TEXT);`);

db.exec(`
 CREATE TABLE IF NOT EXISTS clock_pins (
  uid TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  digest TEXT NOT NULL
 );
`);
