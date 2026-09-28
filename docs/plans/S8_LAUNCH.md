# Sub-project 8: launch

*28 September 2026 · plan for sub-project 8 of `docs/EXPO_MIGRATION.md` ("Launch: naming; domain and email authentication; deployment; App Store and Play Store submission")*

S8 is in two parts, because going live needs accounts that only the owner has or can open:

- **S8a, getting ready (this plan).** Everything that needs no accounts:
  - what the stores require that the app lacks;
  - the production configuration for every service;
  - the tests the design saved for launch;
  - drafts for the owner to approve;
  - a runbook for the rest.
- **S8b, going live (the owner).** Following the runbook:
  - buy the domain and set up email;
  - open the hosting, Apple, Google and (later) Stripe accounts;
  - deploy, make test builds, and submit to the stores.

Nothing in S8a deploys, buys, or sends anything anywhere.

## What the stores require that the app doesn't have yet

- **Deleting your own account.** Apple's guideline 5.1.1(v) and Google Play both require it for apps with sign-up; Google also wants a web page for it. Today only the admin can erase an athlete (`accounts.erase.erase_athlete`), and nothing erases a coach.
- **Sign in with Apple: not needed at launch.** Apple requires it only where another third-party sign-in (such as Google) is offered (guideline 4.8). The app offers email codes only. The backend supports Apple and Google (S2); the app's buttons can come after launch, together.
- **A privacy policy and terms**, linked from the app and the store listings.
- **The data-safety answers** (Google) and the **privacy "nutrition label"** (Apple): what's collected and why.
- **A review account** with realistic data, so Apple's reviewers can sign in as a coach and as an athlete. The fixed review code exists (`REVIEW_ACCOUNT_EMAIL`/`_CODE`), but there's no data to go with it.
- **An app icon and splash screen.** They're still Expo's defaults.

## 1. Decisions

| # | Question | Recommendation | Why |
|---|---|---|---|
| A | **What deleting an athlete's account does** | **Everything they recorded is erased straight away** (`erase_athlete`), after they confirm by typing DELETE. Their coach is told "{name} deleted their account". No grace period. | This is what the stores expect, and it's the simplest honest answer. A 30-day grace period means holding data the person asked to remove, plus a job to purge it later. |
| B | **What deleting a coach's account does** | **The coach's account goes.** If they were the gym's last coach: the gym's library, templates and settings go, their athletes' coaching links end (athletes keep their accounts and history, and can join another coach), and any subscription is cancelled. If other coaches remain, the gym carries on; an owner must first hand ownership to another coach. | Athletes' history belongs to the athletes (decision log), so a coach leaving must never erase it. A gym with other coaches shouldn't disappear with one of them. |
| C | **Addresses** | **`liftmason.com`**, with the web app at `app.liftmason.com`, the API at `api.liftmason.com`, and email from `no-reply@liftmason.com`. The bare `liftmason.com` redirects to the app until there's a website. | The web app and API on one domain keep the sign-in cookie simple. The `.com` was free on 28 September; the owner buys it in S8b. |
| D | **Email provider** | **Resend.** | It's already supported (`EMAIL_PROVIDER=resend`), has a free tier that fits launch (3,000 emails a month), and its domain setup is three DNS records. Postmark is the alternative, also supported. |
| E | **Crash reports from the app** | **Sentry for the app too** (`@sentry/react-native`), off until a DSN is set, like the backend. | The backend already reports to Sentry. Without it, a crash on someone's phone is invisible. Its free tier covers launch. |
| F | **The review account** | **A management command, `seed_review`, that builds a separate review gym in production:** a coach, two athletes, a program and a few weeks of history, reached with the fixed review code. It never touches real gyms. | Apple rejects apps whose reviewers can't sign in and see real screens. A command makes it repeatable, and the demo gym can't mix with real data. |
| G | **The icon** | **A simple placeholder mark** (the letter L on the brand blue) for test builds, replaced with a designed icon before submission. | Test builds need an icon, and a designed one is the owner's choice. |
| H | **The privacy policy and terms** | **I draft both in plain English from what the app actually collects**, with blanks for the business's legal name, address and contact email. **A lawyer or the owner reviews them before launch.** | I can describe the data accurately, but they're legal documents for the owner's business. |

**Not in S8a:** anything that deploys, buys or submits (S8b); Apple and Google sign-in on real devices; turning billing on.

## 2. What's built

**Deleting an account (decisions A and B):**
- "Delete my account" in the athlete's Profile and the coach's Account screen: what it removes, typing DELETE, then signing out.
- A web page for Google, at `/delete-account`: sign in, then the same steps.
- **Backend:** `DELETE /me` for athletes, and the coach deletion, with tests (including that athletes' history survives a coach leaving).

**Production configuration:**
- The Render blueprint (`deploy/render.paid.yaml`), checked against every setting the backend reads.
- The Cloudflare Pages build settings.
- EAS: the build profiles with each environment's API address, the app ids (`com.liftmason.app`), and the store submission settings (left blank where they need account ids).
- Sentry in the app (decision E).
- The icon and splash placeholders (decision G).

**Tests saved for launch:**
- **Playwright for the coach's web flows, in CI:** sign in, the board (add, edit, drag), apply a template, the library, settings. These run against a real backend with seeded data.
- **Maestro flows for the phones:** an athlete logging a whole session offline, then syncing. They are written in S8a but need a development build (S8b) to run; the runbook says how.

**Drafts for the owner:**
- The privacy policy and terms (decision H), served at `/privacy` and `/terms` and linked from the app.
- The store listing texts, the data-safety and privacy answers, and a screenshot plan.
- The review account (decision F).

**The runbook** (`docs/LAUNCH.md`): every S8b step in order, who does it, what it costs, and how to check it worked. It covers:
- the domain and DNS; email authentication (SPF, DKIM, DMARC);
- Render, R2, Cloudflare Pages;
- Apple (the D-U-N-S number, the developer account, App Store Connect);
- Google Play; Stripe; Sentry;
- first deploy, TestFlight and internal testing, submission and review.

## 3. Steps

**As built (S8a):**
- **Deleting an account:**
  - `POST /me/delete` (`accounts/erase.py`), in the athlete's Profile, the coach's Account, and at `/delete-account` on the web.
  - The coach case turned out to need **scrubbing, not deleting**. Athletes' coaching links, the gym's exercises and week types, and messages all point at the coach, and deleting them would break the athletes' history and what their phones sync. So the coach's details go ("Former coach", no email, no password, no sessions), and the rows stay.
  - A gym's last coach leaving deletes its templates, default questions and invites, and cancels its subscription (`stripe_billing.cancel`).
  - An athlete's coach is emailed when they leave.
- **Render:** `render.yaml` is the real blueprint now (`deploy/` is gone), in Virginia, with the custom-domain settings. `test_render_blueprint.py` fails if a setting the backend reads isn't listed.
- **The app:**
  - `com.liftmason.app`; EAS profiles calling `https://api.liftmason.com`;
  - Sentry (off until `EXPO_PUBLIC_SENTRY_DSN`);
  - a placeholder icon (`scripts/placeholder-icons.py`).
- **Tests:**
  - Playwright coach flows in CI (job `e2e`, `app/e2e/`).
  - A Maestro offline-session flow (`app/.maestro/`, which needs a development build).
- **`seed_review`:** the reviewers' gym. The review account coaches it and trains in it.
- **Legal:** `/privacy` and `/terms`, drafts in `app/src/legal/texts.ts` with a visible "Draft" notice.
- **Store:** `docs/STORE_LISTING.md` has the listing texts, Apple's privacy label and Google's data-safety answers.
- **The runbook:** `docs/LAUNCH.md`, for the owner. `docs/OPERATIONS.md` is rewritten for running the service after launch.
- **Found on the way:**
  - The app offers only email codes, so **Sign in with Apple isn't required at launch**.
  - Settings' **Plan section now shows on the web only.** Apple doesn't allow pointing to payment outside the app.
  - Two hard-coded "GT" logo marks are now the name's initial.
  - `OPERATIONS.md`'s naming notes are corrected. The earlier fix had missed the merge of PR #13.
  - **The app had no "Report a bug" button:** the API took reports, but the old site's button hadn't been rebuilt. Added after S8a, at Steven's request: the athlete's header, the coach's sidebar and Account.

1. Account deletion: backend, the app's screens, the web page.
2. Production configuration: Render, Cloudflare Pages, EAS, Sentry, icon and splash.
3. Playwright coach flows in CI; the Maestro flows.
4. The review account; privacy policy and terms; store texts.
5. The runbook; docs; hand over to the owner.

## 4. Size

About a week and a half.
