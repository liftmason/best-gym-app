# Sub-project 1: backend hardening

*26 September 2026 · plan for sub-project 1 of `docs/EXPO_MIGRATION.md`*

S1 fixes the backend bugs the audit (`docs/AUDIT_2026-09.md`) assigned to it, before the API
(S2) and sync (S3) are built on top. Every fix starts with a failing test.

## 1. Where the items stand

Each S1 item was checked against the code after S0 (26 September).

| Status | Items |
|---|---|
| Fixed in S0 already | C6 (`--if-empty` checks for any gym; this plan adds "or any user"), M5 |
| Partly fixed in S0 | H1 (the constraint includes the athlete, but `alerts.notify` still looks rows up without it, so one athlete's alert overwrites another's), T2 (login buckets and window expiry are tested; spoofing and the C1 case aren't), T4 (some of the named functions are tested) |
| Open | C1, C2, H2, H3, H9, H10, H13, H14, M1–M4, M6–M16, M25 (the password-reset half went with the pages), M32 |

## 2. Decisions

| # | Question | Recommendation | Why |
|---|---|---|---|
| A | **M12:** should "program runs out" count unpublished (draft) weeks? **Decided 26 September: published weeks only.** | **Count published weeks only**, and have the alert say when drafts exist ("Maya's published program ends Sunday; 2 draft weeks not yet published") | The athlete runs out of training they can see, so that's what should alert the coach. The draft note tells the coach the fix is one click. |
| B | **H9:** error reporting | Add `sentry-sdk`, switched on only when `SENTRY_DSN` is set. Creating the Sentry account waits for launch (S8). Until then, `ADMINS` gets error emails when email is configured. | Costs nothing until it's used, and nobody needs an account now. |
| C | **H10:** when the morning digest goes out | Send once per coach per gym-local day, **any time from 7 am onwards** if it hasn't gone yet. Record the send only after the email succeeds. One coach's failure doesn't stop the others. | A missed 7 am cron run (a deploy, a crash) today loses the whole day's digest. |

## 3. Steps

Each step is one or more commits on `s1-hardening`, with tests passing at the end of each.

**Step 1: rate limiter on the counter table (C1, C2, M25, T2).**
- `ratelimit.hit` becomes one `INSERT … ON CONFLICT … DO UPDATE` on `ratelimit.Counter`, with an explicit window end, so parallel workers can't lose counts and nothing expires early or gets culled.
- Keys are hashed, which fixes the long-key 500.
- Expired rows are deleted by the hourly cron.
- `metrics.remind` gets a limit.
- The database cache (`CACHES`) goes if nothing else uses it.
- Tests:
  - idle for longer than 5 minutes inside a 15-minute window still counts;
  - hundreds of junk keys don't reset a counter;
  - two connections counting at once;
  - `client_ip` with a spoofed `X-Forwarded-For`.

**Step 2: alerts (H1, M6, M12).**
- `notify`, `sync_prs` and `video_removed` look rows up by athlete.
- "Max updated" alerts are keyed by set and exercise, and `prs.apply` clears stale ones.
- "Runs out" follows decision A.
- Tests: two athletes with the same condition keep separate rows, and each clears on its own.

**Step 3: undo (H2, H3).**
- Snapshots store each session as a day offset from the week start, not a date, so shifted weeks restore correctly.
- *As built:* undoing a move across weeks finds the moved exercise anywhere in the program and brings it back (recording the target week too would have let an undo there delete the exercise outright).
- Old-format snapshots are discarded rather than half-restored.
- Tests: undo after duplicate, delete and apply-at shifts; undo of a cross-week move.

**Step 4: concurrency (H13, M7, M11).**
- `finish`, `save_set` and `prs.apply` run in one transaction with the session log row locked.
- Starting a program, adding a week and confirming an apply lock the athlete's program rows.
- A habit double tap is harmless.
- Tests: two database connections (a threaded test) for finish and start-program.

**Step 5: loads and compliance (M1–M4, M13).**
- One suggested-weight function (`sessions.target_kg` + `plate_round`) is used everywhere, including the coach's view.
- Only percentage loads are plate-rounded.
- `plate_round` rounds once.
- Compliance counts the calendar training week.
- `scheduled_days` gets a lower bound.
- Tests: 63.747 kg → 63.5; a fixed 101.25 kg stays 101.25; the current week's compliance ignores last week.

**Step 6: applying templates (M8, M9, M10).**
- A tag slot with no tags falls back to its default exercise.
- Same-day ties go to the most recently started session.
- A stale placement raises `CannotApply` instead of silently using the first option.
- Tests: multi-tag slots, ties, and a stale "at:" placement.

**Step 7: operations (H9, H10, H14, M32, C6).**
- Sentry per decision B, the digest per decision C, and the cron's steps and coaches each isolated.
- Timeouts: email 10 s; storage 3 s to connect, 10 s to read, 2 attempts.
- Production settings refuse to start with an unknown `EMAIL_PROVIDER`, a missing key, a `localhost` `SITE_URL` or `DEFAULT_FROM_EMAIL`, or a missing `DEMO_PASSWORD`.
- `seed_demo --if-empty` also checks for users.
- Both blueprints and `.env.example` updated.
- Tests: the digest after a missed 7 am run; a failed send is retried next hour; one coach failing doesn't block the next.

**Step 8: query counts (M14, M15, M16).**
- Habit streaks with a bounded look-back and batched queries.
- Bulk writes in `apply._write_week`, `copy_session` and reorders.
- `undo.restore` batched.
- `prs.pending` uses `DISTINCT ON`.
- Tests: `django_assert_max_num_queries` on each so they stay fixed.

**Step 9: the rest of T4 and docs.**
- Tests for `compliance`, `next_session_date`, `scheduled_days` and `backup_check`.
- Mark the items fixed in the audit.
- Update `CLAUDE.md` and the design doc's handoff.

## 4. Size

About 5–7 working days. The largest pieces are step 1 (the limiter and its concurrency tests),
step 3 (undo) and step 8.
