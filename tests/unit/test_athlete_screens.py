"""What the athlete's week and session player show (apps/workouts/week.py, player.py,
charts.progress_lifts), tested directly. The frozen clock makes today Thursday."""

import datetime
from decimal import Decimal

import pytest

from apps.accounts.models import MaxEntry
from apps.programs import services as program_services
from apps.programs.models import LoadBasis, WeekType
from apps.workouts import charts, checkins, sessions
from apps.workouts import player as screens
from apps.workouts import week as week_screen
from apps.workouts.models import CheckinQuestion, QuestionType

from ..conftest import ex

pytestmark = pytest.mark.django_db
DAY = datetime.timedelta(days=1)


@pytest.fixture
def program(athlete, coach, gym):
    """Three weeks from last week; last week and this week published."""
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program = program_services.start_program(
        athlete, "P", athlete.today() - 7 * DAY, 3, week_type, by=coach.user
    )
    for week in program.weeks.all()[:2]:
        program_services.set_published(week, True)
    return program


def add(program, athlete, gym, date, key="sn", **dose):
    day = program.weeks.get(days__date=date).days.get(date=date)
    rx = program_services.add_prescription(day, ex(gym, key), athlete)
    for field, value in dose.items():
        setattr(rx, field, value)
    rx.save()
    return rx


# ---------------------------------------------------------------- the week


def test_the_week_that_opens(program, athlete):
    weeks = week_screen.published_weeks(program)
    today = athlete.today()
    assert len(weeks) == 2  # the draft week never shows
    assert week_screen.pick_week(weeks, today, None) == weeks[1]
    assert week_screen.pick_week(weeks, today, today - 7 * DAY) == weeks[0]
    assert week_screen.pick_week(weeks, today, today + 30 * DAY) == weeks[1]  # not published: this week
    assert week_screen.pick_week(weeks, today + 60 * DAY, None) == weeks[-1]  # after the last: the last
    assert week_screen.pick_week(weeks, today - 60 * DAY, None) == weeks[0]  # before the first: the first
    assert week_screen.pick_week([], today, None) is None


def test_the_day_that_opens(program, athlete):
    week = week_screen.published_weeks(program)[1]
    today = athlete.today()
    assert week_screen.pick_day(week, today) == today
    assert week_screen.pick_day(week, today, week.start_date) == week.start_date
    assert week_screen.pick_day(week, today, today + 30 * DAY) == today  # outside the week
    last_week = week_screen.published_weeks(program)[0]
    assert week_screen.pick_day(last_week, today) == last_week.start_date


def test_card_states(program, athlete, gym):
    today = athlete.today()
    assert week_screen.card_state(None, today, today) == "start"
    assert week_screen.card_state(None, today - DAY, today) == "backfill"
    assert week_screen.card_state(None, today + DAY, today) == "locked"
    rx = add(program, athlete, gym, today)
    log = sessions.start(athlete, rx.session)
    assert week_screen.card_state(log, today, today) == "paused"
    sessions.finish(log, 7)
    assert week_screen.card_state(log, today, today) == "done"


def test_week_view(program, athlete, gym):
    today = athlete.today()
    rx = add(program, athlete, gym, today, rep_scheme="3", reps=3, sets=5)
    add(program, athlete, gym, today, "mob", warmup=True)
    add(program, athlete, gym, today - DAY, "bsq")
    paused = sessions.start(
        athlete, program.weeks.get(days__date=today - DAY).days.get(date=today - DAY).sessions.get()
    )
    view = week_screen.week_view(athlete)
    assert view["week"].order == 1 and view["week_number"] == 2
    assert view["prev_week"].order == 0 and view["next_week"] is None
    today_entry = next(d for d in view["strip"] if d["is_today"])
    assert today_entry["selected"] and today_entry["count"] == 1  # warm-ups don't count
    card = view["selected"]["cards"][0]
    assert card["state"] == "start" and card["count"] == 1
    assert [i["name"] for i in card["items"]] == ["Warm-up", rx.exercise.name]
    assert view["paused"] == [paused]  # paused on another day than the one shown
    assert week_screen.week_view(athlete, wanted_day=today - DAY)["paused"] == []


def test_no_program_or_no_published_week(athlete):
    view = week_screen.week_view(athlete)
    assert view["program"] is None and view["week"] is None and view["paused"] == []


# ---------------------------------------------------------------- the player


def test_resume_point_follows_the_session(program, athlete, gym):
    CheckinQuestion.objects.create(athlete=athlete, type=QuestionType.SCALE, text="Ready?")
    today = athlete.today()
    add(program, athlete, gym, today, "mob", warmup=True)
    add(program, athlete, gym, today, "sn", sets=1, rep_scheme="1", reps=1)
    log = sessions.start(athlete, program.weeks.get(days__date=today).days.get(date=today).sessions.get())
    assert screens.resume_point(log) == ("checkin", 1)
    checkins.answer(log, checkins.questions(athlete)[0], "7")
    assert screens.resume_point(log) == ("checkin_summary", None)
    checkins.finish(log, skip=False)
    # Until a set is logged, resuming shows the check-in summary again (its "Start session"
    # button goes on to the player); skipping the check-in goes straight to the warm-up.
    assert screens.resume_point(log) == ("checkin_summary", None)
    checkins.finish(log, skip=True)
    assert screens.resume_point(log) == ("player", 1)  # the warm-up
    lift = log.exercises.get(warmup=False)
    sessions.log_set(lift, 1, reps="1", done=True)
    assert screens.resume_point(log) == ("finish", None)  # warm-up left behind once lifting
    sessions.finish(log, 7)
    assert screens.resume_point(log) == ("player", 1)  # reopening a finished session


def test_set_rows_suggest_loads_from_the_max(program, athlete, gym):
    today = athlete.today()
    MaxEntry.objects.create(
        athlete=athlete, exercise=ex(gym, "sn"), date=today, kg=Decimal("100"), source="coach"
    )
    rx = add(
        program,
        athlete,
        gym,
        today,
        sets=3,
        rep_scheme="2",
        reps=2,
        load_basis=LoadBasis.PERCENT,
        load_value=Decimal("80"),
    )
    # Varying by set means a row for every set; set 2 leaves its load to the parent's 80%.
    rx.set_overrides.create(set_number=1, rep_scheme="2", reps=2, load_value=Decimal("80"))
    rx.set_overrides.create(set_number=2, rep_scheme="2", reps=2, load_value=None)
    rx.set_overrides.create(set_number=3, rep_scheme="1", reps=1, load_value=Decimal("85"))
    log = sessions.start(athlete, rx.session)
    se = log.exercises.get()
    sessions.log_set(se, 1, load="81", reps="2", done=True)
    rows, unit_of_time = screens.set_rows(se, sessions.prescribed(se), "kg")
    assert unit_of_time == "s"
    assert [(r["load"], r["reps"], r["done"]) for r in rows] == [
        ("81", 2, True),
        ("80", 2, False),
        ("85", 1, False),
    ]
    assert rows[2]["placeholder"] == "1"
    banner = screens.banner(sessions.prescribed(se), "kg")
    assert banner["load"] == "80%" and banner["hint"] == "loads vary by set · Snatch max 100 kg"


def test_timed_work_in_minutes_from_two_whole_minutes(program, athlete, gym):
    p = lambda seconds: type("P", (), {"duration_seconds": seconds})()  # noqa: E731
    assert screens.time_unit(p(600)) == "min"
    assert screens.time_unit(p(90)) == "s"
    assert screens.time_unit(p(150)) == "s"  # not whole minutes
    assert screens.time_unit(None) == "s"


def test_done_screen_counts_leave_out_warmups(program, athlete, gym):
    today = athlete.today()
    add(program, athlete, gym, today, "mob", warmup=True)
    add(program, athlete, gym, today, "sn", sets=2, rep_scheme="1", reps=1)
    log = sessions.start(athlete, program.weeks.get(days__date=today).days.get(date=today).sessions.get())
    lift = log.exercises.get(warmup=False)
    sessions.log_set(lift, 1, load="60", reps="1", done=True)
    sessions.log_set(lift, 2, reps="1", done=True)
    sessions.log_set(lift, 3, reps="1", done=True)  # one more than planned counts as planned
    assert screens.set_counts(log) == (1, 3, 3)
    assert screens.top_sets(log) == 1


def test_progress_offers_lifts_with_two_points(program, athlete, gym):
    today = athlete.today()
    for i, kg in enumerate(("80", "85")):
        rx = add(program, athlete, gym, today - (i + 1) * DAY, "sn", sets=1, rep_scheme="1", reps=1)
        log = sessions.start(athlete, rx.session)
        sessions.log_set(log.exercises.get(), 1, load=kg, reps="1", done=True)
        sessions.finish(log, 7)
    rx = add(program, athlete, gym, today - 3 * DAY, "bsq", sets=1, rep_scheme="5", reps=5)
    log = sessions.start(athlete, rx.session)
    sessions.log_set(log.exercises.get(), 1, load="120", reps="5", done=True)
    sessions.finish(log, 7)
    assert [e.key for e in charts.progress_lifts(athlete)] == ["sn"]
