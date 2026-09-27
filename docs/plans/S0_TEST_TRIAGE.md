# Sub-project 0, step 2: test triage

*27 September 2026 · part of `docs/plans/S0_RESTRUCTURE.md`*

Before the HTML pages are deleted (step 3), every unit test that reached the app through a
page was sorted into one of three kinds by a read-only review of all 222 of them:

- **Rule:** asserts a business rule. Each one now has a service-level test (listed in the
  step 2 commits). Where the rule lived only in a view or form, it was moved into a service
  first. The rules the review found without a service-level test are covered in
  `tests/unit/test_coverage_accounts.py`, `test_coverage_programming.py` and
  `test_coverage_training.py`.
- **Permission:** someone else's coach, gym or athlete (or nobody) is refused. These go with
  the pages; the lists below are the checklist for sub-project 2's generated permission sweep
  (audit H15).
- **Page:** markup, redirects, HTMX headers, toasts, form display. Deleted with nothing to
  replace.

The services refuse anyone else's data themselves (scoped lookups such as
`programs.services.athlete_week`, `accounts.services.coach_athlete`, `library.services.gym_template`,
and every write checks the gym), so the sweep tests the API wiring on top of them.

## Permission checks the API sweep must cover

**Who can reach what**

- Anonymous: every coach and athlete endpoint, bug reports.
- An athlete-only account: any coach endpoint. A coach-only account: any athlete endpoint.
- An archived athlete's detail (404), and signing in as one (no profile).

**Another coach (same gym or another gym) with someone else's ids**

- Athlete detail, metrics (view and edit, including an unknown metric key or an untracked
  lift), reminders, max-updates preference, PR decisions, check-in questions.
- Program board: weeks (publish, delete, duplicate, clear, settings, undo), days, sessions
  (add, rename, delete), prescriptions (edit, swap, move, remove), adding into another
  athlete's session, adding another gym's exercise, choosing an archived week type,
  swapping to a non-candidate exercise.
- Program start, program note, add week.
- Messages thread, the coach's feed rows (read, clear).
- Form videos (watch, review).
- Invites: revoking another coach's invite.

**Another gym's shared data**

- Exercises (edit, archive, restore, delete), categories and tags (rename, move, delete),
  tracked lifts (add, remove, move), week types (update, move, remove, restore), default
  check-in questions (every builder action), templates, saved weeks and sessions (every
  editor action, and the library lists), gym settings.
- Push defaults only reaches the coach's own active athletes.

**Athletes**

- Another athlete's session log (player, save set, warm-up tick, finish, issue, videos) and
  planned sessions (start); a draft week's session; a session of the athlete's ended program.
- Joining: an unknown, expired, revoked or accepted invite (410); an archived athlete; a
  signed-in user who is already an athlete.

## Rate limits the API must re-apply

These are decorators on the page views, so they go with the pages. The counters themselves
(`apps/ratelimit.py`: `hit`, `login_allowed`) have service-level tests; the limiter moves to a
counter table in sub-project 1 (audit C1, C2).

| What | Limit | Key |
|---|---|---|
| Sign-in (site and admin) | 10 per 15 min; 50 per address; 30 per email | address + email / address / email |
| Coach sign-up | 10 per hour | address |
| Joining through an invite | 10 per hour | address |
| Invites | 30 per hour | coach |
| Messages | 30 per minute | person |
| Form-video uploads | 20 per hour | athlete |
| Bug reports | 20 per hour | person |
| Password reset | 5 per hour (Django's view) | address; goes away with passwords (sub-project 2) |

## Behaviour that was page-only on purpose

- **Opening a thread marks messages read,** except when another site made the browser fetch
  it (`Sec-Fetch-Site: cross-site`). In the API, marking read is an explicit action (audit M20),
  so the header check goes away.
- **The dashboard syncs alerts on every load** (audit H4); in the API it moves to the cron job.
- **The apply preview's draft** lives in the Django session. `library.apply` works on a plain
  dict (`new_draft`, `update_draft`, `preview`), so the API can keep it wherever it likes.
