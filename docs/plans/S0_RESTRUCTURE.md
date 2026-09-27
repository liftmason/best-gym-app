# Sub-project 0: restructure and fresh schema — implementation plan

*26 September 2026 · decisions A–F answered by the owner the same day · design: `docs/EXPO_MIGRATION.md` ("Order of work", row 0)*

Sub-project 0 turns `main` from a Django + HTMX site into a Django backend with no pages, in
`backend/`, on the schema the Expo app and the sync layer need. Nothing user-facing is built
here; the API starts in sub-project 2. At the end of S0 the backend has services, models,
admin, management commands and service-level tests, all passing on a fresh schema.

## 1. One thing the design didn't account for: most tests go through the pages

The design says to delete the HTML views at the start of S0 and "carry the service tests over".
Counting the 304 unit tests on `main`:

| | Tests |
|---|---|
| Call services or models directly | 82 |
| Reach the rules through HTTP requests to the HTML views | 222 |

Deleting the views first would delete about three quarters of the test coverage, including
tests for rules that live **only** in views or forms today (audit H17: coach sign-up, invite
acceptance, check-in answer validation, undo recording, the three-sessions-a-day limit, message
sending), and the dose validation in `PrescriptionForm` (load limits per basis, rep-scheme and
RIR parsing, vary-by-set rows). Those rules would be gone before S1 moves them into services, and
S2's API would have nothing tested to call.

**Proposed change (needs the owner's OK — decision A below):** before deleting anything, S0
moves every rule that lives in a view or form into a service and gives it a service-level test,
with the views calling the new services so the existing 222 tests prove the move changed
nothing. Only then are the pages and their tests deleted. This pulls the "move rules into
services" part of H17 from S1 into S0; the rest of S1 is unchanged.

## 2. Decisions (answered 26 September 2026)

The owner accepted every recommendation except B: **upgrade to Python 3.14 and use its built-in `uuid.uuid7`** instead of writing our own.

| # | Question | Recommendation | Why |
|---|---|---|---|
| A | Extract rules from views and forms into services, with service tests, **before** deleting the pages (section 1)? | Yes | Keeps the tested rules; the API in S2 then calls services that already exist and are tested. |
| B | Where UUIDv7 comes from (Python 3.12 has no `uuid.uuid7`; 3.14 does) | **Decided: upgrade to Python 3.14** and use `uuid.uuid7` (step 1) | Owner's call; no custom ID code to maintain. Django 5.2 supports 3.14 from 5.2.8. |
| C | What a message thread belongs to | The **coaching link** (one thread per coach–athlete period) | "Old coach loses access at the end date" becomes a check on one row; a new coach starts a fresh thread; the athlete keeps old threads as history. |
| D | "Archiving" an athlete, now that coaching is a link | Archiving **ends the coaching link** (status `ended`, `ended_at` set); a new invite creates a new link | One concept instead of two; matches "ending a coaching link or archiving an athlete revokes access" in the design. |
| E | The free-tier trial site on Render | **Suspend the Render service before S0 merges** | Render deploys `main` automatically; after S0 there are no pages, and the start command's `seed_demo --if-empty` would run against the new schema. Nobody is using it. |
| F | Schema-only parts of later fixes: the athlete in `Notification`'s unique constraint (H1), the rate-limit counter table (C1/C2), the snapshot `v` field (M29) | Put the **tables and constraints** in S0's fresh migrations; the behaviour stays in S1 | Avoids a second migration a week later for a schema that is being written from scratch anyway. |

Smaller calls, stated rather than asked (say if any is wrong):

- Many-to-many fields on synced tables (`Exercise.tags`, `Prescription.tag_slot_tags`,
  `TemplateSlot.tags`) get explicit through models with their own `gym_id`/`athlete_id`, so S3's
  change-log triggers can scope them without joins.
- Template tables get `gym_id` too, although they aren't synced yet: offline coach editing is
  planned, and adding the column now is free.
- `whitenoise` stays (the admin's CSS); `django-htmx` and `django-template-partials` go.
- Email templates (`templates/emails/*.txt`) stay; everything else in `templates/` goes.

## 3. Steps

Each step is one or more commits on the `s0-restructure` branch. Tests pass at the end of every
step; the branch merges as one PR once all steps are done.

### Step 1 — Tooling baseline (small)

- **Python 3.14** (decision B): install `uv`, which also installs the interpreter
  (`uv python install 3.14`); rebuild the virtualenv; `requires-python = ">=3.14"`, ruff
  `target-version = "py314"`, CI `setup-python` 3.14, `PYTHON_VERSION` in the blueprints. Check
  every dependency installs and the suite passes before anything else changes.
- `uv` lockfile for Python dependencies; CI and local both install from it (M31). Pin ruff to
  the same version in CI and pre-commit; pin the MinIO image digest.
- Test infrastructure (T1, T3, T6): `time-machine` with a frozen-clock fixture (today fixed to a
  Tuesday, so no test depends on the weekday again); `factory_boy` factories for gym, coach,
  athlete, program, session log; one shared `conftest.py` (the copied `ex()`, `HX`, `program`
  helpers go); `DNS_NAME` set in test settings.
- `.env.example` lists every variable the code reads (M36).

Done when: the full suite passes on the frozen clock and new tests can use factories.

### Step 2 — Rules out of views and forms (medium; decision A)

For each rule below: write a service-level test, move the rule into the service module, make
the view call the service. The existing view tests must still pass unchanged.

| Rule | From | To |
|---|---|---|
| Dose validation (load limits by basis, rep scheme, RIR range, vary-by-set rows, warm-up shape) | `programs/forms.py` `PrescriptionForm.clean` | `programs/dose.py` (`validate_dose(data, unit) -> Dose` or errors) |
| Coach sign-up (user, gym, starter pack, defaults) | `accounts/views.py` | `accounts/services.py` `sign_up_coach` |
| Invite creation and acceptance (single-use, expiry, archived-athlete case, starting template) | `accounts/views.py` | `accounts/invites.py` |
| Check-in answer validation (scale, choice + Other, short answer, follow-up) | `workouts/views.py` `checkin` | `workouts/checkins.py` `answer` |
| Undo recording around every board edit | ~12 views in `programs/program_views.py` | inside the `programs/services.py` functions (they take the acting user) |
| Three sessions a day, session auto-naming | `program_views.day_add_session` | `programs/services.add_session` |
| Message sending and read-marking | `messaging/views.py` | `messaging/services.py` |
| Metric edits (weights as new rows, height and years replace) | `accounts/coach_views.py`, `accounts/views.py` | `accounts/metrics.py` |
| Template slot edits (kind, tags, default) in one transaction | `library/views.py` | `library/services.py` |
| Form-video start/confirm/review rules | `workouts/video_views.py` | `workouts/videos.py` |
| Bug report creation | `dashboard/bug_views.py` | `dashboard/services.py` |

**Full inventory (27 September).** The table above was the audit's list (H17). A read-only
pass over every view and form found more, in two kinds:

- **Writes and validation** (must move before the pages go, or the rule is lost): set saving
  (`SetForm` bounds, set number 1–50, the 24-hour edit window), finishing a session (RPE 1–10,
  comment ≤ 2000), issue reports and resolving them, warm-up ticks, units, gym settings, metric
  edits by the coach (1–1000, no future dates), PR use/dismiss, "max updates" preference, the
  exercise library (save rules: unique names ignoring case, `percent_of` limited to base lifts,
  archive/restore), categories, tags, tracked lifts (max 6, order), week types (colour check,
  archive-if-used), the check-in question builder (max 12 options, min 2, text required, push
  defaults), habits (name tidying), template meta and slot kinds (tag slots need tags and a
  matching default), saved weeks/sessions, the apply draft (days 0–6, mode), program start
  (1–52 weeks, active week types), program note, week add, form videos (upload checks, review
  sending feedback through messages), bug reports, feed dismiss/clear.
- **Read-side calculations** the screens show (the API will need them, reshaped): dashboard
  KPIs, roster rows and readiness, compliance bands, which week/day opens by default, session
  card states, where a session resumes, the player's time unit and target loads, the coach
  Sessions tab summaries, the library rail search and "recent" sort, template stats, the
  apply preview's ghost weeks.

Both kinds move into service modules with service-level tests, in the same way as the groups
above. This roughly doubles step 2 (see "Size").

Then go through the 222 view-level tests and sort each into:

- **Rule** — asserts a business rule or permission → make sure a service-level test covers it
  (new or existing); list the pairs in the PR description.
- **Permission** — "another coach gets a 404" → noted for S2's generated permission sweep
  (H15); the service layer gets the scoping test where the scoping lives in a service.
- **Page** — markup, HTMX headers, toasts, redirects → deleted in step 3 with nothing to replace.

Done when: every Rule test has a service-level twin, and the list of Permission tests is
recorded for S2.

### Step 3 — Delete the HTML layer (medium, mostly deletion)

- Delete: all `*views*.py` except the admin; `apps/*/urls.py` (the root `urls.py` keeps the admin
  at `ADMIN_PATH` and `/healthz`); forms whose rules moved in step 2; context processors;
  `accounts/middleware.py` (viewer time zone, a page concern); `dashboard/pwa.py`; `templates/`
  except `emails/`; `static/`; `tests/e2e/`; the view-level unit tests triaged as Page or
  covered by a service twin.
- Remove `django-htmx`, `django-template-partials`, `pytest-playwright`; remove the e2e and
  Playwright steps from CI.
- `render.yaml`: replaced by a placeholder noting the service is suspended until S8
  (`deploy/render.paid.yaml` stays as reference and is rewritten in S8).

Done when: `grep -r "htmx\|hx-\|x-data\|TemplateResponse" backend/` finds nothing outside
`emails/`, and the suite passes.

### Step 4 — Move to `backend/` (small)

- `git mv` `manage.py`, `config/`, `apps/`, `tests/`, `pyproject.toml`, the lockfile into
  `backend/`. `docker-compose.yml`, `docs/`, `mockup/`, `deploy/` stay at the root; `app/` (the
  Expo project) arrives in S4.
- Update the Makefile (`cd backend` targets), CI (`working-directory: backend`), ruff and pytest
  paths, `.gitignore`.

Done when: CI passes from the new layout and `make test` works from the root.

### Step 5 — Fresh schema (large)

Delete every migration; write the new models; generate one `0001` per app.

**Everywhere**

- `id = UUIDField(primary_key=True, default=uuid7)` via an abstract `core.models.Model`.
- Every synced table carries `athlete_id` (training data) or `gym_id` (library data), set by the
  services and checked in `save()`; a guard test lists the synced tables and fails if one lacks
  the column (S3 adds the trigger half of that guard).
- Check constraints (M28): sets ≥ 1; reps, RIR ≥ 0; `rir <= rir_max`; loads ≥ 0; percent 1–200;
  RPE 1–10; session RPE 1–10. Case-insensitive unique email (H12) and exercise names per gym.
- Indexes (H8): `SessionLog(athlete, -date, -started_at)`, `SessionExercise(exercise, session_log)`,
  `MaxEntry(athlete, exercise, -date)`, `BodyweightEntry(athlete, -date)`, partial
  `Notification(recipient, -created_at) WHERE cleared_at IS NULL`, partial
  `Message(thread) WHERE read_at IS NULL`.
- Training history is protected (H11, M27): `SessionLog.athlete`, `Program.athlete`, maxes,
  bodyweights, habits → `PROTECT`; `MaxEntry.set_log`, `Message.sender`, `Thread` coach side →
  `SET_NULL`. An `accounts.erase.erase_athlete(athlete)` service does privacy deletions
  explicitly, with a test.
- Cross-gym references refused in `clean()` and in the services (M26): a prescription's
  exercise, a slot's exercise and tags, `percent_of`, a max's exercise, a week's week type.

**People and relationships**

| Now | New |
|---|---|
| `Coach(user, gym, title, digest…)` | `CoachProfile(user, title, digest, last_digest_at)` + `GymMembership(coach, gym, role, started_at, ended_at)`, one active per coach |
| `Athlete(user, coach, gym, weight_class, competition…, units, archived_at)` | `AthleteProfile(user, weight_class, competition…, units, hide_history_before_link)` — no coach, no gym |
| (implicit in `Athlete.coach`) | `Coaching(coach, athlete, gym, status, started_at, ended_at)`, one active per athlete (partial unique); `gym` copied from the coach's membership when the link starts |
| `Athlete.archived_at` | ending the `Coaching` link (decision D) |
| `Invite(coach, …)` | `Invite(coach, gym, …)`; accepting creates the `Coaching` link |

*As built:* the classes keep the names `Coach` and `Athlete` (`user.coach`, `user.athlete`);
the renames would have touched every file for no change in meaning. `athlete.coach` and
`athlete.gym` remain, as read-only properties of the active link (else the latest one), and
`coach.gym` comes from the active membership.

Every "this coach's athletes" query goes through one service
(`accounts.coaching.athletes_for(coach)`), and every "may this coach see this athlete's data"
check through `accounts.coaching.can_view(coach, athlete, on=date)`, which applies the
history-visibility rule from the design.

**Other models** — same fields as today plus the rules above, and:

- `Thread` belongs to a `Coaching` link (decision C); `Message` gains `athlete_id`.
- `Notification` unique on `(recipient, athlete, kind, dedupe_key)` (decision F; the lookup fix is S1).
- `SessionExercise.prescribed` snapshots gain `"v": 1` (M29).
- `ratelimit.Counter(key, window_ends_at, count)` table (decision F; the limiter moves onto it in S1).
- `EditHistory` unchanged in shape here; day offsets are S1 (H2).

**Services, seed and admin follow the schema**

- Update every service to the new relations; the service tests from steps 1–2 are the safety net.
- `seed_demo` rebuilt on the new schema (Iron Ridge, Dana, the six mockup athletes and Riley on
  Meso 1), since S4–S5 use seeded data in place of coach-built programs. The "is it empty" rule
  (C6) is S1; the seed simply refuses to run if any gym exists unless `--reset` is passed.
- Admin registrations for the new models; `ensure_admin` unchanged.

Done when: `makemigrations --check` is clean, the suite passes, `seed_demo` runs twice without
error, and the guard test passes.

### Step 6 — Docs (small)

- Rewrite the project `CLAUDE.md` around the new layout (the phase 0–9 HTMX conventions go; the
  domain conventions that still hold stay).
- `docs/EXPO_MIGRATION.md`: record decisions A–F, and mark S0 done in "Handoff".
- `docs/AUDIT_2026-09.md`: mark the S0 items (H8, H11, H12, M26–M31, M36, T1, T3, T6) fixed.

## 4. What stays, what goes

| Stays | Goes |
|---|---|
| Models (rewritten), service modules (`sessions`, `prs`, `history`, `charts` data functions, `prescriptions`, `services`, `apply`, `undo`, `habits`, `alerts`, `digest`, `videos`, `metrics`, `starter`, `deletion`, `week_types`, `ratelimit`) | Views, urls (except admin and `/healthz`), UI-only forms, context processors, page middleware, `pwa.py` |
| Admin, management commands (`seed_demo`, `ensure_admin`, `cron`, `nightly`, `backup_check`, `storage_setup`), email templates | `templates/` (except `emails/`), `static/`, `tests/e2e/`, Page-type unit tests |
| Settings (production hardening, storage, email), `docker-compose.yml`, CI (unit tests, lint, migrations check) | The free-tier `render.yaml` (placeholder until S8), e2e CI steps |

`charts.py` draws SVG strings for the pages; its data functions (`e1rm_points`, `weekly`,
`chart_lifts`) stay as services, and the SVG drawing goes in step 3 (the app draws charts itself).

## 5. Risks

- **Step 2 is the long pole.** Eleven rule groups and 222 tests to triage. It is mechanical but
  easy to rush; the test pairs listed in the PR are the check.
- **Step 5 touches every service at once.** Doing it after steps 1–2 means it runs against a
  service-level suite that already covers the rules, which is the point of the order.
- **Denormalised `athlete_id`/`gym_id` can drift** if a row is created outside the services. The
  `save()` check plus the guard test catch it; S3's triggers rely on it.
- **Line numbers in the audit** stop matching after step 4; use them as pointers to logic.

## 6. Size

Roughly: step 1 one day (with the Python upgrade), step 2 seven to nine days (after the full inventory; it was estimated at three to four), step 3 one day, step 4 half a day,
step 5 three to four days, step 6 half a day — about three working weeks for one developer with AI
tools. The design rated S0 "M"; with the full rule extraction pulled in, it's closer to L.
