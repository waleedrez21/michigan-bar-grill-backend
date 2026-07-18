# Michigan Bar & Grill — Backend

Node/Express backend with:
- An **AI booking agent** (DeepSeek, via tool/function calling) that knows a business's info and can check real availability + create bookings
- **Google Calendar** integration as the source of truth for each business's schedule
- **Multi-tenant by design**: every request is scoped to a specific business via an API key, so a booking made through the website's AI agent shows up in that exact business's schedule — and only theirs — when the owner's app asks for it
- **Contact form** handling (saves to DB, optionally emails the business)
- **SQLite** for bookings, messages, and chat history (swap for Postgres later if needed — only `src/db/db.js` and the `*Repo.js` files touch it directly)

## How a booking gets from the website into the owner's app

1. A customer chats with the AI agent embedded on the website (`POST /api/chat`, sent with that business's API key).
2. The agent checks real availability via Google Calendar, then creates the booking (writes to that business's Google Calendar **and** logs it in SQLite, tagged with `business_id`).
3. The owner's iOS app calls `GET /api/bookings` with **its** business's API key, and gets back only that business's bookings — that's the "Schedule" screen.
4. Since bookings are logged the instant they're created, the app just needs to refresh that list (pull-to-refresh, or a periodic poll) to see new ones appear. No manual sync step — one calendar, one database, scoped by API key.

## 1. Install

```bash
cd backend
npm install
cp .env.example .env
```

Fill in `.env` — see inline comments for DeepSeek and Google Calendar setup (one shared service account handles Calendar auth for every business you onboard).

## 2. Onboard a business

Each restaurant/client gets its own row in the `businesses` table — that's what generates their API key. Edit `scripts/createBusiness.js` with that business's info (name, calendar ID, hours, menu, etc.) and run:

```bash
node scripts/createBusiness.js
```

This prints out a freshly generated API key, e.g. `biz_9f2a...`. That key goes:
- into the website's chat widget config, so the AI agent knows which business it's representing
- into the owner's iOS app (stored securely, e.g. Keychain, after they log in) so their "Schedule" screen only ever sees their own bookings

Re-run the script (with a different `CONFIG.id`) for each additional business.

## 3. Run

```bash
npm run dev     # auto-restarts on file changes
# or
npm start
```

Server boots on `http://localhost:4000` by default. Check `GET /api/health` (this one endpoint doesn't require an API key — everything else does).

## 4. API Reference

Every endpoint below (except `/api/health`) requires an `X-API-Key` header set to the business's API key from step 2.

### `POST /api/chat`
The AI agent endpoint.
```json
// Request
{ "sessionId": "optional-existing-session-id", "message": "Hi, can I book the hall for 20 people on Aug 14th around 6pm?" }

// Response
{ "sessionId": "generated-or-echoed-id", "reply": "Let me check what's open that evening..." }
```
Keep sending the same `sessionId` for the rest of that conversation. History is persisted per business + session in SQLite.

### `GET /api/bookings/availability?date=YYYY-MM-DD`
Direct availability check for that business's calendar.
```json
{ "open": true, "slots": [{ "start": "...", "end": "...", "label": "6:00 PM", "free": true }, ...] }
```

### `POST /api/bookings`
Create a booking directly (bypasses the AI agent — e.g. a manual booking form in the app or on the site).
```json
{
  "customerName": "Jane Doe",
  "customerEmail": "jane@example.com",
  "customerPhone": "519-555-0100",
  "partySize": 20,
  "startDateTime": "2026-08-14T18:00:00",
  "endDateTime": "2026-08-14T21:00:00",
  "notes": "60th birthday party"
}
```

### `GET /api/bookings`
**This is the owner's app's "Schedule" endpoint.** Returns every booking for the business identified by the API key, most recent first.

### `POST /api/contact`
Handles the website's contact form for that business. Saved to SQLite always; emailed to `CONTACT_TO_EMAIL` if SMTP is configured.

## 5. Wiring up the website's contact form / chat widget

Both need to send the business's API key on every request:
```js
fetch('https://your-backend-url.com/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'biz_...' // this business's key from step 2
  },
  body: JSON.stringify({ sessionId, message }),
});
```

## 6. Auth for the app itself

The `X-API-Key` above identifies the *business*, not the individual owner logging into the app. If multiple staff members will log into the app, you'll likely want a lightweight login on top (e.g. Sign in with Apple or a simple email/password table) that, once authenticated, looks up and stores that business's API key for subsequent requests. Happy to add that layer once you know how you want owners to log in.

## 7. Hosting notes

- **Render / Railway**: easiest for a small Node + SQLite app; both support persistent disks for the SQLite file.
- **A VPS**: run with `pm2` or a systemd service in front of Express, with nginx/Caddy handling HTTPS.
- Whatever you pick, make sure `ALLOWED_ORIGINS` includes your live website's domain (for the browser-based contact form/chat widget — irrelevant for the iOS app, which isn't subject to CORS).
