# Security and privacy release

This is an engineering change, not certification of legal compliance or a guarantee of App Review approval.

## Behavior

- The creator becomes manager. Joining with a business code creates a **pending request**, without membership or API access. Only a manager can approve or decline. The Team page lists requests; employees cannot approve themselves. Rejoining never changes an existing role.
- Managers may remove employees/assistant managers, cancelling future assigned appointments before removal. Creator/last-manager protections remain for role changes. Account deletion is not blocked by ownership: it removes the creator identity while preserving other people's business records.
- No client-writable Firestore memberships are imported. Orders require a valid Firebase identity **and** approved membership for the business selected by X-API-Key. Website identifiers are not staff credentials.
- Password-reset API returns 410. New iOS clients use Firebase's secure email action links. Codes for signup and customer privacy have separate purposes, salted hashes, ten-minute expiry, five guesses and single-use consumption. Verification grants are random, email-bound, hashed and short-lived.
- Clock-in uses server time, authenticated uid and approved business membership. Employee codes cannot authorize another person's clock record. Writes are idempotent and scoped to a business. Historical clock data in Firestore is not migrated into the new clock; preserve any records required by law before closing legacy access.
- AI chat requires explicit consent version `2026-11-02`. iOS and the supplied website widget explain DeepSeek sharing and a direct-contact alternative. Old website widgets fail closed until updated. Conversations are isolated by business and, for authenticated app requests, by account. Anonymous website conversation IDs are bearer secrets; they are not user authentication.
- Account deletion requires sign-in within five minutes, disables access and new assignments, revokes tokens, cancels assigned future appointments, removes personal profile/membership/availability/push/clock records and legacy owned Firestore records, and deletes Firebase Auth. Shared bookings are anonymized. Customer records matching a verified account email are scrubbed. External failures leave a durable job for automatic retry, never a false completed response.
- The public privacy page includes email-verified customer contact deletion; it does not cancel bookings or refund Stripe payments. Account data export is in app Settings. Private booking links must not be shared.
- New Calendar events contain times, a booking reference and private worker uid, without customer contacts/notes. Deletion and retention redact old WorkBay events before local scrubbing.
- Cleanup: codes one day; inactive chats 30 days; contacts and inactive device registrations 90 days; order/booking contact details 365 days; ended time-clock records three years. Businesses must preserve their independently required records. Provider copies/exports/backups have separate lifecycles. Anonymous chat text not attributable by exact email ages out after 30 days.
- No URL parameters, booking bearer URLs, codes or request bodies in application access logs. Existing platform edge logs must be checked separately. No advertising/analytics SDK products in the updated iOS target; only Firebase Auth/Core/Messaging remain.

## Public links and website integration

- Privacy: `https://michigan-bar-grill-backend-production.up.railway.app/api/privacy`
- Terms: `https://michigan-bar-grill-backend-production.up.railway.app/api/terms`
- Privacy contact: `waleed.shammarez21@gmail.com` (override via `PRIVACY_CONTACT_EMAIL`). This is a public support address, authorized by the publisher.
- Consent-aware chat: `/api/chat/widget?key=BUSINESS_PUBLIC_API_KEY`. Link to it from the business website. If embedding an iframe, your hosting/frame policy must permit that site; a plain link works without modifying frame protections. The old widget must explicitly obtain consent and include `aiConsent: '2026-11-02'` before calling chat. Do not silently add the flag to old widgets.
- AI sharing and data protection agreements with DeepSeek and other processors still require business review. Do not claim equal data protection or a retention promise without verifying the applicable provider contract.

## External release steps still required

1. In the **correct WorkBay Firebase project**, deploy `WorkBay/firestore.rules` from the iOS repository (`firebase deploy --only firestore:rules --project YOUR_WORKBAY_PROJECT_ID`). The new app no longer reads/writes client Firestore. The supplied rules deny all client access; Admin SDK cleanup remains allowed. Verify the project first and test denial for employees/memberships/activeSessions/clockSessions. **Committing rules does not deploy them.** Existing installed versions that rely on Firestore clocks will need to update. If this Firebase project hosts other apps, scope these rules to WorkBay collections before deployment instead of replacing unrelated rules.
2. Enable Firebase email-enumeration protection, check the Auth password-reset template/sender and authorized domains, test email delivery, and verify the backend Admin service account can revoke/delete users and delete its owned legacy Firestore records. No credentials should be put in GitHub.
3. In App Store Connect, set the Privacy Policy URL above and the support email. Describe contact information, user content, user identifiers, device/push identifiers and any purchase data actually collected from the app as linked to the user for app functionality. Review optional AI chat content and every SDK's archive privacy report. Mark no advertising tracking only after verifying the actual archive and server configuration; no ATT prompt is needed merely for authentication/push.
4. Archive using **Rayan's production developer team and bundle ID**, not a personal development bundle. Inspect the privacy report and SDK manifests, APNs capability and Firebase APNs key, and validate the archive. Never commit a personal provisioning workaround.
5. Test on a physical device: Firebase signup/reset/verification, manager creation, join/pending/approval/rejection/removal, cross-business denial, own clock records, optional AI consent/withdrawal, notification permission denied, bookings/reschedules/cancellations, exports and account deletion including provider failure/retry. Give App Review working demo accounts and a preconfigured demo business; no real customer data.
6. Review policies against actual business operations, processor contracts, retention obligations and the countries/states served. Verify cloud backups, restricted team access, restore procedures and provider/edge-log retention. Published policies must match reality; engineering checks do not establish that every applicable law is satisfied.

## Validation

`node --test test/*.test.js` on Node 22 with native better-sqlite3 in GitHub Actions. Local verification uses the Node SQLite adapter because the cached native addon targets Node 22 while the host runs Node 24. The new security suite exercises pending-member denial, manager approval and removal, order authorization, scoped clocks, code expiry/reuse/guess limits, email-bound proof, blocked legacy reset, AI consent/session isolation and deletion retries/customer privacy proof. iOS simulator compilation runs separately on a macOS GitHub runner; device behavior and production signing need the checks above.
