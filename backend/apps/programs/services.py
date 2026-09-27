"""Everything that changes an athlete's program. Views (and, from sub-project 2, the API)
stay thin and call these.

Weeks are back-to-back from the program's start date, so inserting or deleting a
week shifts every later week (and its days) by seven days.

Board edits take the acting coach as `by=`: passing it records an undo step for the
week first (apps/programs/undo.py). Seeding, applying templates and tests leave it out."""

import datetime

from django.db import transaction
from django.db.models import F, Max, Q
from django.utils import timezone

from apps.core import errors
from apps.core import models as core

from . import undo
from .models import PrescribedSet, Prescription, Program, ProgramDay, ProgramSession, ProgramWeek
from .prescriptions import default_dose, keep_warmups_first

MAX_SESSIONS_PER_DAY = 3

WEEK = datetime.timedelta(days=7)


class HasLoggedSessions(errors.Conflict):
    """Logged sessions are history: their days can't be moved or deleted."""


class TooManySessions(errors.Conflict):
    """A day holds at most MAX_SESSIONS_PER_DAY sessions."""


class NotAllowed(errors.NotFound):
    """The change refers to something outside this athlete's program or gym (or archived)."""


def _record(week, by, label):
    if by is not None:
        undo.record(week, by, label)


def _has_logs(program, from_order):
    return ProgramSession.objects.filter(
        day__week__program=program, day__week__order__gte=from_order, logs__isnull=False
    ).exists()


def _empty_and_unused(session):
    """An unnamed session with no exercises and no log is just a rest day again."""
    return not session.name and not session.prescriptions.exists() and not session.logs.exists()


def locked_day_ids(week):
    """Days that clearing a week must leave alone: those with a completed session."""
    return set(
        ProgramDay.objects.filter(week=week, sessions__logs__finished_at__isnull=False)
        .values_list("pk", flat=True)
        .distinct()
    )


# ---------------------------------------------------------------- finding things (scoped to the athlete)


def active_program(athlete):
    return athlete.programs.active().first()


def athlete_week(athlete, week_id):
    """A week of the athlete's active program (ProgramWeek.DoesNotExist for anyone else's)."""
    return ProgramWeek.objects.select_related("program", "week_type").get(
        pk=week_id, program__athlete=athlete, program__active=True
    )


def athlete_day(athlete, day_id):
    return ProgramDay.objects.select_related("week__program").get(
        pk=day_id, week__program__athlete=athlete, week__program__active=True
    )


def athlete_session(athlete, session_id):
    return ProgramSession.objects.select_related("day__week").get(
        pk=session_id, day__week__program__athlete=athlete, day__week__program__active=True
    )


def athlete_prescription(athlete, rx_id):
    return Prescription.objects.select_related("exercise__percent_of", "session__day__week__week_type").get(
        pk=rx_id, session__day__week__program__athlete=athlete, session__day__week__program__active=True
    )


def board_week(program, today, week_id=None):
    """(weeks, week): the program's weeks and the one the board opens on: the one asked for,
    else the week containing today, else the last (after the program) or the first."""
    weeks = list(program.weeks.select_related("week_type"))
    if not weeks:
        return weeks, None
    if week_id:
        for w in weeks:
            if str(w.pk) == str(week_id):
                return weeks, w
    for w in weeks:
        if w.start_date <= today <= w.end_date:
            return weeks, w
    return weeks, (weeks[-1] if today > weeks[-1].end_date else weeks[0])


# ---------------------------------------------------------------- programs and weeks


class InvalidProgram(errors.Invalid):
    """With the message to show."""


MAX_PROGRAM_WEEKS = 52
MAX_NOTE = 2000


def start_new_program(athlete, name, first_day, weeks, week_type, by):
    """What a coach starts from the board: a name (up to 80 characters), 1 to 52 weeks, one
    of the gym's active week types. The athlete's current program ends and is kept."""
    name = " ".join((name or "").split())
    if not name or len(name) > 80:
        raise InvalidProgram("Give the block a name of up to 80 characters.")
    if not 1 <= int(weeks) <= MAX_PROGRAM_WEEKS:
        raise InvalidProgram(f"Between 1 and {MAX_PROGRAM_WEEKS} weeks.")
    if week_type.gym_id != athlete.gym.pk or week_type.archived:
        raise InvalidProgram("Pick one of your week types.")
    return start_program(athlete, name, first_day, int(weeks), week_type, by=by)


def set_program_note(program, note):
    """The program's note (goal, rest, nutrition) the athlete sees with it."""
    program.note = (note or "").strip()[:MAX_NOTE]
    program.save(update_fields=["note"])
    return program


def add_week_at_end(program):
    """A new last week of the same type as the last one (or the gym's first active type)."""
    from .models import WeekType

    last = program.weeks.order_by("-order").first()
    week_type = last.week_type if last else WeekType.objects.active().filter(gym=program.athlete.gym).first()
    if week_type is None:
        raise InvalidProgram("Add a week type in Settings first")
    return add_week(program, week_type)


def _create_week(program, order, week_type):
    start = program.start_date + WEEK * order
    week = ProgramWeek.objects.create(program=program, order=order, week_type=week_type, start_date=start)
    ProgramDay.objects.bulk_create(
        [ProgramDay(week=week, date=start + datetime.timedelta(days=i)) for i in range(7)]
    )
    return week


@transaction.atomic
def start_program(athlete, name, first_day, weeks, week_type, by):
    """Start a new program; the athlete's current one ends and is kept for history.
    `first_day` is snapped back to the gym's week-start day."""
    core.lock(athlete)  # program changes for one athlete run one at a time (audit M7)
    start = athlete.gym.week_start_for(first_day)
    athlete.programs.active().update(active=False, ended_at=timezone.now())
    program = Program.objects.create(athlete=athlete, name=name, start_date=start, created_by=by)
    for order in range(weeks):
        _create_week(program, order, week_type)
    return program


def _shift_weeks(program, from_order, by_weeks):
    """Move every week with order >= from_order (and its days) by `by_weeks`."""
    later = ProgramWeek.objects.filter(program=program, order__gte=from_order)
    delta = WEEK * by_weeks
    ProgramDay.objects.filter(week__in=later).update(date=F("date") + delta)
    later.update(order=F("order") + by_weeks, start_date=F("start_date") + delta)


@transaction.atomic
def add_week(program, week_type):
    core.lock(program.athlete)
    next_order = (program.weeks.aggregate(m=Max("order"))["m"] if program.weeks.exists() else -1) + 1
    return _create_week(program, next_order, week_type)


@transaction.atomic
def duplicate_week(week):
    """Insert a copy right after `week`; later weeks shift a week later. The copy is
    unpublished, so the coach can review it before the athlete sees it."""
    core.lock(week.program.athlete)
    if _has_logs(week.program, week.order + 1):
        raise HasLoggedSessions("Later weeks have logged sessions, so they can't move back a week.")
    _shift_weeks(week.program, week.order + 1, 1)
    copy = _create_week(week.program, week.order + 1, week.week_type)
    copy.focus_note = week.focus_note
    copy.save(update_fields=["focus_note"])
    new_days = {d.date - copy.start_date: d for d in copy.days.all()}
    for day in week.days.prefetch_related(
        "sessions__prescriptions__set_overrides", "sessions__prescriptions__tag_slot_tags"
    ):
        target = new_days[day.date - week.start_date]
        for session in day.sessions.all():
            _copy_session(session, target)
    return copy


def _copy_session(session, target_day, order=None):
    new = ProgramSession.objects.create(
        day=target_day, order=session.order if order is None else order, name=session.name
    )
    for rx in session.prescriptions.all():
        _copy_prescription(rx, new)
    return new


def _copy_prescription(rx, session):
    tags = list(rx.tag_slot_tags.all())
    overrides = list(rx.set_overrides.all())
    rx.pk = None
    rx.id = None
    rx._state.adding = True
    # Drop the original's prefetched relations, or .set() below compares against them and adds nothing.
    rx._prefetched_objects_cache = {}
    rx.session = session
    rx.save()
    rx.tag_slot_tags.set(tags)
    PrescribedSet.objects.bulk_create(
        [
            PrescribedSet(
                prescription=rx,
                set_number=s.set_number,
                rep_scheme=s.rep_scheme,
                reps=s.reps,
                load_value=s.load_value,
            )
            for s in overrides
        ]
    )
    return rx


@transaction.atomic
def delete_week(week):
    """Delete a week; every later week moves a week earlier so there's no gap."""
    core.lock(week.program.athlete)
    program, order = week.program, week.order
    if _has_logs(program, order):
        raise HasLoggedSessions(
            "This week or a later one has logged sessions, so it can't be deleted or moved."
        )
    week.delete()
    _shift_weeks(program, order + 1, -1)


@transaction.atomic
def clear_week(week, by=None):
    """Remove every session from the week, except days with a completed session."""
    _record(week, by, f"Clear {week.label}")
    locked = locked_day_ids(week)
    ProgramSession.objects.filter(day__week=week).exclude(day_id__in=locked).delete()
    return len(locked)


def set_week_type(week, week_type, by=None):
    """One of the gym's week types; an archived one only if the week already has it."""
    if week_type.gym_id != week.program.athlete.gym.pk or (
        week_type.archived and week_type.pk != week.week_type_id
    ):
        raise NotAllowed("That week type isn't available.")
    _record(week, by, f"Week type → {week_type.name}")
    week.week_type = week_type
    week.save(update_fields=["week_type"])
    return week


def set_focus_note(week, note, by=None):
    _record(week, by, "Edit focus note")
    week.focus_note = (note or "").strip()[:1000]
    week.save(update_fields=["focus_note"])
    return week


def set_published(week, published):
    week.published = published
    week.published_at = timezone.now() if published else None
    week.save(update_fields=["published", "published_at"])


# ---------------------------------------------------------------- sessions and prescriptions


def session_for(day, session_id=None):
    """The session to add to: the given one, else the day's first (created if needed)."""
    if session_id:
        return day.sessions.get(pk=session_id)
    return day.sessions.first() or ProgramSession.objects.create(day=day, order=0)


def add_session(day, name=""):
    next_order = (day.sessions.aggregate(m=Max("order"))["m"] or 0) + 1 if day.sessions.exists() else 0
    return ProgramSession.objects.create(day=day, order=next_order, name=name)


@transaction.atomic
def add_day_session(day, by=None):
    """Another session on the day (up to three). A day's sessions are named "Session 1",
    "Session 2"… once there's more than one; an unnamed first session gets its name then."""
    if day.sessions.count() >= MAX_SESSIONS_PER_DAY:
        raise TooManySessions(f"Up to {MAX_SESSIONS_PER_DAY} sessions a day")
    _record(day.week, by, f"Add a session on {day.date:%a}")
    if not day.sessions.exists():
        add_session(day, "Session 1")
    else:
        first = day.sessions.first()
        if not first.name:
            first.name = "Session 1"
            first.save(update_fields=["name"])
    return add_session(day, f"Session {day.sessions.count() + 1}")


def rename_session(session, name, by=None):
    _record(session.day.week, by, "Rename a session")
    session.name = " ".join((name or "").split())[:80]
    session.save(update_fields=["name"])
    return session


@transaction.atomic
def delete_session(session, by=None):
    """Remove a session and its exercises. A session an athlete has logged stays."""
    if session.logs.exists():
        raise HasLoggedSessions("This session has been logged, so it stays.")
    _record(session.day.week, by, f"Remove a session on {session.day.date:%a}")
    session.delete()


@transaction.atomic
def add_prescription(day, exercise, athlete, session_id=None, index=None, by=None):
    """Add `exercise` to the day (its first session unless one is given), at the end or,
    when dragged in from the library, at position `index`. The exercise must be one of the
    athlete's gym's, and not archived."""
    if exercise.gym_id != athlete.gym.pk or exercise.archived:
        raise NotAllowed("That exercise isn't in this gym's library.")
    if session_id:
        # Dropped onto a session: that session decides the day, anywhere in the same program.
        session = ProgramSession.objects.filter(pk=session_id, day__week__program=day.week.program_id).first()
        if session is None:
            raise NotAllowed("That session isn't in this program.")
        day = session.day
    else:
        session = session_for(day)
    _record(day.week, by, f"Add {exercise.name}")
    next_order = (session.prescriptions.aggregate(m=Max("order"))["m"] or 0) + 1
    rx = Prescription.objects.create(
        session=session, order=next_order, exercise=exercise, **default_dose(exercise, athlete)
    )
    if index is not None:
        move_prescription(rx, session, index)
    else:
        keep_warmups_first(session)
    return rx


def edit_prescription(rx, dose, by=None):
    """Apply a dose checked by apps/programs/dose.validate."""
    from . import dose as doses

    _record(rx.session.day.week, by, f"Edit {rx.exercise.name}")
    return doses.apply(rx, dose)


@transaction.atomic
def remove_prescription(rx, by=None):
    _record(rx.session.day.week, by, f"Remove {rx.exercise.name}")
    session = rx.session
    rx.delete()
    if _empty_and_unused(session):
        session.delete()


@transaction.atomic
def move_prescription(rx, target_session, index, by=None):
    """Put `rx` at position `index` in `target_session` (possibly another day of the same
    program)."""
    if target_session.day.week.program_id != rx.session.day.week.program_id:
        raise NotAllowed("Exercises move within one program.")
    _record(rx.session.day.week, by, f"Move {rx.exercise.name}")
    old_session = rx.session
    siblings = list(target_session.prescriptions.exclude(pk=rx.pk))
    index = max(0, min(index, len(siblings)))
    siblings.insert(index, rx)
    rx.session = target_session
    for order, item in enumerate(siblings):
        item.order = order
    Prescription.objects.bulk_update(siblings, ["session", "order"])  # one query (audit M15)
    keep_warmups_first(target_session)
    if old_session.pk != target_session.pk:
        if _empty_and_unused(old_session):
            old_session.delete()
        else:
            _renumber(old_session)


def _renumber(session):
    items = list(session.prescriptions.only("pk", "order"))
    changed = [item for order, item in enumerate(items) if item.order != order]
    for item in changed:
        item.order = items.index(item)
    Prescription.objects.bulk_update(changed, ["order"])


def swap_candidates(rx):
    """What `rx` can be swapped for: for a tag slot, exercises with every slot tag; otherwise
    the same category or a shared tag. Never archived ones or the exercise itself."""
    from apps.exercises.models import Exercise

    gym_exercises = Exercise.objects.filter(gym=rx.exercise.gym, archived=False).exclude(pk=rx.exercise_id)
    slot_tags = list(rx.tag_slot_tags.all())
    if slot_tags:
        for tag in slot_tags:
            gym_exercises = gym_exercises.filter(tags=tag)
        return gym_exercises.distinct().order_by("name")
    tags = list(rx.exercise.tags.all())
    return (
        gym_exercises.filter(Q(category=rx.exercise.category) | Q(tags__in=tags))
        .distinct()
        .select_related("category")
        .prefetch_related("tags")
        .order_by("name")
    )


def swap_exercise(rx, exercise, by=None):
    """Change the exercise, keeping the dose (sets, reps, load, notes, custom fields). With
    `by` (a coach's edit), only a swap candidate is allowed."""
    if by is not None and not swap_candidates(rx).filter(pk=exercise.pk).exists():
        raise NotAllowed("That exercise isn't a swap for this one.")
    _record(rx.session.day.week, by, f"Swap {rx.exercise.name} for {exercise.name}")
    rx.exercise = exercise
    rx.save(update_fields=["exercise"])
    return rx


def board_days(week, unit):
    """The week as the board shows it: each day with its sessions, each session's items in
    board order (warm-ups, sections, supersets) with their dose summary in `unit`, how many
    items the day has, and whether a session on it is done."""
    from apps.workouts.history import finished_session_ids

    from .prescriptions import board_items, summary

    done_ids = finished_session_ids(week.program.athlete)
    days = []
    for day in week.days.prefetch_related(
        "sessions__prescriptions__exercise", "sessions__prescriptions__set_overrides"
    ):
        day_sessions = []
        for session in day.sessions.all():
            items = board_items(
                session.prescriptions.all(),
                lambda rx: {"rx": rx, "summary": summary(rx, unit, list(rx.set_overrides.all()))},
            )
            day_sessions.append({"session": session, "items": items})
        days.append(
            {
                "day": day,
                "sessions": day_sessions,
                "count": sum(len(s["items"]) for s in day_sessions),
                "done": any(s["session"].pk in done_ids for s in day_sessions),
            }
        )
    return days


def week_type_choices(week):
    """The gym's active week types, plus the week's own if it has been archived since."""
    from django.db.models import Q

    from .models import WeekType

    return list(
        WeekType.objects.filter(gym=week.program.athlete.gym).filter(
            Q(archived=False) | Q(pk=week.week_type_id)
        )
    )
