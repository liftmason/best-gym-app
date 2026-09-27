# Sub-project 5: the athlete's app

*27 September 2026 · plan for sub-project 5 of `docs/EXPO_MIGRATION.md` ("Screens", "Offline experience")*

S5 builds every training screen on the S4 foundation. Training is offline-first:
- **What screens read:** the device's own copy, through `useLive`.
- **How screens change things:** only through sync actions.
- **What needs a connection:** only first sign-in, the first sync, and history older than 12 months.

That means the phone runs the rules the server runs for what the athlete sees: the week, suggested loads, the player's steps, streaks, PRs and charts. Those rules are ported to `src/domain` and checked against the same cases as Python.

## 1. Decisions

**Accepted as recommended** (27 September 2026).

| # | Question | Recommendation | Why |
|---|---|---|---|
| A | One PR or two? | **Two.** S5a: the training loop (home and week, check-in, player, finish and done, issues, habits on home) with its actions. S5b: progress, messages, profile and metrics, onboarding after an invite, form videos, older history. | Like S4: S5a is the heart of the app and worth trying on a phone on its own. |
| B | The mockup is thinner than the rules | **The mockup decides look and wording; the rules decide behaviour.** Where the mockup has nothing, we follow the rules, with wording from the old athlete screens (`templates/app/` before S0, commit `87f060c^`). This covers warm-ups, supersets, timed sets, pounds, missed days, resuming and editing within the edit window. One wording fix: the mockup says "≈ X kg suggested from history", but the load comes from the athlete's max, so it says "≈ X kg from your max". | The mockup was a demo for Maya in kg. The backend (and the old app) already do the rest, and the phone must match the server or the athlete sees one thing offline and another after syncing. |
| C | Offline end-to-end tests | **Now:** Jest integration tests that drive the real screens against the real sync engine, on Node's SQLite, with the fake server, in CI. This covers a whole session logged offline, then synced. **Also:** an Android development build (EAS, free, needs no Google account) that Steven installs, with a written airplane-mode checklist. **Later:** automated Maestro flows in S8, once iOS builds exist too. | Maestro needs an emulator in CI, which is slow and flaky. The Jest tests exercise the same code paths on every push. |
| D | What the phone needs offline that sync doesn't carry (the athlete's units, time zone, name, coach) | **Keep the last `/me` answer on the device.** Profile changes (units, history visibility) stay online, as they are today; training numbers go through `metrics.update` offline. | "Today" and the unit shown depend on it. `/me` changes rarely, and adding user rows to sync would mean a new visibility rule for little gain. |
| E | Porting the rules | **One TypeScript module per Python one** in `src/domain`, with names that match. Every ported rule gets cases in `shared/rules-cases.json`, which pytest also runs against the Python. | This is the design's shared-cases mechanism. When the server's rule changes, the cases fail on whichever side hasn't followed. |

**Not in S5:**
- Things neither the mockup nor the rules have: a rest timer, adding or removing sets, per-set notes.
- A tap on a notification opens the screen it's about (S5b does this for messages and weeks).
- Apple and Google sign-in (accounts).

## 2. What's built

**Rules on the phone** (`src/domain`, S5a unless noted):
- Weeks and days: published weeks, picking the week and day, card states (today, done, missed, rest, upcoming, locked). Port of `workouts/week.py`.
- Sessions:
  - snapshots when a session starts, and reading them (`prescribed()` with `"v"`);
  - suggested load, plate rounding;
  - steps: warm-ups first, supersets, sections;
  - set validation limits and the edit window.
  - Port of `workouts/sessions.py`, `player.py` and `programs/dose.py` (display only).
- History:
  - e1RM, top sets, "last time", day status, streak, compliance;
  - PR candidates, shown as a celebration.
  - Port of `workouts/history.py` and `prs.py`. Coaches decide PRs, as now.
- Habits: due days, week counts, streaks, which days can be ticked. Port of `programs/habits.py`.
- Check-ins: cleaning answers. Port of `workouts/checkins.py`.
- Metrics (S5b): specs from the gym's tracked lifts, validation, current values. Port of `accounts/metrics.py`.
- Charts (S5b): e1RM points, phase bands, weekly volume. Port of `workouts/charts.py` (data only).

**Actions** (`src/sync/actions`), each with its local effect built from the rules above:
- S5a:
  - `session.start` (the snapshot, and the ids the phone chose)
  - `set.save`
  - `warmup.tick`
  - `checkin.answer`
  - `checkin.finish`
  - `session.finish`
  - `issue.report`
- S5b:
  - `metrics.update`
  - `video.attach`
- The engine learns to adopt the server's ids when `session.start` was already done on another device (the result S3 returns).

**Screens, S5a** (the mockup's look; tabs Week, Progress, Coach, Profile):
- **Home and week:**
  - The header shows block, week and gym.
  - The week strip with day states.
  - The day card for rest days, today, done, missed or locked days.
  - Today's habits, with ticking.
  - The coach's program note.
- **Check-in:**
  - The questions from the athlete's own set, scale and multiple choice with "Other".
  - A summary, and skip.
- **Session player:**
  - One exercise at a time, with steps for warm-ups and supersets.
  - The prescription banner: sets × reps, load, RIR, and "≈ X kg from your max".
  - Custom fields, the coach's note, and the demo link.
  - Set rows with load, reps or time, and RIR; the kg/lb unit comes from the athlete.
  - Ticks give haptics, and the screen stays awake.
  - Exit and resume, and "last time".
- **Finish:** session RPE, notes, and "Report an issue or pain" (a sheet).
- **Done:** stats, the streak, and PRs from this session.
- The sync status pill and refusal notices.

**Screens, S5b:**
- **Progress:** e1RM charts per tracked lift (react-native-svg), PRs, recent sessions, a session's detail, and "Load older sessions" (online).
- **Coach tab:** messages (`message.send`, offline) and the unread badge.
- **Profile:**
  - training metrics, editable offline (`metrics.update`);
  - units and history visibility (online);
  - devices;
  - sign out.
- **Onboarding** after an invite: "Your training numbers", with skip, and "You're all set".
- **Form videos:**
  - Record or pick on the phone (expo-image-picker); on the web, a file input.
  - The upload waits in its own queue until online (the signed URL comes from the API), then `video.attach`.
- **Notification taps** open the message thread or the week.

**Tests:**
- Shared rule cases in `shared/rules-cases.json`, run by both pytest and Jest.
- Screen tests with Testing Library.
- Offline integration tests (decision C): a full session logged with no connection, synced, and checked against the server's rules through the fake server.
- For the fake server, the parts that must match the server's behaviour (starting a session, saving a set) are checked against recorded answers from the real backend.

## 3. Steps

**S5a as built:**
- **The parity file** (`shared/parity.json`):
  - A backend test builds a realistic scenario with fixed ids and a still clock, and records what the server's rules show: week views, the player, history and PRs, habits, in kg and lb.
  - The app's tests must produce the same from the same rows: 55 checks.
  - Breaking any of several rules on purpose fails them.
  - Small pure rules (entered numbers, check-in answers) are also in `shared/rules-cases.json`.
- **Offline end to end** (decision C):
  - `flow.test.tsx` logs a whole session through the real screens with no connection, and keeps the phone's outbox (`shared/offline-session.json`).
  - `test_offline_parity.py` pushes that batch to the real server on the same scenario. Every action is accepted, and the server shows what the phone showed.
  - `docs/OFFLINE_CHECKLIST.md` is the manual check for a real phone.
- **Server changes:**
  - `/me` carries the gym's week start and the athlete's max-update setting.
  - Bootstrap sends each lift's best from before the phone's 12 months (`baselines`), so PRs count everything. Habit ticks come for 400 days, as far back as a streak counts.
  - History's order within a session is pinned, where the database's order was unspecified.
- **Server bugs fixed:**
  - Timed sets over 24 minutes were refused: the limit was 1440 in whatever unit, and phones send seconds.
  - Sets queued offline for a session another device had started were rejected as not found. The server now rewrites the rest of the batch to its ids, and the phone its outbox.
- **Training profile** (decision D): kept on the device from `/me`, so training mode opens offline.
- **Development build:** `eas.json` and `expo-dev-client` are ready. The build waits for the Android package name, which is permanent once the app is in the Play Store.

**S5a**
1. The rules: week, sessions and player, history and PRs, habits, check-ins. Cases shared with pytest.
2. The session actions and their local effects; the engine adopting server ids.
3. Home and week, habits, the program note; `/me` kept offline.
4. Check-in, player, finish, done, issue sheet.
5. Offline integration tests; the Android development build and the airplane-mode checklist; docs.

**S5b**
6. Metrics and charts rules; progress screens; older history.
7. Messages and the Coach tab; notification taps.
8. Profile, metrics editing, onboarding after an invite.
9. Form videos with their upload queue; docs.

## 4. Size

About 4–5 weeks: S5a 2–3, S5b 2.
