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
