# Business teams, worker availability and appointment acceptance

Deploy this backend before the paired WorkBay iOS update. Keep the existing SQLite
persistent volume. FIREBASE_SERVICE_ACCOUNT_JSON must match the iOS Firebase project.
The new account endpoints verify Firebase tokens; shared business API keys do not
permit profile edits, member administration, schedule reads or appointment decisions.
Older app versions must update for business creation and schedule reads.

## Initial setup

Business creation inserts the signed-in creator as manager atomically. Existing
businesses have no trustworthy creator UID: after verifying ownership, an operator
runs `node scripts/assignBusinessManager.js <business-id> <verified-firebase-uid>`.
Never infer management rights from code possession or client-writable documents.
Legacy Firestore memberships are imported as employees without overwriting roles.

Members save their name in Profile, then configure My availability from Schedule.
A manager enables Allow appointment bookings from the member's Team menu. No member
is enabled by default, and workers without saved working hours cannot receive new
requests. Managers may also be appointment workers. Assistant managers can view the
team schedule but cannot assign roles or enable workers.

## Availability

Each worker saves seven weekdays, with zero to six nonoverlapping working periods
per day. Empty means off. Split a day into periods around lunch/breaks. Date-specific
blocks support partial days, full days or vacations. All scheduling uses
America/Toronto and must also fit business opening hours. Overnight working periods
are not supported; enter separate periods on the relevant days instead.

The complete appointment must fit working periods and avoid time off, existing
confirmed appointments, pending requests, and Google Calendar conflicts. Changes
that would invalidate an upcoming active appointment are rejected; the worker must
decline a pending request or resolve a confirmed commitment first. Existing confirmed
appointments remain confirmed after rollout; old bookings are not reassigned.

## Request lifecycle

1. Website/assistant creation reserves a slot with status pending_worker. A named
   worker is never silently replaced. No preference selects an available worker
   with the fewest appointments that day. An email address is required for updates.
2. Customer receives a request acknowledgement, not a confirmation. The worker gets
   an email and an in-app request inbox, including requests outside today's date.
3. Only the assigned worker can accept/decline. Acceptance rechecks availability
   and the calendar, then writes the calendar event and confirms the appointment.
   Managers cannot impersonate a worker's acceptance.
4. Decline releases the slot. Pending requests expire after 120 minutes, or at the
   appointment start, whichever comes first. No alternative worker is substituted.
5. A calendar write with uncertain outcome becomes calendar_review, stays blocked,
   and is not reported confirmed. Managers see these and reconcile the calendar/DB.
   A server crash during pending_calendar likewise retains the hold for review.

BOOKING_RESPONSE_MINUTES can override the default (maximum 1440 minutes). Expiry
runs on reads/booking checks and every 30 seconds while the server is running; it
also runs at startup. No calendar event exists for an unaccepted request, so expiry
or decline cannot leave behind a calendar event that incorrectly blocks a worker.
Assigned Google events only block their worker. Untagged external events and legacy
unassigned SQLite appointments conservatively block the entire business.

## Notifications and customer status

Configure RESEND_API_KEY and EMAIL_FROM using a verified sender domain. Set
PUBLIC_API_URL to the backend's public HTTPS origin (RAILWAY_PUBLIC_DOMAIN is also
supported). Without valid email configuration, delivery remains queued for retry;
no emails are falsely reported delivered. Delivery retries use stable provider
idempotency keys. The app inbox works independently of email. No SMS or APNs push
integration is included.

Customer emails acknowledge the request and report confirmed, declined, expired or
calendar-review status. Each contains an unguessable status link. Status pages do
not expose customer contact details. Workers receive a request email with the
response deadline; decisions happen in the authenticated app. Saving or reloading
availability never sends messages directly.

## API contracts

All `/api/team/...` and `/api/me/...` endpoints require `Authorization: Bearer <Firebase ID token>`.

- POST /api/businesses/signup: authenticated creation, returns creator manager role.
- POST /api/team/join: {code}, creates employee membership; rejoin preserves role.
- GET /api/me/businesses: account memberships and current roles.
- GET/PUT /api/me/profile: firstName, lastName, phone, bio. Phone is private; photos remain local.
- GET /api/team/:businessId/members: names, roles, acceptsBookings, bio.
- PATCH /api/team/:businessId/members/:uid/role: manager-only; creator and last manager protected.
- PATCH /api/team/:businessId/members/:uid/booking-settings: {acceptsBookings}, manager-only.
- GET/PUT /api/team/:businessId/me/availability: {weekly:[{weekday:0..6,intervals:[{start:'09:00',end:'12:00'}]}],timeOff:[{start:ISO,end:ISO,note:string}]}.
- POST /api/team/:businessId/bookings/:id/respond: {decision:'accept'|'decline'}, assigned worker only.

The public website/assistant endpoints require the business's X-API-Key:

- GET /api/bookings/workers: only eligible worker names/UIDs; no customer information.
- GET /api/bookings/availability?date=YYYY-MM-DD: optional workerUid / workerName.
- POST /api/bookings: customerName, customerEmail, startDateTime, endDateTime,
  optional workerUid/workerName, customerPhone, notes. Returns status=pending_worker,
  confirmationRequired=true, responseDeadline and statusToken for appointment businesses.
  Restaurant banquet behavior remains unchanged.
- GET /api/bookings: also requires Firebase identity. scope=mine returns the member's
  confirmed appointments and pending requests. Managers/assistant managers may use
  scope=team and optionally workerUid. Private contact details never go to shared-key callers.

GET /api/bookings/status/:token needs only the random bearer-like status token.
Default response is JSON; `?view=page` renders a customer status page. Do not expose
status tokens to other customers or third-party analytics.

## Validation

`npm ci && node --test test/*.test.js` on Node 22. Tests exercise migrations, role
security, availability gaps/time off, schedule conflicts, worker-specific routing,
full-interval conflicts, concurrent holds, decision ownership, expiry/release,
calendar uncertainty and queued email delivery. External Firebase, Google, Resend
and model calls are stubbed; real provider delivery/configuration and simulator/
device UI validation still need deployment-environment testing.
