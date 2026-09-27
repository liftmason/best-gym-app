# Sub-project 6: the coach on a phone

*27 September 2026 · plan for sub-project 6 of `docs/EXPO_MIGRATION.md` ("Coach side, scope B", "Screens")*

S6 builds the coach's screens for the phone:
- the dashboard and attention feed;
- the roster, and inviting athletes;
- an athlete's overview, sessions, metrics and messages;
- form-video review and issue resolution.

Coaches work online (design decision), so these screens read and write through the S2 API with TanStack Query; there's no local database or sync for coaches. The endpoints exist and return display-ready values. S6 is screens, plus small API gaps found on the way.

The same screens serve the web. S7 adds the desktop-first programming screens (the board, templates, library, settings) around them.

## 1. Decisions

**Accepted as recommended** (27 September 2026).

| # | Question | Recommendation | Why |
|---|---|---|---|
| A | One PR or two? | **One.** | About two weeks of screens over endpoints that exist, with no offline rules to port. |
| B | Navigation on a phone | **A bottom tab bar: Today, Athletes, Messages, More.** On a wide screen (web, ≥ 960 px), the mockup's sidebar. | The mockup's phone preview is its desktop sidebar squeezed into an icon bar across the top. That's a quick demo, not a phone design. A bottom bar matches the athlete app and is where thumbs are. The desktop keeps the mockup's look. |
| C | Where the mockup has less than the API: PR decisions ("use as new max" or "keep current"), resolving issues, reviewing videos with feedback, archiving an athlete, marking feed items read, and the alert kinds the mockup lacks (missed sessions, missing metrics, week published) | **Follow the API**, with wording from the old coach screens (`templates/coach/` before S0), as S5 did with the old athlete screens. | The backend already enforces these rules; leaving them out would strand them. |
| D | Messages | **A Messages tab listing the athletes whose threads have unread messages, newest first,** from a small new endpoint (`GET /threads`). Each opens the athlete's thread. | Today a coach only finds messages through the feed or by opening each athlete. The mockup's per-athlete tab stays. |
| E | Programming on a phone | **Not in S6.** The athlete's Program tab shows this week at a glance and says programming is on a computer for now (S7 builds it; phone programming is a later feature). | Scope B, as the design decided. |
| F | Form videos | **Played in the app** (expo-video, which works in Expo Go and on the web), from the signed view URL. Then "Reviewed" with optional feedback, which goes to the athlete as a message. | The earlier decision allowed coaches to play form videos in the page. The athlete app keeps YouTube links for demos. |
| G | Push taps for coaches | **Open the athlete, on the right tab:** messages for a message, sessions for an issue or a video. | Deferred from S5 until these screens existed. |

**Not in S6:**
- the program board, templates, apply, the exercise library, check-in question editing, settings, and billing (S7);
- offline for coaches (the design keeps coaches online);
- Apple/Google sign-in (accounts).

## 2. What's built

**Shell:**
- A coaching layout with the tab bar on a phone, and the sidebar on a wide screen.
- The header shows the gym and the unread count.
- "Switch to Training" for coaches who also train.

**Today (the dashboard):**
- A greeting and today's date.
- The key numbers: active athletes, 7-day compliance with its change, sessions this week, and athletes who need programming.
- **"Needs your attention":** the feed.
  - Every alert kind, with the mockup's icons and tints; tapping one opens the athlete on the right tab and marks it read.
  - "Clear read"; paging for more.
- **"Sessions today":** who trains today, and done or not.
- **"Recent sessions":** the last 7 days, with RPE and any issue.

**Athletes (the roster):**
- One row per athlete: name, weight class and next competition, this week's type, compliance, last session, and alert dots.
- Sorting (needs attention first, name, compliance, next competition) and a filter.
- "Invite athlete": by email or by a link to share (the phone's share sheet), with an optional starting template. Also pending invites, with resend and revoke.

**An athlete:**
- **Header:** week, weight class, streak, the tracked lifts' maxes, compliance.
- **Overview:**
  - The e1RM chart, with phase bands, bodyweight and a lift chooser.
  - Weekly volume and compliance.
  - Recent check-ins; this week at a glance; lifetime PRs.
  - **PRs waiting for a decision:** use as the new max, or keep the current one.
- **Sessions:**
  - Each session: the check-in, the work logged, RPE and notes, issues (with Resolve), and form videos (play, feedback, Reviewed).
  - A filter by exercise and a date range; more on scroll.
- **Metrics:**
  - Each metric, with its source and date.
  - Editing one (entered in the gym's unit), and "Remind athlete".
  - The athlete's max-updates setting: automatic, or coach approves.
- **Messages:** the thread; sending; marking read when shown.
- **Program:** this week at a glance, and a note that programming is on a computer (decision E).
- **Archiving** the athlete, with a confirmation.

**Backend:**
- `GET /threads`: the coach's threads with unread counts (decision D).
- Any other gap the screens find, listed in "as built".

**Tests:**
- Screen tests against a fake API client, with answers recorded from the real API's schema.
- The permission sweep covers the new endpoint.
- Playwright for coach flows on the web stays for later (S8).

## 3. Steps

1. The coaching shell (tabs and sidebar); API hooks; Today (the key numbers, the feed, sessions today, recent sessions).
2. Athletes: the roster, sorting and filtering, invites.
3. An athlete: header, Overview (charts, check-ins, the week, PRs and decisions), Program glance, archiving.
4. Sessions (issues, video playback and review), Metrics, Messages; `GET /threads` and the Messages tab; push taps.
5. Docs.

## 4. Size

About 2 weeks.
