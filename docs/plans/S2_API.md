# Sub-project 2: the API and sign-in

*26 September 2026 · plan for sub-project 2 of `docs/EXPO_MIGRATION.md` (sections 1, 4, 5 and 7)*

S2 puts a JSON API in front of the services, with passwordless sign-in, device sessions,
billing plumbing that allows everything by default, and a permission sweep over every
endpoint. The Expo app (S4 onwards) is built against this API. Athletes' training data
(sessions, sets, habits, check-ins, issues, their messages) reaches their phones through
sync in S3, so S2's athlete endpoints are only their account, joining and profile.

## 1. Decisions

| # | Question | Recommendation | Why |
|---|---|---|---|
| A | S2 is the largest sub-project so far (about 3–4 weeks). One PR, or two? | **Two PRs.** S2a: the API, email-code sign-in, tokens and devices, every coach and athlete-account endpoint, and the permission sweep. S2b: Apple and Google sign-in, plans, entitlements and Stripe. | Each PR stays reviewable. S2b is the part that depends on outside accounts (B), and S3 only needs S2a. |
| B | Apple Developer, Google Cloud and Stripe accounts: who creates them, and when? | **Build S2b against test fixtures now**: tokens signed with our own test keys, recorded Stripe webhook payloads. The owner creates the accounts before the app needs them: **Stripe (free, test mode) during S2b**; **Apple Developer ($99/year) and a Google OAuth client before S4**, when the app can produce real tokens. | Nothing in S2 can get a real Apple or Google token without the app, so the fixtures are the real test anyway. The Stripe test keys let us try Checkout by hand. |
| C | On the web, where the refresh-token cookie lives | The API and the web app on **sibling subdomains of the product domain** (e.g. `api.example.com` and `app.example.com`), so the cookie is `SameSite=Lax` and not a cross-site cookie. In development, both are on `localhost`. | Cross-site cookies are increasingly blocked by browsers. This only constrains S8's hosting set-up (custom domains on Render and Cloudflare Pages), which the domain purchase needs anyway. |
| D | Email provider for sending codes | **Resend**, in test mode until the domain exists (codes print to the console in development either way). | The simplest API, with test addresses; the design leaves the choice open. |

## 2. What's built

**API conventions (S2a).**
- Django Ninja at `/api/v1/`.
- One error shape: `{"error": {"code", "message", "fields"}}`, from one mapping of the services' exceptions to 400 (invalid), 404 (not found or not yours), 409 (conflict: closed session, logged weeks) and 429 (rate limited). This fixes audit M19.
- GETs never write (M20): dashboard alert syncing moves to the cron job (H4), and marking a thread read is its own POST.
- Lists are paginated with cursors.
- The OpenAPI schema is committed (`backend/openapi.json`), and CI fails if it's out of date, so S4 can generate TypeScript types from it.

**Sign-in (S2a).**
- New models:
  - `LinkedIdentity` (user, kind: email, apple or google, subject).
  - `EmailCode`: the code is stored hashed, expires after 10 minutes, one active code per email, and 5 wrong guesses kill it.
  - `DeviceSession`: a hashed access token (15 minutes) and a hashed refresh token (90 days, extended on use), rotated on refresh; reusing an old refresh token revokes the device.
- Endpoints:
  - `auth/email/start` gives the same answer whether or not the account exists, and is rate-limited per email and per address (audit C3).
  - `auth/email/verify` signs in, or starts sign-up.
  - Also: refresh, sign out, list and sign out other devices.
- Coach sign-up is the email-code flow plus the gym form, so every coach's email is verified before any invite email goes out (from the security audit).
- Joining through an invite is the same flow. Ending a coaching link revokes the athlete's access to that coach's data; their own sign-in keeps working.
- On the web, the refresh token is a `Secure`, `HttpOnly` cookie (decision C) and the access token stays in memory.
- Fixed codes:
  - Development: seeded demo users sign in with a fixed code, and codes print to the console.
  - A review account (for App Store and Play review) has a fixed code from a setting.
  - Production refuses to start if a fixed code is set for any other account.
- The Django admin keeps password sign-in behind the rate limiter.

**Coach endpoints (S2a).** Everything the coaching screens need, grouped as the design's app sections:
- **Dashboard:** KPIs, roster, today, recent sessions, the feed and its actions. Query counts are bounded, and the feed is limited (H4, H5, M17).
- **Athletes:** overview, sessions, metrics and PR decisions, check-in questions, messages, form videos, issues, habits, archive (ending the link) and invites.
  - Overview history is aggregated in SQL and paginated (H6).
  - An invite whose email fails is kept once and can be resent (M21).
- **Programming:**
  - Program board: weeks, days, sessions, prescriptions, undo.
  - Exercise library, categories and tags.
  - Templates, saved weeks and sessions.
  - Apply preview and confirm; the preview's placements are worked out once (H7).
- **Settings:** gym, week types, tracked lifts, default questions.

**Athlete account endpoints (S2a).** `/me` (profiles, units, time zone, entitlements), joining, profile and units, filling in missing metrics, and hiding history before a new coach.

**Form videos (S2a).** The upload cap is checked in the same locked transaction that creates the row (M22).

**Apple and Google (S2b).**
- The backend verifies the identity token's signature (the provider's published keys), audience, issuer, expiry and nonce.
- A verified email that matches an existing account links to it. Apple relay addresses are linked from the profile.
- Tests use tokens signed with our own keys (decision B).

**Billing (S2b).**
- `Plan` (limits and feature flags) and `Subscription` (gym, plan, Stripe ids, status, period end, trial end). Every gym starts on Unlimited.
- `entitlements.check(gym, action)` is called by every limited action (adding an athlete or coach, form videos), and `/me` returns the gym's entitlements.
- Upgrade prompts stay hidden while `BILLING_ENABLED` is off.
- Stripe Checkout and the Customer Portal (web only). The webhooks verify signatures, and each event is processed once (an event table). Tests use recorded payloads.
- Failed payments once billing is on: 7 days of full access, then coach programming is read-only. Athletes can always log and view their own data.

**Checks (both PRs).**
- The permission sweep (H15), generated from the route list: as another gym's coach, a coach whose link has ended, another athlete and nobody, every endpoint returns 404 (or 401) and changes nothing. A new endpoint is swept automatically.
- The rate limits from `docs/plans/S0_TEST_TRIAGE.md`, each with a test.
- `pip-audit` in CI (from the security audit).

## 3. Steps

**S2a (one PR).**
1. API skeleton: Ninja, the error convention, authentication, pagination, the OpenAPI check, and the sweep's framework with its first endpoints.
2. Sign-in: the models, email codes, tokens and rotation, devices, web cookies, fixed codes and their production guard, coach sign-up, joining.
3. Dashboard and athletes: alert syncing moves to cron, and query counts are bounded.
4. Programming: board, library, templates, apply.
5. Settings, athlete account endpoints, form videos, the rate limits, and `pip-audit`.
6. The sweep covers every route; docs.

**S2b (a second PR).**
7. Apple and Google sign-in, and linking.
8. Plans, subscriptions, entitlements wired into the limited actions.
9. Stripe Checkout, Portal and webhooks; docs.

## 4. Size

S2a about 2–3 weeks; S2b about 1 week.
