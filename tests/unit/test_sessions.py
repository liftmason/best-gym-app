"""Phase 4: the athlete's session flow, what it records, and what's derived from it."""

import datetime
from decimal import Decimal

import pytest

from apps.accounts.models import MaxEntry
from apps.exercises.deletion import delete_exercise, deletion_impact
from apps.programs import services
from apps.programs.models import LoadBasis, PrescribedSet, ProgramDay, WeekType
from apps.workouts import history, sessions
from apps.workouts.models import SessionExercise, SetLog

from ..conftest import ex

pytestmark = pytest.mark.django_db
DAY = datetime.timedelta(days=1)


@pytest.fixture
def today(athlete):
    return athlete.today()


@pytest.fixture
def program(athlete, coach, today):
    """Three published weeks starting the week before this one."""
    week_type = WeekType.objects.get(gym=coach.gym, name="Accumulation")
    program = services.start_program(athlete, "Comp Prep", today - 7 * DAY, 3, week_type, by=coach.user)
    for week in program.weeks.all():
        services.set_published(week, True)
    return program


def day_on(program, date):
    return ProgramDay.objects.get(week__program=program, date=date)


def plan(program, date, athlete, *items):
    """Add (exercise, sets, reps, basis, value) prescriptions on `date`; returns the session."""
    day = day_on(program, date)
    for exercise, sets, reps, basis, value in items:
        rx = services.add_prescription(day, exercise, athlete)
        rx.sets, rx.rep_scheme, rx.reps, rx.load_basis, rx.load_value = sets, str(reps), reps, basis, value
        rx.save()
    return day.sessions.get()


@pytest.fixture
def snatch_day(program, athlete, gym, today):
    """Today: snatch 3×2 @ 80% and back squat 2×5 @ 100 kg; snatch max 100 kg."""
    MaxEntry.objects.create(
        athlete=athlete, exercise=ex(gym, "sn"), date=today - 30 * DAY, kg=100, source="coach"
    )
    return plan(
        program,
        today,
        athlete,
        (ex(gym, "sn"), 3, 2, LoadBasis.PERCENT, Decimal("80")),
        (ex(gym, "bsq"), 2, 5, LoadBasis.WEIGHT, Decimal("100")),
    )


@pytest.fixture
def questions(athlete):
    """The mockup's two default check-in questions, copied to the athlete as on joining."""
    from apps.workouts.models import copy_defaults_to, install_default_questions

    install_default_questions(athlete.gym)
    copy_defaults_to(athlete)


def log_sets(log, *rows):
    """rows: (exercise order, set number, kg, reps)."""
    exercises = list(log.exercises.all())
    for order, number, kg, reps in rows:
        sessions.save_set(
            exercises[order],
            number,
            load_kg=Decimal(kg),
            reps=reps,
            duration_seconds=None,
            rir=None,
            done=True,
        )


# ---------------------------------------------------------------- derived values


def test_e1rm_and_best_set():
    assert history.e1rm(Decimal("100"), 3) == Decimal("110.00")
    assert history.e1rm(Decimal("100"), None) is None
    entry = history.Entry(datetime.date(2026, 9, 1), 1, 1, 1, "Snatch")
    entry.sets = [SetLog(load_kg=Decimal("80"), reps=3), SetLog(load_kg=Decimal("85"), reps=1)]
    assert entry.top.load_kg == 85  # heaviest
    assert entry.best_e1rm == Decimal("88.00")  # 80 × 3 beats 85 × 1


def test_sets_text_groups_like_a_prescription():
    sets = [SetLog(load_kg=Decimal("64"), reps=2) for _ in range(3)] + [SetLog(load_kg=Decimal("66"), reps=1)]
    assert history.sets_text(sets, "kg") == "3×2 @ 64 kg, 1×1 @ 66 kg"
    assert history.sets_text([SetLog(reps=10), SetLog(reps=10)], "kg") == "2×10"


def test_plate_rounding_is_in_the_athletes_unit():
    assert sessions.plate_round(Decimal("63.96"), "kg") == Decimal("64")
    assert sessions.plate_round(Decimal("63.70"), "kg") == Decimal("63.5")
    assert sessions.plate_round(Decimal("63.96"), "lb") == Decimal("140")  # 141.0 lb → nearest 2.5


# ---------------------------------------------------------------- starting a session


def test_starting_snapshots_the_prescription(athlete, snatch_day):
    rx = snatch_day.prescriptions.first()
    PrescribedSet.objects.create(prescription=rx, set_number=1, load_value=Decimal("75"))
    log = sessions.start(athlete, snatch_day)
    assert sessions.start(athlete, snatch_day) == log  # starting again resumes it
    se = log.exercises.first()
    assert se.prescribed["load_value"] == "80.00" and se.prescribed["max_kg"] == "100.00"
    assert se.prescribed["set_overrides"][0]["load_value"] == "75.00"
    # The coach edits the day afterwards: "asked for" doesn't change.
    rx.load_value = Decimal("90")
    rx.save()
    se.refresh_from_db()
    assert sessions.prescribed(se).load_value == Decimal("80.00")
    assert log.name == "Snatch + Back Squat" and log.week_type.name == "Accumulation"
    assert not log.checkin_skipped


# ---------------------------------------------------------------- check-in


# ---------------------------------------------------------------- the player


# ---------------------------------------------------------------- finishing and editing


# ---------------------------------------------------------------- PRs and maxes


def _finish_heavy(athlete, snatch_day, kg="105"):
    log = sessions.start(athlete, snatch_day)
    log_sets(log, (0, 1, "80", 2), (0, 2, kg, 1), (1, 1, "140", 5))
    sessions.finish(log, 9, "")
    return log


def test_streak_counts_back_from_today(athlete, gym, program, today):
    s1 = plan(program, today - 2 * DAY, athlete, (ex(gym, "cj"), 1, 1, LoadBasis.NONE, None))
    s2 = plan(program, today - DAY, athlete, (ex(gym, "cj"), 1, 1, LoadBasis.NONE, None))
    plan(program, today, athlete, (ex(gym, "cj"), 1, 1, LoadBasis.NONE, None))
    sessions.finish(sessions.start(athlete, s2), 7, "")
    assert history.streak(athlete, today) == 1  # today isn't missed yet; the day before yesterday was
    sessions.finish(sessions.start(athlete, s1), 7, "")
    assert history.streak(athlete, today) == 2


# ---------------------------------------------------------------- the coach's side


def test_deleting_a_logged_exercise_keeps_the_history_by_name(athlete, gym, snatch_day):
    log = _finish_heavy(athlete, snatch_day)
    squat = ex(gym, "bsq")
    squat.archived = True
    squat.save()
    impact = deletion_impact(squat)
    assert impact["logged"] == 1 and impact["logged_by"] == ["Maya Torres"]
    delete_exercise(squat)
    se = SessionExercise.objects.get(session_log=log, exercise_name="Back Squat")
    assert se.exercise is None and se.sets.count() == 1
