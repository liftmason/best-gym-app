"""Applying a template (or saved week) to an athlete: plan, preview, confirm.

`plan()` is a dry run used by both the preview and the confirm, so what the coach
reviews is exactly what gets written. The template's sessions run in order across
the chosen training days; a new calendar week starts when the days run out (the
mockup's planWeeks). Each new week takes the type and focus note of the template
week its first session came from.

Tag slots resolve per athlete: in "recent" mode to the exercise with all the slot's
tags that the athlete did most recently, else the slot's default.

Where the weeks go (`placements()`):
- "append": after the program's last week;
- "at:<week id>": from a future week on; empty weeks from there are replaced and weeks
  with work move after the new ones;
- "new:this" / "new:next": a new program (the current one ends and is kept) starting
  this week or next. With no program, these are the only choices.
New weeks arrive unpublished unless the coach ticks "publish now".
"""

import datetime
from dataclasses import dataclass, field

from django.db import transaction
from django.db.models import F

from apps.core import models as core
from apps.exercises.models import Exercise
from apps.programs import services as program_services
from apps.programs.models import Prescription, ProgramDay, ProgramSession, ProgramWeek

from . import services
from .models import TemplateApplication, TemplateKind

DEFAULT_DAYS = {1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5]}
WEEK = datetime.timedelta(days=7)
RECENT, DEFAULTS = "recent", "default"


class CannotApply(Exception):
    pass


@dataclass
class PlannedSession:
    source: object  # TemplateSession
    exercises: list  # [(slot, resolved exercise)]


@dataclass
class PlannedWeek:
    week_type: object
    focus_note: str
    days: dict = field(default_factory=dict)  # day offset (0-6 from the week start) -> PlannedSession

    @property
    def session_count(self):
        return len(self.days)


def default_days(template):
    return DEFAULT_DAYS.get(template.sessions_per_week, [0, 2, 4])


def _recent_by_exercise(athlete):
    from apps.workouts.history import exercise_history

    # (date, session start): a later session on the same day counts as more recent.
    return {
        ex_id: (entries[0].date, entries[0].started_at)
        for ex_id, entries in exercise_history(athlete, limit=1).items()
    }


def resolve(slot, athlete_recent, mode, tag_pool):
    """The exercise a slot becomes for this athlete."""
    if not slot.is_tag or mode != RECENT:
        return slot.exercise
    tag_ids = {t.pk for t in slot.tags.all()}
    if not tag_ids:
        return slot.exercise  # no tags would match every exercise
    candidates = [e for e in tag_pool if tag_ids <= e.tag_ids and e.pk in athlete_recent]
    if not candidates:
        return slot.exercise
    # The most recently done; the oldest exercise on a tie.
    latest = max(athlete_recent[e.pk] for e in candidates)
    return min((e for e in candidates if athlete_recent[e.pk] == latest), key=lambda e: e.pk)


def plan(template, athlete, days, mode):
    """PlannedWeeks for applying `template` on the given day offsets."""
    days = sorted(set(days))
    if not days:
        return []
    recent = _recent_by_exercise(athlete) if mode == RECENT else {}
    pool = list(Exercise.objects.filter(gym=template.gym, archived=False).prefetch_related("tags"))
    for e in pool:
        e.tag_ids = {t.pk for t in e.tags.all()}
    weeks, current, used = [], None, 0
    for template_week in template.weeks.select_related("week_type").prefetch_related(
        "sessions__slots__exercise", "sessions__slots__tags", "sessions__slots__set_overrides"
    ):
        for session in template_week.sessions.all():
            if current is None or used >= len(days):
                current = PlannedWeek(template_week.week_type, template_week.focus_note)
                weeks.append(current)
                used = 0
            exercises = [(slot, resolve(slot, recent, mode, pool)) for slot in session.slots.all()]
            current.days[days[used]] = PlannedSession(session, exercises)
            used += 1
    return weeks


# ---------------------------------------------------------------- where the weeks go


@dataclass
class Placement:
    value: str
    label: str
    program: object = None  # None: a new program
    start_order: int = 0
    start_date: datetime.date = None
    replaced: list = field(default_factory=list)  # empty weeks that are replaced
    moved: list = field(default_factory=list)  # weeks with work that move after the new ones


def _has_work(week):
    return ProgramSession.objects.filter(day__week=week).exists()


def placements(athlete):
    today = athlete.today()
    gym = athlete.gym
    this_week = gym.week_start_for(today)
    options = []
    program = athlete.programs.active().first()
    if program:
        weeks = list(program.weeks.select_related("week_type"))
        if weeks and weeks[-1].end_date >= this_week:
            last = weeks[-1]
            options.append(
                Placement(
                    "append",
                    f"After {last.label} (append)",
                    program,
                    last.order + 1,
                    last.start_date + WEEK,
                )
            )
        for i, week in enumerate(weeks):
            if week.start_date <= today:
                continue
            later = weeks[i:]
            work = [w for w in later if _has_work(w)]
            empty = [w for w in later if w not in work]
            label = (
                f"Insert before {week.label} (it moves later)"
                if _has_work(week)
                else f"Start at {week.label} (empty — replaced)"
            )
            options.append(
                Placement(f"at:{week.pk}", label, program, week.order, week.start_date, empty, work)
            )
    name = "Start as a new program" if program else "New program"
    ends = " (ends the current one)" if program else ""
    options.append(Placement("new:this", f"{name} this week{ends}", None, 0, this_week))
    options.append(Placement("new:next", f"{name} next week{ends}", None, 0, this_week + WEEK))
    return options


def placement_for(athlete, value, fallback=False):
    """The placement `value` names. CannotApply if it isn't on offer any more (the week
    started since the preview, say), unless `fallback`: then the first option."""
    options = placements(athlete)
    placement = next((p for p in options if p.value == value), None)
    if placement is None:
        if not fallback:
            raise CannotApply("That start isn't available any more. Pick where the weeks go again.")
        placement = options[0]
    return placement


# ---------------------------------------------------------------- confirm


def _write_week(program, order, start_date, planned, publish):
    week = ProgramWeek.objects.create(
        program=program,
        order=order,
        week_type=planned.week_type,
        start_date=start_date,
        focus_note=planned.focus_note,
    )
    days = ProgramDay.objects.bulk_create(
        [ProgramDay(week=week, date=start_date + datetime.timedelta(days=i)) for i in range(7)]
    )
    pairs, tagged = [], []
    for offset, session_plan in planned.days.items():
        session = ProgramSession.objects.create(day=days[offset], order=0, name=session_plan.source.name)
        for i, (slot, exercise) in enumerate(session_plan.exercises):
            rx = Prescription(session=session, order=i, exercise=exercise)
            pairs.append((slot, rx))
            if slot.is_tag:
                tagged.append((rx, slot.tags.all()))
    # The week's exercises, their set overrides and tags in three queries (audit M15).
    services.copy_doses(pairs)
    services.add_tags(Prescription._meta.get_field("tag_slot_tags"), tagged)
    if publish:
        program_services.set_published(week, True)
    return week


@transaction.atomic
def confirm(athlete, template, days, mode, placement_value, publish, by):
    """Write the planned weeks and prescribe the template's habits (skipping ones the
    athlete already has); returns (program, first new week, habits added)."""
    core.lock(athlete)  # one program change at a time per athlete (audit M7)
    planned = plan(template, athlete, days, mode)
    if not planned:
        raise CannotApply(
            "Pick at least one training day."
            if not days
            else f"“{template.display_name}” has no sessions yet."
        )
    placement = placement_for(athlete, placement_value)
    n = len(planned)
    if placement.program is None:
        program = program_services.start_program(
            athlete, template.display_name, placement.start_date, 0, planned[0].week_type, by=by
        )
        if template.kind == TemplateKind.PROGRAM:
            program.source_template = template
            program.note = template.program_note
            program.save(update_fields=["source_template", "note"])
        start_order = 0
    else:
        program = placement.program
        start_order = placement.start_order
        later = ProgramWeek.objects.filter(program=program, order__gte=start_order)
        if ProgramSession.objects.filter(day__week__in=later, logs__isnull=False).exists():
            raise CannotApply("Those weeks have logged sessions, so they can't move.")
        for week in placement.replaced:
            week.delete()
        # Weeks with work move after the new ones, in order, back to back.
        for i, week in enumerate(
            ProgramWeek.objects.filter(program=program, order__gte=start_order).order_by("order")
        ):
            new_order = start_order + n + i
            delta = WEEK * (new_order - week.order)
            ProgramDay.objects.filter(week=week).update(date=F("date") + delta)
            ProgramWeek.objects.filter(pk=week.pk).update(order=new_order, start_date=F("start_date") + delta)
    first = None
    for i, planned_week in enumerate(planned):
        order = start_order + i
        week = _write_week(program, order, program.start_date + WEEK * order, planned_week, publish)
        first = first or week
    TemplateApplication.objects.create(template=template, athlete=athlete, applied_by=by, weeks=n)
    from apps.programs import habits

    added = sum(
        1
        for h in template.habits.all()
        if habits.prescribe(athlete, h.name, h.emoji, h.cadence, h.note, source_template=template)
    )
    return program, first, added


# ---------------------------------------------------------------- the preview draft
#
# While a coach previews, the draft is a plain dict (the page keeps it in the Django
# session; the API can keep it anywhere): {"template", "days", "mode", "start",
# "publish", "view", optionally "real_week"}. These functions build and change it.

APPLYABLE = [TemplateKind.PROGRAM, TemplateKind.WEEK]


def sources(gym):
    """What can be applied: the gym's program templates and saved weeks."""
    from .models import Template

    return Template.objects.filter(gym=gym, kind__in=APPLYABLE).order_by("kind", "name", "id")


def first_source(gym, kind):
    """The first template (kind "program") or saved week (kind "week") by name, or None."""
    from .models import Template

    wanted = TemplateKind.WEEK if kind == "week" else TemplateKind.PROGRAM
    return Template.objects.filter(gym=gym, kind=wanted).order_by("name", "id").first()


def new_draft(template, athlete):
    """A fresh preview: the template's default days, tag slots from recent lifts, the first
    placement, not published, showing the first ghost week."""
    return {
        "template": str(template.pk),
        "days": default_days(template),
        "mode": RECENT,
        "start": placements(athlete)[0].value,
        "publish": False,
        "view": 0,  # the ghost week shown; None shows the real week in "real_week"
    }


def draft_template(gym, draft):
    """The draft's template if it's still one of the gym's applyable ones, else None."""
    return sources(gym).filter(pk=draft.get("template")).first() if draft else None


def update_draft(draft, athlete, *, template=None, days=None, mode=None, start=None, publish=None, view=None):
    """The draft with whichever changes are given. A different template starts over but
    keeps the mode and placement; new days or a new placement go back to the first ghost
    week; `view` is a ghost week's index, or "week:<id>" for a real week."""
    if template is not None and str(draft["template"]) != str(template.pk):
        return new_draft(template, athlete) | {"mode": draft["mode"], "start": draft["start"]}
    draft = dict(draft)
    if days is not None:
        draft["days"] = sorted({int(d) for d in days if str(d).isdigit() and int(d) < 7})
        draft["view"] = 0
    if mode in (RECENT, DEFAULTS):
        draft["mode"] = mode
    if start:
        draft["start"] = start
        draft["view"] = 0
    if publish is not None:
        draft["publish"] = bool(publish)
    if view not in (None, ""):
        view = str(view)
        if view.isdigit():
            draft["view"] = int(view)
        else:
            draft["view"], draft["real_week"] = None, view.removeprefix("week:")
    return draft


def preview(template, athlete, draft):
    """What the board shows while previewing: the planned weeks as ghosts (label, start
    date), the one being shown, the placement, and the summary counts."""
    planned = plan(template, athlete, draft["days"], draft["mode"])
    placement = placement_for(athlete, draft["start"], fallback=True)  # shown, so it's honest
    first_order = placement.start_order if placement.program else 0
    ghosts = [
        {
            "index": i,
            "planned": week,
            "label": f"Wk {first_order + i + 1}",
            "start": placement.start_date + WEEK * i,
        }
        for i, week in enumerate(planned)
    ]
    view = draft.get("view")
    shown = ghosts[view] if isinstance(view, int) and 0 <= view < len(ghosts) else None
    summary = {
        "weeks": len(planned),
        "sessions": sum(w.session_count for w in planned),
        "tag_slots": sum(
            1 for w in planned for s in w.days.values() for slot, _e in s.exercises if slot.is_tag
        ),
        "habits": template.habits.count(),
        "replaced": len(placement.replaced),
        "moved": len(placement.moved),
        "new_program": placement.program is None,
    }
    return {"planned": planned, "placement": placement, "ghosts": ghosts, "shown": shown, "summary": summary}
