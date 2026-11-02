# Business teams and profiles

Deploy this backend before building the paired WorkBay iOS changes. The existing
FIREBASE_SERVICE_ACCOUNT_JSON must belong to the same Firebase project as iOS.
New endpoints verify Firebase ID tokens (including revocation); a business API key
alone cannot read profiles or manage members. SQLite must retain its persistent volume.

- POST /api/businesses/signup now requires Authorization: Bearer <Firebase ID token>.
  Business and creator's manager membership are inserted in one SQLite transaction.
- POST /api/team/join with {code} joins the signed-in user as employee. Rejoining preserves roles.
- GET /api/me/businesses returns this account's joined businesses and current roles.
- GET/PUT /api/me/profile reads/saves firstName, lastName, phone, bio.
- GET /api/team/:businessId/members returns the team directory (no phone numbers).
- PATCH /api/team/:businessId/members/:uid/role with {role} accepts manager,
  assistant_manager, employee. Only managers may change roles; the creator remains
  manager and no business can lose its last manager. Assistant managers have a
  distinct role label but cannot assign roles.

Existing businesses have no trustworthy creator UID. After verifying ownership,
run `node scripts/assignBusinessManager.js <business-id> <verified-firebase-uid>`
in the environment holding the persistent database. Do not promote the first code
holder or infer ownership from client-writable Firestore documents.
Legacy Firestore memberships are imported into the directory as employees when a
current member opens Team; imports verify the business code and never overwrite roles.
The updated app also imports this account's legacy memberships on sign-in.
New memberships and profile text are stored in SQLite. Photos remain device-local as before.
Older app versions cannot create businesses until updated to send identity tokens;
legacy by-code lookup remains for their existing business access.

Validation: `npm ci && node --test test/*.test.js` (Node 22). Tests stub Firebase token
verification but exercise HTTP routing, SQL migrations/transactions, role enforcement,
creator protection, cross-business isolation, profile validation and private-field filtering.

## Worker appointment routing

Non-restaurant businesses with a saved business type now use individual-worker
appointments. Managers enable **Allow appointment bookings** in each member's Team
menu (including themselves if they provide services). New and existing members are
disabled by default so back-office staff are not assigned customers accidentally.
Members must save first and last names in Profile before being enabled.

The public website and assistant share one assignment/reservation service:

- GET /api/bookings/workers exposes only eligible worker IDs and names.
- GET /api/bookings/availability?date=YYYY-MM-DD supports workerUid or workerName.
- POST /api/bookings supports workerUid / workerName. An explicitly requested
  worker is never replaced by another when unavailable. Duplicate first names need
  a full name. No preference picks an available worker, prioritizing the smallest
  number of appointments that day, with a stable UID tie-break.
- The assistant lists real workers, asks the customer's preference and checks
  availability before confirming. Restaurant ordering/banquet behavior remains.
- GET /api/bookings now requires Firebase identity AND a business API key. Default
  scope=mine returns only the signed-in member's confirmed appointments. Managers
  and assistant managers may use scope=team and optionally workerUid. Shared-key
  callers cannot read customer schedules. Old app versions must update.
- PATCH /api/team/:businessId/members/:uid/booking-settings with acceptsBookings
  is manager-only. Disabling new appointments preserves existing assignments.

Workers' My bookings starts on today; managers/assistant managers can switch to
Team schedule. The week/day selector and appointment detail show assigned names,
and use America/Toronto consistently with the existing business-hours system.
Hours currently follow the business opening hours; individual shifts, leave,
service catalogs and worker-specific durations are not configured in this version.

SQLite checks the complete requested interval and holds a reservation before any
calendar network call, including in mock mode. Assigned shared-calendar events are
tagged with workerUid and only block that worker. Untagged external Google events
and old unassigned SQLite bookings conservatively block the whole business. Old
bookings are not guessed onto workers. Businesses without a linked Google Calendar
can book directly into the app. Calendar write failures retain a blocked reservation
marked calendar_review and do not tell the customer it is confirmed; managers see
these entries and must reconcile the Google event/database before releasing them.
Reservations left pending after a server crash also stay blocked for manager review.

Tests cover preferred workers, simultaneous bookings by different workers,
concurrent requests for the same worker, partial overlaps, adjacent appointments,
UTC/local equivalence, name ambiguity, calendar uncertainty, worker configuration,
assistant tool integration, website creation and schedule authorization.
