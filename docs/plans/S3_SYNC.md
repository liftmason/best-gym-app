# Sub-project 3: the sync backend

*27 September 2026 · plan for sub-project 3 of `docs/EXPO_MIGRATION.md` (section 3, "Sync protocol")*

S3 builds the server half of offline sync for athletes. The phone keeps a local SQLite copy
of the athlete's data, sends what the athlete did as named actions (push), and fetches what
changed (pull). Coaches stay online-only (the S2 API). The app half is S4–S5.

## 1. Decisions

| # | Question | Recommendation | Why |
|---|---|---|---|
| A | A row the athlete may not see any more (a week unpublished, a session deleted, a row moved out of scope): how does the phone learn? | Pull sends a **deletion marker** for any changed row the athlete can't see, whatever the reason. | One rule covers deletes, unpublishing and scope changes. A marker for a row the phone never had is harmless. |
| B | Ids for things created offline | **The phone chooses every id.** `session.start` carries the log's id and one id per exercise, matched to its prescription; sets, issues, messages and check-in answers carry their own. | A retried action can't make a duplicate (the design's rule), and the phone can refer to what it just made before it has synced. |
| C | Habits: the design lists `habit.toggle` | **`habit.set` with `{habit_id, date, done}`** instead. | A toggle replayed on top of fresh server state (the phone re-applies pending actions after each pull) flips the wrong way; "done on this date" means the same thing every time. |
| D | Silent push notifications (new week published, new message) | The backend half goes with **S4**: storing each device's Expo push token and sending the nudge. S3 only marks what changed. | Push tokens come from the app, so it can't be tried end to end before S4. Pull every 60 seconds covers it until then. |
| E | History older than 12 months (not in the phone's first copy) | An **online, paginated endpoint** for older sessions, in S3. | The design says older history is fetched on demand. It's a thin read over what exists. |

## 2. What's built

**The change log** (`apps/sync`):
- A `Change` table: a sequence number, the transaction id (`xid8`), the table, the row id, the operation, and the owning athlete or gym.
- A Postgres trigger on every synced table (the lists in `apps/core/sync.py`) writes a row for each insert, update and delete, including bulk `.update()` and `.delete()` calls, which bypass Django signals.
- A guard test fails if a synced table has no trigger.
- Publishing or unpublishing a week records a change for every row under it, so they arrive, or leave, then.

**Pull** (`GET /api/v1/sync/pull?cursor=…`):
- Returns the current state of each changed row the athlete may see, deletion markers for the rest, and a new cursor, in pages.
- **The athlete's scope:**
  - their own training data: sessions, sets, check-in answers, maxes, bodyweight, habits, issues, messages, videos, and their check-in questions;
  - their published program weeks, with their days, sessions and prescriptions;
  - their gym's library: categories, tags, exercises, tracked lifts, week types.

  Templates stay coach-only.
- **No skipped changes:** the cursor records a window of transaction ids. A page only ever includes transactions that finished before the oldest one still running. So a transaction that started earlier but commits later is still delivered, on the next pull. A test with two database connections checks exactly that.
- **Changing coach:** if an athlete moves to a coach in another gym, pull tells the phone to fetch its library afresh.

**Bootstrap** (`GET /api/v1/sync/bootstrap`):
- A consistent snapshot of the athlete's scope, with the last 12 months of history, and the cursor it was taken at.
- A test checks that bootstrap followed by pull matches the server.

**Push** (`POST /api/v1/sync/push`):
- Named actions, in order, each with the phone's id. Each calls the same service function, with the same checks, as the API.
- **Actions:** `session.start`, `set.save`, `warmup.tick`, `checkin.answer`, `session.finish`, `habit.set`, `issue.report`, `message.send`, `metrics.update`, `video.attach`.
- Each result is stored by action id: a repeated action returns its stored result and changes nothing.
- A permanent rejection (invalid, not allowed) marks that action failed, and the batch carries on. A temporary failure (a server error) stops the batch for a retry.
- The services learn to take the ids the phone chose (decision B).

**Versions:**
- The phone sends its local schema version. The server accepts the current and previous versions; anything older is told to update (426).
- `GET /api/v1/me/history?before=…` pages through sessions older than the phone's 12 months.

**Shared rules:**
- `shared/rules-cases.json` holds cases for e1RM, plate rounding and suggested weight.
- pytest runs them against the Python rules now; the app's tests will run the same file (S4).

**Audit:** M23's rate limit on issue reports goes on the `issue.report` action.

## 3. Steps

**Done (27 September 2026).** As built:
- **Decisions:** A–E accepted as recommended.
- **Check-ins:** `checkin.finish` joins the action list (finishing or skipping the check-in), which the design's list didn't cover.
- **Where an action happened:** each action carries the time the athlete did it (`at`). Rules about "today", like which habit days can be ticked, use that day, if it's within the last 30 days.
- **Trimming the log:** the change log keeps 90 days. A phone with an older cursor gets 410 and bootstraps again.
- **Sync tests:** these run with real transactions (`transaction=True`), because the cursor reads which transactions have committed.
- **What was proved:** the late-commit test was checked to fail with a naive cursor.


1. The change log, its triggers and their guard test; publishing and unpublishing mark their rows.
2. Pull: scope and visibility, deletion markers, the cursor window and paging, the late-commit test, the library refetch when the athlete's gym changes.
3. Bootstrap, the 12-month limit, older history on demand.
4. Push: the action registry and stored results, the ten actions, and ids from the phone in the services.
5. Schema versions, the shared rules cases, and docs.

## 4. Size

About 2–3 weeks. Steps 2 and 4 are the largest.
