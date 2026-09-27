"""Query counts for the busiest services, so they can't creep back up (audit M14, M15, M16).
Each budget is the count after the fix with a little headroom; the count before is noted."""

import datetime

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.accounts.models import MaxEntry
from apps.exercises.models import Tag
from apps.library import apply
from apps.library import services as library
from apps.library.models import TemplateKind
from apps.programs import habits, undo
from apps.programs import services as program_services
from apps.programs.models import HabitLog, Prescription, WeekType
from apps.workouts import prs
from apps.workouts.models import SessionExercise, SessionLog, SetLog

from ..conftest import ex

pytestmark = pytest.mark.django_db
DAY = datetime.timedelta(days=1)
KEYS = ["sn", "cj", "bsq", "fsq", "psn", "pc", "pp", "rdl"]


def queries(fn):
    with CaptureQueriesContext(connection) as ctx:
        fn()
    return len(ctx.captured_queries)


def check(fn, budget, label):
    count = queries(fn)
    print(f"{label}: {count} queries")
    assert count <= budget, f"{label}: {count} queries, budget {budget}"


@pytest.fixture
def week_type(gym):
    return WeekType.objects.get(gym=gym, name="Accumulation")


@pytest.fixture
def program(athlete, coach, week_type):
    program = program_services.start_program(athlete, "P", athlete.today(), 2, week_type, by=coach.user)
    for week in program.weeks.all():
        program_services.set_published(week, True)
    return program


def fill(day, athlete, gym, n):
    for key in KEYS[:n]:
        program_services.add_prescription(day, ex(gym, key), athlete)


def test_habits_for_a_day(athlete, program, gym, frozen_clock):
    today = athlete.today()
    fill(program.weeks.first().days.get(date=today), athlete, gym, 1)
    for cadence in ("daily", "daily", "training", "training", "3x", "5x"):
        habit = habits.prescribe(athlete, f"Habit {cadence} {habits.active(athlete).count()}", "🍎", cadence)
        HabitLog.objects.bulk_create([HabitLog(habit=habit, date=today - i * DAY) for i in range(1, 120)])
    check(lambda: habits.for_day(athlete, today), 5, "habits.for_day, 6 habits")  # 3; was 53


@pytest.fixture
def template(coach, gym):
    """Four weeks of three sessions with six exercises each, some with tags and set overrides."""
    template = library.new_template(gym, TemplateKind.PROGRAM, coach.user)
    first = template.weeks.first()
    library.add_session(first)
    library.add_session(first)
    tag = Tag.objects.filter(gym=gym).first()
    for s in first.sessions.all():
        for key in KEYS[:6]:
            slot = library.add_slot(s, ex(gym, key))
            slot.set_overrides.create(set_number=1, rep_scheme="3")
        library.add_tag_slot(s, [tag]) if tag else None
    for _ in range(3):
        library.add_week(template)
    return template


def test_applying_a_template(template, athlete, coach):
    check(
        lambda: apply.confirm(athlete, template, [0, 2, 4], apply.DEFAULTS, "new:next", False, coach.user),
        90,  # 76; was 395
        "apply.confirm, 4 weeks x 3 sessions x 7",
    )


def test_copying_a_template_week(template):
    week = template.weeks.first()
    check(
        lambda: library.copy_week(week, template, 9), 32, "library.copy_week, 3 sessions x 7"
    )  # 26; was 233


def test_undo_on_a_full_week(program, athlete, coach, gym):
    week = program.weeks.first()
    for day in week.days.order_by("date")[:3]:
        fill(day, athlete, gym, 6)
    rx = Prescription.objects.filter(session__day__week=week).first()
    program_services.remove_prescription(rx, by=coach.user)
    check(lambda: undo.undo(week), 25, "undo.undo, 3 sessions x 6")  # 20; was 106


def test_moving_an_exercise_in_a_long_session(program, athlete, coach, gym):
    day = program.weeks.first().days.first()
    fill(day, athlete, gym, 8)
    last = Prescription.objects.filter(session__day=day).order_by("order").last()
    check(
        lambda: program_services.move_prescription(last, last.session, 0, by=coach.user),
        18,  # 15; was 23
        "move_prescription, 8 in the session",
    )


def test_pending_prs_read_one_row_per_exercise(athlete, gym):
    today = athlete.today()
    for key in ("sn", "cj"):
        MaxEntry.objects.create(
            athlete=athlete, exercise=ex(gym, key), date=today - 60 * DAY, kg=100, source="coach"
        )
    for i in range(30):
        date = today - i * DAY
        log = SessionLog.objects.create(
            athlete=athlete, date=date, finished_at=datetime.datetime.now(datetime.UTC)
        )
        for key in ("sn", "cj"):
            se = SessionExercise.objects.create(session_log=log, exercise=ex(gym, key), exercise_name=key)
            SetLog.objects.create(session_exercise=se, set_number=1, load_kg=101 + i, reps=1, done=True)
    with CaptureQueriesContext(connection) as ctx:
        found = prs.pending(athlete)
    assert sorted((c.exercise.name, c.set_log.load_kg) for c in found) == [
        ("Clean & Jerk", 130),
        ("Snatch", 130),
    ]
    assert "DISTINCT ON" in ctx.captured_queries[-1]["sql"]  # one row per exercise, not every set


def test_where_a_template_can_go_reads_a_fixed_number_of_queries(athlete, coach, week_type):
    # H7: placements asked, for every week, whether each later week had sessions.
    from apps.library import apply

    def count(weeks):
        program = program_services.start_program(
            athlete, "P", athlete.today(), weeks, week_type, by=coach.user
        )
        return queries(lambda: apply.placements(athlete)), program

    few, _ = count(3)
    many, _ = count(12)
    assert many == few
