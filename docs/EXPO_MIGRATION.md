# Expo migration design

*26 September 2026 · approved in brainstorming, pending written review*

GymTrainer moves from server-rendered Django + HTMX pages to a single Expo (React Native) app that ships to iOS, Android and the web. Django stays as the backend and becomes a JSON API with an offline sync layer. This document is the overall design; each sub-project in "Order of work" gets its own spec, plan and build.

## Why

A full audit on 26 September 2026 found the backend sound: 349 unit and 27 end-to-end tests passing, clean service modules, correct weightlifting rules. The problems were in the presentation layer and in a handful of fixable backend bugs. The product needs a real phone app for athletes that works with no signal, and ideally the same app on the web, without maintaining three apps. A shared Rust core was rejected because it still needs three native UIs; a webview wrapper (Capacitor) was rejected on performance and feel.

## Goals and constraints

- **One front-end codebase** (Expo, TypeScript) for iOS, Android and web. The Django HTML pages are deleted.
- **Offline is a hard requirement for athletes.** A whole session (start, check-in, sets, finish), habit ticks, issue reports and messages work with no signal and sync later without losing data.
- **Coach side, scope B:** desktop web for programming; on a phone, coaches can use the dashboard, messages, form-video review, issues and athlete overview. Full programming on a phone is a planned later feature, so nothing in the API, data model or components may assume a mouse or a desktop.
- **Offline is athlete-only for now.** The sync layer stays general enough to add offline coach editing later without replacing it.
- **Everything ships in Expo before launch** (no period of running old and new front ends side by side).
- **Built mostly by one developer with AI tools:** prefer well-documented, conventional tools; keep custom code to what is genuinely specific to this app.
- **Sign-in:** one-time email codes plus Sign in with Apple and Google. No passwords for users.
- **Billing:** Stripe coach subscriptions on the web, fully built but with every check passing by default.
- **No users yet and an empty database:** the schema can change freely.
- Users are on the US east coast. Hosting is decided (see "Hosting at launch") and happens after the rebuild. Product naming is discussed after the build.

## Offline storage spike (done)

A throwaway Expo SDK 57 app tested expo-sqlite 57 and drizzle-orm 0.45 on web (Chrome, static export) and on the iOS 27 simulator. The results set these rules for the real app:

1. **Do not use Drizzle's `drizzle-orm/expo-sqlite` driver.** It is synchronous only. On web it blocks the main thread, timed out on first load and returned a truncated result under load. On every platform its `transaction()` with an async callback commits before the writes run and never rolls back.
2. **Use `drizzle-orm/sqlite-proxy` over expo-sqlite's async API** (`prepareAsync`, `executeForRawResultAsync`). All database access goes through one queue; a transaction holds the queue until it commits. `withExclusiveTransactionAsync` is not available on web, so transactions are plain `begin`/`commit` inside the queue.
3. **Live queries batch change events** (about 50 ms). The update hook fires once per row; without batching, a 13,500-row write froze the app for over 30 seconds.
4. **Web needs cross-origin isolation headers** on the HTML page: `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Expo's dev server does not add them to the HTML, so web is tested from a static export. YouTube embeds work in Chrome with the iframe `credentialless` attribute; Safari is untested and may need a link out instead of an embed.
5. **On web, only one tab can open the local database** (the browser's file handle is exclusive).

Measured: logging one set with its outbox entry takes about 10 ms; an indexed history query 3–4 ms; a 13,500-row insert 0.8 s on web and 1.2 s on an iOS dev build. Rollback, no-interleaving, and persistence across reload and force-quit passed on both platforms.

## 1. Architecture

**Repo layout:** one repository with `backend/` (the existing Django project, moved down a level) and `app/` (the Expo app). TypeScript API types are generated from Django's OpenAPI schema.

**Two data paths in the app, kept separate:**

- **Training (athlete) screens are offline-first.** They read and write a local SQLite database through the queue, and a sync engine pulls changes and pushes queued actions.
- **Coaching screens are online-only.** They call the API directly with TanStack Query caching. This avoids the one-tab limit on web.
- Coach edits reach athletes because the server records them in the change log, which athletes' phones pull. Offline coach editing later means moving the coach's data into sync; the server, protocol and database layer stay the same.

**Backend:** Django Ninja serves `/api/v1/`. Business logic stays in the service modules. `sync/bootstrap`, `sync/pull` and `sync/push` sit on top of those services. The Django admin stays for operations.

**Hosting at launch:** backend, Postgres and the hourly job on Render (Virginia), about $14 a month; the web app as a static build on Cloudflare Pages with the two isolation headers; phone builds through EAS.

## 2. Backend changes

**Fresh migrations.** Each app starts from a new `0001` migration; the old history and its irreversible data migrations go.

**UUID primary keys** (UUIDv7) on every model. The phone generates the ID for anything created offline (session logs, sets, issue reports, messages), so a retried create cannot make a duplicate.

**People, roles and relationships:**

- A `User` is one person, keyed by email (unique regardless of case). Roles are profiles: a person can have a coach profile, an athlete profile, or both, and switches between Coaching and Training modes in the app.
- **Training history belongs to the athlete profile**, one per person, never to a coach.
- **Coaching is a relationship:** a `coaching` table links coach and athlete with a start date, an end date and a status. One active coach per athlete is enforced for now; the schema allows more later.
- **Gym membership is a relationship:** coach-to-gym is also a link table, one gym per coach enforced for now.
- **History visibility:** a coach sees an athlete's data only while their coaching link is active. A new coach sees the athlete's full earlier history unless the athlete chooses to hide history from before that coaching link started. A previous coach loses access on the end date.

**Change tracking by Postgres triggers.** A `change_log` table records every insert, update and delete on synced tables: a sequence number, the transaction ID, the table, the row ID, the operation, and the owning athlete (or gym, for shared library rows). Triggers are used rather than Django signals because bulk `.update()` calls bypass signals. Every synced table carries an `athlete_id` (or `gym_id` for library tables) so the trigger needs no joins. Deletes are recorded as log entries, so rows can be hard-deleted without soft-delete columns.

**The server stays the authority.** PR detection, maxes and alerts run on the server when it applies an athlete's actions; their results reach the phone through pull.

**Audit fixes carried into the rebuild:**

- Rate limiting moves to a counter table updated in one statement with an explicit expiry (the cache-based limiter reset after five idle minutes and could be emptied by filling the cache).
- Alert de-duplication includes the athlete.
- Undo snapshots store days as offsets from the week start; moves across weeks record both weeks.
- Training history is protected from deletion (`PROTECT`); an explicit "erase athlete" service handles privacy requests.
- Database check constraints on sets, reps, RIR, loads and RPE.
- The JSON snapshot of a prescription carries a version number.
- The digest handles each coach and each step independently and records the send time only after the email is sent.
- Sentry error tracking; timeouts on email (10 s) and storage calls (3 s connect, 10 s read).
- Rules that lived in views move into services: coach signup, invite acceptance, check-in answers, undo recording, the three-sessions-a-day limit, message sending.
- Also from the audit: compliance uses the calendar week, the coach's suggested weight is plate-rounded, fixed weights are not plate-rounded, saved-week numbering, and "max updated" alerts keyed so edits don't pile up.

Findings about the HTML pages (iOS zoom, HTMX error handling, history cache, `Vary` headers) are dropped with those pages.

**Kept:** weights stored in kg as `Decimal`, existing constraints, and the tested business rules.

## 3. Sync protocol

**Pull.** `GET sync/pull?cursor=N` returns the current state of every row in the caller's scope that changed after `N`, deletion markers, and a new cursor, in pages.

- **Scope:** the athlete's own data (sessions, sets, maxes, bodyweight, habits, messages, videos); their published program weeks; their gym's shared library (exercises, tags, categories, week types, check-in questions).
- **Visibility:** every row passes the same permission checks as the API, so draft weeks never sync. Publishing a week marks its rows as changed so they arrive then.
- **No skipped changes:** the cursor only advances past changes from transactions that have committed (using the transaction ID and the current snapshot's oldest running transaction). A late-committing transaction with a lower sequence number must still be delivered.

**Bootstrap.** A new device calls `sync/bootstrap` for a snapshot of its scope and the cursor it was taken at, instead of replaying the log. History is limited to the last 12 months; older history is fetched online on demand.

**Push.** `POST sync/push` sends named actions in order, for example `session.start`, `set.save`, `warmup.tick`, `checkin.answer`, `session.finish`, `habit.toggle`, `issue.report`, `message.send`, `metrics.update`, `video.attach`. Each maps to a service function with the same validation and permission checks as the API.

- Each action carries its client-generated ID. The server stores the result per action ID; a repeated action returns the stored result and changes nothing.
- A temporary failure (server error, timeout) stops the batch for a later retry. A permanent rejection (invalid or forbidden) marks that action failed and processing continues.

**On the phone.** Each action applies its local effect to SQLite and is added to the outbox in one local transaction, so the screen updates immediately. After each pull, the server's state is written to the local tables and any still-pending actions are re-applied on top; a rejected action therefore disappears and the athlete sees a short notice.

**Conflicts in this version** are minimal by design: athletes are the only writers of their logs and coaches the only writers of programs. A session snapshots its prescription when it starts, so a coach editing mid-session doesn't change it. Maxes and bodyweight can be edited by both; the last action the server applies wins. Offline coach editing later adds a base-version check and per-action conflict rules without changing the protocol.

**When sync runs:** on app open, a few seconds after each action, when connectivity returns, and every 60 seconds while the app is open; best-effort in the background. Push runs before pull. A silent push notification (new program, new message) triggers an immediate pull.

**Form videos** are recorded and stored on the phone, then uploaded through their own retry queue using a presigned URL; `video.attach` links the upload to the session afterwards.

**Rules on the phone.** Suggested weight, plate rounding and estimated 1RM are ported to TypeScript for offline use. One JSON file of test cases runs in both pytest and the app's tests.

**Versioning.** The phone sends its local schema version. The server supports the current and previous versions and tells anything older to update.

## 4. Sign-in

**Identities.** One account per person. A `linked_identity` table holds the sign-in methods: email code, Apple, Google. Signing in with Apple or Google using a verified email that matches an existing account links it; Apple private relay addresses can be linked from the profile.

**Email codes.** `auth/email/start` returns the same response whether or not the email exists and sends a 6-digit code. Only a hash of the code is stored; it expires after 10 minutes; one code per email is active; 5 wrong guesses kill it. Requests are rate-limited per email and per IP. Codes only, no magic links (they are easy to add later).

**Apple and Google.** Native buttons in the app (`expo-apple-authentication`, Google's Sign-In SDK) and their JavaScript equivalents on web produce an identity token; the backend verifies its signature, audience and nonce.

**Who can create an account.** Coaches sign up themselves, which creates their gym. Athletes join only through an invite link, which opens the app or the website. The invite link is the credential: single-use, 144-bit random, expiring after 14 days. The email on an invite only pre-fills the form (a strict email match would lock out athletes using Apple's relay addresses).

**Tokens.** A 15-minute access token and a 90-day refresh token extended on each use, both random values stored hashed on the server. Refresh rotates the token; reuse of an old refresh token revokes that device session. Tokens live in `expo-secure-store` on phones; on web, the refresh token is in a secure HttpOnly cookie and the access token in memory. A device-sessions table lets people sign out other devices; ending a coaching link or archiving an athlete revokes as appropriate. Signing out with unsynced actions warns first and offers to sync.

**Offline.** No network calls are made offline, so token expiry doesn't matter until signal returns; the app refreshes, then syncs.

**App Review and development.** A designated review account gets a fixed code from a setting, only for that account and only while enabled, with seeded demo data (same for Google Play). In development, codes print to the console and seeded demo users have a fixed code. Production settings refuse to start if a fixed code is configured for any account other than the review account.

**Admin.** The Django admin keeps password sign-in behind the new rate limiter.

**Dependency.** Real email delivery needs a domain with SPF and DKIM. The build uses the email provider's test mode; the domain must exist before launch.

## 5. Billing

**The gym pays**, not each coach; athletes never pay.

**Models.** `Plan` (code, name, limits such as maximum athletes and coaches, feature flags such as form videos) and `Subscription` (gym, plan, Stripe customer and subscription IDs, status, current period end, trial end). Every gym starts on an Unlimited plan.

**Entitlements.** One function, `entitlements.check(gym, action)`, returns allowed, or denied with a reason and an upgrade link. Every limited action calls it. `/me` returns the gym's entitlements. Upgrade prompts stay hidden while `BILLING_ENABLED` is off. Turning billing on means changing the default plan and the setting, not writing code.

**Stripe.** Checkout for subscribing and the Customer Portal for managing, both on the web. Webhooks (checkout completed, subscription updated or deleted, payment failed) verify signatures and process each event once. Stripe test mode in development, the Stripe CLI for local webhooks, and recorded webhook payloads in tests.

**No purchases in the phone apps.** Coaches manage billing on the web; the phone app shows plan status read-only.

**Failed payments** (once billing is on): 7 days of full access, then coach programming becomes read-only. Nothing is deleted. Athletes can always keep logging and viewing their own data.

## 6. The app

**Layout** (Expo Router):

```
app/
  app/                 routes
    (auth)/            sign-in, code entry, invite/[token]
    (training)/        athlete mode, offline-first
    (coaching)/        coach mode, online
  src/
    db/                schema, async queue client, batched live queries
    sync/              pull, push, outbox; one file per action (name + local effect)
    api/               generated API client and TanStack Query hooks
    domain/            pure TypeScript rules shared with Python test cases
    ui/                component kit from the mockup's design tokens
```

Screens never touch SQLite or fetch directly: training screens go through `db/` and `sync/`, coaching screens through `api/`, and business rules live only in `domain/`.

**Screens.**

- Training: onboarding (invite, sign in, training numbers), home and week, check-in, session player, finish and done, progress, messages, habits, profile.
- Coaching on phone: dashboard and feed, roster, athlete overview, sessions, metrics and messages, form-video review, issue resolution.
- Coaching, desktop-first on web: program board, templates and apply-with-preview, exercise library, check-in questions, settings, billing.

**Ready for phone programming later.** Board components take their layout from the screen width. Every edit is a command (for example, move exercise X to day Y, position 2); drag and drop on web (dnd-kit, in a web-only file) and "tap, then Move to…" on any screen call the same commands. A phone drag implementation can later use React Native Gesture Handler with the same commands.

**Design.** The mockup (`mockup/index.html`) stays the visual reference. Its CSS tokens (colours, type, spacing, week-type colours) become a theme file with a small component kit: button, card, sheet, field, pill, set row, week strip. Plain React Native styles; no third-party UI library.

**Phone features.** Push notifications through Expo's push service (athletes: coach messages, published weeks; coaches: athlete messages, issues, form videos; silent notifications trigger sync). Camera for form videos. Keep-awake in the session player; haptics on set ticks. Network detection and best-effort background sync. Charts drawn on the device with `react-native-svg` from data.

**Offline experience.** A small sync status indicator (synced, N waiting, offline). The athlete is never blocked by missing signal; only first sign-in, first sync and history older than 12 months need a connection.

**Out of scope:** a rest timer (not in today's app; about a day's work later with local notifications).

## 7. Testing

**Backend (pytest).**

- Service tests carry over, adjusted for UUIDs and the link tables.
- `factory_boy` for test data and a frozen-clock fixture everywhere.
- A permission sweep generated from the API's route list: as another gym's coach, a coach whose link has ended, and another athlete, every endpoint returns not found and changes nothing.
- Sync tests: the late-commit case with two database connections; draft weeks never syncing; the history-visibility date; repeating a push batch changes nothing; a rejected action doesn't block later ones; bootstrap followed by pull matches the server.
- A guard test that fails if a synced table lacks its change-log trigger or its `athlete_id`/`gym_id` column.

**Shared rules.** One JSON file of cases for e1RM, plate rounding and suggested weight, run by pytest and by the app's tests.

**App.** Unit tests with `jest-expo` for rules, the sync engine and the outbox. Because the engine only talks to the database through the queue interface, its tests plug in Node's SQLite and run without a simulator.

**End to end.** Playwright for coach flows on web. Maestro for iOS and Android flows, including an athlete logging a whole session with sync switched off (via a development-build offline switch), then reconnecting and the coach seeing it. A manual airplane-mode check on a real phone before each release.

**CI.** GitHub Actions on every push: backend tests with Postgres, app type-check, lint, unit tests and web end-to-end tests. Maestro runs nightly or locally.

## Order of work

Each row is its own sub-project with a spec, a plan and a build.

| # | Sub-project | Size |
|---|---|---|
| 0 | Restructure and fresh schema: move Django to `backend/`; UUIDs; coaching and gym link tables; `athlete_id`/`gym_id` on synced tables; constraints; fresh migrations; carry the service tests over. Delete the HTML views, templates, HTMX/Alpine static files and their tests (git history and the mockup remain the reference). | M |
| 1 | Backend hardening: the audit fixes in section 2. | S–M |
| 2 | API and sign-in: Django Ninja; generated TypeScript types; email codes; Apple and Google; tokens and device sessions; entitlements and Stripe; the permission sweep. | L |
| 3 | Sync backend: change-log triggers; bootstrap, pull and push; the action registry; idempotency; visibility rules. | M–L |
| 4 | App foundation: Expo project; database layer; sync engine; sign-in screens; theme and component kit; push notification setup; web hosting headers. | L |
| 5 | Athlete app: all training screens; offline end-to-end tests. | L |
| 6 | Coach phone screens (scope B). | M |
| 7 | Coach desktop web: board, templates and apply, library, settings, billing page. | L |
| 8 | Launch: naming; domain and email authentication; deployment (Render Virginia, Cloudflare Pages, EAS); App Store and Play Store submission. | M |

The athlete app (4–5) comes before the coach screens because offline is the riskiest part; seeded demo data stands in for coach-built programs until step 7.

## Open items (decided later, not blocking)

- Product name and domain (before launch; needed for email authentication and the API address built into the apps).
- Whether web Safari can embed YouTube under cross-origin isolation, or links out.
- Plan limits and prices, when billing is turned on.
