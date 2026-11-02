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
