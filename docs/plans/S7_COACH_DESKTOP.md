# Sub-project 7: the coach's programming screens

*28 September 2026 · plan for sub-project 7 of `docs/EXPO_MIGRATION.md` ("Screens": coaching, desktop-first on web)*

S7 builds what a coach needs to write training:
- the program board;
- templates, saved weeks and saved sessions, and applying them with a preview;
- the exercise library, with its categories and tags;
- check-in questions;
- settings (the gym, week types, tracked lifts);
- billing.

These screens are desktop-first on the web. S6 built the coach's phone screens; S7 adds these around them in the same coaching layout.

The backend is ready. Every screen has endpoints (S2), and every rule is in the services. S7 is mostly screens, plus the small API gaps listed in section 2.

## Where the screens come from

The mockup still decides look and wording. It is simpler than the backend, though. It has none of these:
- warm-ups, sections, supersets or per-set rows;
- draft and published weeks;
- drag and drop;
- categories, tags, week types or units that can be edited;
- archiving exercises, or deleting templates;
- a billing page.

The old HTML coach screens had all of these, and the rules and their wording still exist (`git show 3a88157:templates/…`). As in S5 and S6, where the mockup has less, the screens follow the API and take the old screens' wording (decision C).

## 1. Decisions

**Accepted as recommended** (28 September 2026).

| # | Question | Recommendation | Why |
|---|---|---|---|
| A | One PR or two? | **Two.** **S7a:** the program board (with habits, the rail, the prescription editor, undo, publishing, and apply with preview). **S7b:** the Programming area (templates, saved weeks and sessions, the exercise library, categories and tags, default check-in questions) plus Settings and billing. | About three weeks of work. The board is the hard half and worth reviewing on its own. |
| B | Navigation | **The desktop sidebar gets the mockup's four items: Dashboard, Athletes, Programming, Settings.** Programming has the mockup's five tabs: Templates, Weeks, Sessions, Exercises, Check-in questions. On a phone, More lists Programming and Settings. | This matches the mockup. S6's phone tabs stay as they are. |
| C | Where the mockup has less than the API | **Follow the API, with the old screens' wording.** That covers everything in "Where the screens come from", plus the smaller features: the program note and focus note, short-answer questions, "% points heavier" when adding a template week, and the permanent-delete impact list. | Same as S5 and S6. These rules are built and tested; leaving them out would strand them. |
| D | Programming on a phone | **The screens work at any width, but a phone isn't a target yet.** The board goes from 7 columns to 4, 2, then a list, as in the mockup. Every edit is also a command in a menu ("Move to…", "Remove"), so nothing needs a mouse. On a phone, the athlete's Program tab keeps S6's week-at-a-glance and gets an "Edit program" button, and the other screens open from More. | The design says "nothing may assume a desktop", and phone programming is a later feature. Keeping every edit a command costs little now and makes that later work mostly design. |
| E | Drag and drop | **Drag on the web** (dnd-kit, in web-only files) to move and reorder exercises and to drop library exercises onto a day. **The same moves are in each card's menu** ("Move to…"), for keyboards, touch and phones. | As the design decided. The old app had drag and drop; the mockup has only click-to-add. |
| F | Billing page | **A "Plan" section in Settings,** shown only when billing is turned on (`BILLING_ENABLED`). It shows the plan, athletes used against the limit, and status. For the gym owner it has "Choose a plan" (Stripe Checkout) and "Manage billing" (the Stripe portal); other coaches see "Ask the gym owner". While billing is off (as now), the section is hidden. | The mockup and the old app have no billing page. Stripe hosts the payment pages, so ours is a summary plus two buttons. |
| G | When payment has lapsed | **A banner on programming screens: "Your plan has lapsed, so programming is read-only."** The edit controls are disabled from the coach's `entitlements.programming`, so nobody is surprised by a 402 error. Athletes are never affected. | The API already refuses those writes. The screens should say so up front. |
| H | Starter exercises for an existing gym | **Add an "Add starter exercises" button to the library** (with a new `POST /exercises/starter-pack`). It installs a pack's missing exercises, using the same function as sign-up. | Today a coach who chose "Start empty" at sign-up can never add a pack later. The function already exists and only adds what's missing. |

**Not in S7:**
- polishing the board for phones (a later feature);
- offline for coaches;
- Playwright tests for coach flows (S8);
- things neither the old app nor the mockup had: copy/paste, redo, duplicating a day or session, reordering or renaming weeks, listing past programs.

## 2. What's built

### S7a: the program board (athlete › Program)

**No program yet:**
- "Start a program for {name}": block name, starting week, number of weeks, week type.
- Or "Apply a template" / "Apply a saved week".
- Starting over an existing program warns that the current program ends and is kept in the athlete's history.

**Header:**
- The program name, its start date and number of weeks.
- "Start a new program", "Save as template", and a "Columns" / "List" toggle, remembered on the device.
- A collapsible program note.

**Week strip:**
- Each week shows its type colour and label, a "live" chip when published, its dates, and "this week".
- Three action tabs: "+ Template", "+ Saved week", "+ Week".

**Week toolbar:**
- The status: "Live — {name} sees edits immediately" or "Draft — not visible to {name}".
- "Undo: {label}" (also Ctrl/Cmd+Z).
- Week type; "Duplicate week", "Save week", "Clear week" and "Delete week", each with the old confirmations.
- "Publish to {name}" / "Unpublish".
- The focus note, shown on the athlete's home screen.

**The board:**
- Seven days, and up to three named sessions a day.
- Exercise cards with the dose summary, warm-up and section headings, and superset labels (A1/A2).
- Click a card to edit it; drag, or use its menu, to move it; ✕ to remove it.
- "+ add exercise" selects a day for the rail.
- Logged days show "✓ done". The rules that protect logged sessions surface as their error messages.

**The prescription editor:**
- Sets, reps (free text), RIR, load basis and load, with the "≈ 63 kg of Snatch max 82 kg" hint.
- A note to the athlete.
- "Vary by set" rows.
- The warm-up drill switch.
- Section heading and note; superset.
- Custom fields (up to 8).
- "Swap exercise", which keeps the dose.
- "Remove from day".

**The library rail:**
- Search, tag filters, "+ New" exercise.
- For each exercise: the athlete's history line with a sparkline and trend, and a popover with their log.
- Sort by last done or A–Z.
- "+" adds to the selected day; on the web you can also drag.

**Habits:**
- The habits card below the board: the athlete's habits with streaks and the last seven days, "Prescribe habit", and "Stop prescribing".

**Apply with preview:**
- Opened from the week strip, from the empty state, and later (S7b) from Programming.
- An apply bar with:
  - the source;
  - training days (with defaults from the template's sessions per week);
  - tag slots from recent lifts or template defaults;
  - where it starts;
  - "Publish now".
- The summary line.
- Dashed preview weeks in the strip, each showing a read-only board.
- "Cancel" and "Confirm apply".
- The preview is `POST /apply/preview`, which writes nothing; the board is locked while it is open.

**Save to library:** save a week, a session or the whole program, with a suggested name and the note "Library items are copies…".

### S7b: Programming, Settings and billing

**Programming › Templates / Weeks / Sessions:**
- Cards as in the mockup: type pill, "used N×", stats, the phase strip.
- "Open", and "Apply to athlete…" / "Add to athlete…" (pick an athlete, then the preview on their board).
- "+ New".
- Empty states.

**The template editor (templates, saved weeks and saved sessions):**
- Name, description, "Written for" and the program note.
- The summary line, including the calendar weeks.
- **Weeks:**
  - type;
  - "+ Session", "+ From saved session", "Save week", duplicate and remove;
  - "+ Add week — copy of the last week, N % points heavier";
  - "+ From saved week".
- **Sessions:** rename, save to the library, remove.
- **Slots:**
  - fixed or tag-based, with the dose;
  - "+ Tag slot (N qualify)" from the rail's tag filter;
  - drag or "Move to…" between sessions.
- **Habits** that come with the template.
- "Delete", with the note that programs it was applied to keep their weeks.
- Changes save as they are made. Templates have no undo, and the screen says so.

**Programming › Exercises:**
- The library table: search (name, tag or cue), tag filters, "Show archived".
- Columns: exercise and cue, category, tags, "% from", demo video.
- New and edit:
  - name, category, "Measured in", "Percentages worked from", tags, YouTube link, cue;
  - the warm-up drill switch.
- Archive (with the tracked-lift warning) and Restore.
- "Delete…" for archived exercises, showing what goes and what stays.
- "Categories & tags":
  - ordered categories: rename, and delete with "Move exercises to";
  - tags: rename and delete.
- "Add starter exercises" (decision H).

**Programming › Check-in questions:**
- The defaults: 1–10 scale, multiple choice and short answer.
- Edit the wording and labels, reorder, add and remove options, delete.
- "Push defaults to all my athletes (N)", after a confirmation.
- The athlete's own copy uses the same editor, on their Metrics tab, with "Reset to defaults".

**Settings:**
- **Gym:**
  - name and time zone;
  - units ("New athletes start with this unit…");
  - "Training weeks start on";
  - your title;
  - the morning digest.
- **Tracked lifts:** up to 6, reorder, add, stop tracking.
- **Week types:** colour, name, description, "used by N weeks", reorder; remove, which archives a type in use; restore.
- **Plan** (decision F).

### Backend gaps (small)

- **`POST /exercises/starter-pack`** (decision H).
- **Clear week** should say how many completed days it kept, for the toast "Week cleared — N completed days kept". Today the service returns the number and the API drops it.
- **Tag slots:** a new tag slot should go where it's put in the template editor. The API ignores `index` for tag slots today.
- **The template editor's rail:** `GET /exercises` has everything it needs (the template editor has no athlete, so no history), so no new endpoint.
- **Anything else the screens find:** fixed and listed under "As built".

### Tests

- Screen tests against the fake API client (`useFakeApi`), as in S6:
  - the board: add, edit, move, remove, undo, publish;
  - the prescription editor's rules and error messages;
  - apply: preview and confirm;
  - the template editor;
  - the library;
  - questions;
  - settings;
  - the lapsed-plan state.
- Drag and drop is tested through the commands it calls; each card's menu calls the same commands.
- Backend tests for the new endpoint and the gaps; the permission sweep covers them.

## 3. Steps

**As built (S7a):**
- **Where the board is:** the athlete's Program tab. At 960 px and wider it is the board; on a phone it shows this week at a glance with "Edit program", which opens the same board (decision D). The athlete's top bar has "Edit program" on a wide screen.
- **Commands:** every change goes through `src/coaching/program/commands.ts`. Buttons, each card's menu ("Move to…", "Remove"), drag and drop, and Ctrl/Cmd+Z all call the same commands. `moves.ts` decides what a drop means (a position among the target's other exercises).
- **Drag and drop:** web-only (`dnd.web.tsx`, dnd-kit). The drag overlay renders in a portal, because a transformed ancestor in the navigator offset it and drops missed.
- **UI kit:** toasts (`useToast`, with the old screens' wording) and a picker (`Select`, `Segmented`).
- **Backend changes, each with a test:**
  - **A privacy bug in the rail:** it read the athlete's whole history, so a new coach saw lifts from before their link even when the athlete hides them. It now passes `visible_from`, like every other coach read.
  - The rail returns each exercise's dated log, for the history popover.
  - "Clear week" says how many completed days it kept.
  - The apply preview names the weeks it would replace or move, not just their counts.
  - A move can target a day: dropping onto a rest day gives it one unnamed session.
  - **A bug in the published API schema:** OpenAPI keeps one schema per name, and three names had two different classes (`Move`, `WeekSettings`, and `/me`'s `PlanOut`). The app's types were wrong for `/me`'s plan. They are renamed, and a test fails when two schemas share a name but not their fields.
- **Checked in a real browser** (Playwright, against a separate seeded database): the board at 1440 and 1100 px, list layout, the editor, a drag, and a phone at 420 px. Also editing, undo with Ctrl+Z, habits, saving a week, and applying with confirm.
- **Moved to S7b:** the sidebar's Programming and Settings items, and "+ New" exercise in the rail. Both need S7b's screens.

**S7a:**
1. The lapsed-plan banner and the query hooks.
2. The board: start a program, the week strip, the toolbar, the day columns, publish, notes, undo.
3. The prescription editor and swap; the rail; adding, moving and removing (commands, then drag and drop on the web).
4. Habits; saving to the library; apply with preview.
5. Docs; hand over S7a.

**S7b:**
1. Programming: the lists and the template editor (weeks, sessions, slots, tag slots, habits, apply from here).
2. The exercise library; categories and tags; starter exercises.
3. Check-in questions (defaults and per athlete).
4. Settings: gym, tracked lifts, week types, plan.
5. Docs; hand over S7b.

## 4. Size

About three weeks: S7a about 1.5 weeks, S7b about 1.5 weeks.
