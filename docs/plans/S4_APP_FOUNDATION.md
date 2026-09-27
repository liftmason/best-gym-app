# Sub-project 4: the app foundation

*27 September 2026 · plan for sub-project 4 of `docs/EXPO_MIGRATION.md` (sections 1 and 6, and the storage spike)*

S4 starts the Expo app in `app/`. It builds everything the screens will stand on: the project,
the look (theme and component kit), talking to the API, signing in, the local database, the
sync engine, push notifications and web hosting. The athlete's screens are S5, the coach's
phone screens S6, and the desktop coaching screens S7. S4 ends with a working sign-in, a
first sync onto the phone, and a status indicator, not with the finished app.

## 1. Decisions

| # | Question | Recommendation | Why |
|---|---|---|---|
| A | One PR or two? | **Two.** S4a: the project, theme and kit, API client, sign-in screens, the shared rules, CI. S4b: the local database, the sync engine, push notifications, web hosting. | S4 is large (about 4–5 weeks). S4a is reviewable on its own, and gives something to click through early. |
| B | How Steven tries the app while it's being built | **Expo Go on his Android phone, and the web in a browser.** Everything in S4 runs in Expo Go except Apple/Google sign-in and push notifications. Those need a **development build**, which needs the owner's accounts: a free **Expo account** now, and the Apple and Google accounts before S5. | No accounts are needed to start, and Expo Go reloads instantly. Development builds come once the accounts exist. |
| C | The API client | **Types generated from `backend/openapi.json`** (openapi-typescript) with the small openapi-fetch client, and TanStack Query for caching. CI fails if the types are stale. | The same file the backend's test keeps current; no hand-written API types to drift. |
| D | The phone's database tables | **Generated from the server:** a management command writes the synced tables' columns, and a script turns that into the Drizzle schema. | The phone's tables and what pull sends can't drift apart; a change in one fails a check until the other follows. |
| E | When the app updates to a new schema version | **Wipe the synced tables and bootstrap again, keeping the outbox** (actions waiting to be sent). | Simpler and safer than local migrations while nobody uses the app. Pending actions carry their own data, so nothing done offline is lost. |

Package manager: npm (it comes with Node; nothing to add).

## 2. What's built

**The project** (`app/`):
- Expo SDK 57, TypeScript in strict mode, and Expo Router with the design's layout: `(auth)`, `(training)`, `(coaching)`, and `src/db`, `sync`, `api`, `domain`, `ui`.
- ESLint, and jest-expo for tests.
- A CI job running type-check, lint and unit tests alongside the backend's.

**Theme and component kit** (`src/ui`):
- The mockup's CSS tokens (colours, type, spacing, week-type colours) become a theme, with Inter as the font.
- Components: button, card, sheet, field, pill, set row, week strip. Plain React Native styles, no UI library.
- A kit screen (development only) shows every component, for review on phone and web.

**Talking to the API** (`src/api`):
- The generated client, with the access token attached.
- A refresh when the access token expires, done once even if several requests hit it together.
- On web, the cookie mode (`X-Client: web`).
- Errors come back in the API's shape for screens to show.

**Signing in** (`(auth)`):
- Email and code, then either signed in or the new-coach form.
- Invite links (`/join/[token]`).
- Apple and Google buttons, shown only where the provider is set up.
- Tokens in secure storage on phones; on web, the access token in memory and the refresh token in the cookie.
- After sign-in, `/me` decides coach mode, athlete mode, or a switch between them.
- Sign-out, with a warning if actions are waiting to be sent (after S4b).

**Shared rules** (`src/domain`): e1RM, plate rounding and suggested load in TypeScript, checked against `shared/rules-cases.json`, the same cases pytest checks.

**The local database** (`src/db`, S4b):
- expo-sqlite's async API behind Drizzle's proxy driver, with every access through one queue. A transaction holds the queue until it commits, as the spike found necessary.
- Live queries batch change events every ~50 ms.
- The schema is generated (decision D). On web, only one tab may open the database; a second tab says so.

**The sync engine** (`src/sync`, S4b):
- Bootstrap on first sign-in, then pull by cursor. Push runs before pull.
- Each action is one file: its name, and its local effect on SQLite.
- The outbox: an action's local effect and its outbox entry are written in one transaction.
- After each pull, pending actions are re-applied on top. A rejected action is dropped with a short notice.
- Sync runs on app open, a few seconds after each action, when the network returns, and every 60 seconds.
- A status indicator: synced, N waiting, or offline.
- The engine is tested with Node's SQLite, without a simulator, as the design says.

**Push notifications** (S4b):
- Backend: each device's Expo push token, stored on its device session, and sends through Expo's push service. Athletes get coach messages and published weeks; coaches get athlete messages, issues and form videos; silent pushes trigger a sync.
- App: registration.
- Tested against a stubbed Expo service until a development build exists (decision B).

**Web hosting** (S4b):
- A static export with the cross-origin isolation headers (COOP and COEP) that the local database needs.
- A `_headers` file for Cloudflare Pages.
- A local command that serves the export with the same headers.

## 3. Steps

**As built:**
- **Routes:** these live in `app/src/app/` (Expo's current template), not `app/app/`. The other folders sit beside them in `src/`.
- **Shared rules:** they use `big.js`, so decimals round exactly as Python's `Decimal` does.
- **Mode homes:** `/home` (training) and `/dashboard` (coaching). Route groups don't add to the
  URL, so an `index` in each group would clash with `/`.
- **Refresh:** only after a 401, never ahead of the expiry time. A phone's clock can be wrong,
  and each refresh rotates the token. Requests that expire together share one refresh.
- **Guards:** `Stack.Protected` guards the signed-in routes and sign-in. `/join/[token]` is
  open either way.
- **A new email's sign-up ticket** stays in memory, not in the URL.
- **openapi-typescript** declares TypeScript 5 as a peer, but works with 6 (an npm `overrides`
  entry).
- **Backend additions:**
  - `GET auth/signup/starters`: the new-coach form lists the server's packs.
  - `join/{token}/signup` now declares its tokens in the schema.
  - A body that isn't JSON is answered in the API's error shape.
  - `make run-lan` serves the backend to a phone.
- **Apple and Google buttons:** not built yet. They need a development build and the owner's
  accounts (decision B).

**S4b as built:**
- **Generated schema (decision D):**
  - `manage.py sync_schema` writes `shared/sync-schema.json` from the same column list pull uses.
  - `npm run db:schema` turns it into the Drizzle tables and `CREATE` statements.
  - Tests on both sides fail when either is stale.
  - There's no drizzle-kit: decision E means synced tables are never migrated, only remade.
- **The database queue:**
  - Each committed write notifies subscribers once, with the tables it changed. The per-row SQLite hook isn't used, so this works the same on web, phones and Node, and a rolled-back write says nothing.
  - Live queries gather notices over 50 ms.
- **Rebasing:**
  - An action's local effect writes through a recorder that keeps an undo log (`local_changes`).
  - Each pulled page undoes the log, writes the server's rows, then applies the waiting actions again.
  - Without the undo log, a habit ticked offline would show twice once the server's own row arrived.
- **First actions:** `habit.set` and `message.send`. The session player's actions come with their screens in S5, since they need the set-entry rules on the phone.
- **Offline start:** training mode remembers the device's athlete, so it opens without `/me`.
- **Sign-out:** it warns about unsent changes, then clears the device's copy.
- **Web:**
  - Single-page output. The dev server's pre-rendering can't load SQLite's worker, and every screen is behind sign-in anyway.
  - The Metro config bundles `.wasm` and sends COOP/COEP in development.
  - Hosting headers are in `app/public/_headers`, and `npm run serve:web` uses the same file.
  - One tab at a time is enforced with a Web Lock.
- **Push:**
  - The token is kept on the device session and moves to the newest one.
  - Pushes are sent after the database commit, with a 5 s timeout, and failures are logged.
  - `PUSH_PROVIDER` is required in production.
  - The app registers only in our own builds on a real phone.
- **Checked against the real backend** by hand: bootstrap of all 27 tables, then an offline habit tick pushed and pulled back as one row.
- **Accounts:**
  - The Expo project exists (`spearws-team/best-gym-app`).
  - Still to come: Firebase (FCM) credentials for Android push, the Apple account (iOS builds and push), and Apple/Google sign-in.


**S4a**
1. The project, tooling and the CI job.
2. The theme and component kit, and the kit screen.
3. The generated API client, tokens and refresh.
4. The sign-in screens and mode switching.
5. The shared rules in TypeScript.

**S4b**
6. The generated schema and the local database queue.
7. The sync engine and its tests.
8. Push notifications (backend and app).
9. Web hosting headers, the single-tab rule, docs.

## 4. Size

About 4–5 weeks: S4a 2 weeks, S4b 2–3.
