"""What the coach's Sessions and Overview tabs show (apps/workouts/coach_summary.py), tested
directly. The frozen clock makes today Thursday 24 September 2026."""

import datetime
from decimal import Decimal

import pytest

from apps.accounts.models import MaxEntry
from apps.programs import services as program_services
from apps.programs.models import LoadBasis, WeekType
from apps.workouts import checkins, coach_summary, issues, sessions
from apps.workouts.models import CheckinQuestion, QuestionType

from ..conftest import ex

pytestmark = pytest.mark.django_db
DAY = datetime.timedelta(days=1)


@pytest.fixture
def program(athlete, coach, gym):
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program = program_services.start_program(
        athlete, "P", athlete.today() - 7 * DAY, 2, week_type, by=coach.user
    )
    for week in program.weeks.all():
        program_services.set_published(week, True)
    return program


def logged(program, athlete, gym, date, key="sn", reps="2", load="80", finish=True, **dose):
    day = program.weeks.get(days__date=date).days.get(date=date)
    rx = program_services.add_prescription(day, ex(gym, key), athlete)
    for field, value in {"sets": 1, "rep_scheme": reps, "reps": int(reps), **dose}.items():
        setattr(rx, field, value)
    rx.save()
    log = sessions.start(athlete, rx.session)
    sessions.log_set(log.exercises.get(), 1, load=load, reps=reps, done=True)
    if finish:
        sessions.finish(log, 8)
    return log


def test_asked_for_shows_the_suggested_weight_for_a_percentage(program, athlete, gym):
    MaxEntry.objects.create(
        athlete=athlete, exercise=ex(gym, "sn"), date=athlete.today(), kg=100, source="coach"
    )
    log = logged(
        program, athlete, gym, athlete.today(), load_basis=LoadBasis.PERCENT, load_value=Decimal("80")
    )
    assert coach_summary.asked_text(log.exercises.get(), "kg") == "1×2 @ 80% (≈ 80 kg)"


def test_session_items(program, athlete, gym):
    log = logged(program, athlete, gym, athlete.today() - DAY)
    issues.report(log, "pain", "Wrist")
    (item,), range_key = coach_summary.session_list(athlete, "kg")
    assert range_key == "8" and item["log"] == log and item["open"]
    assert item["status"] == "partial"  # an issue was reported
    assert item["rpe_class"] == "mid"  # RPE 8
    line = item["exercises"][0]
    assert (line["did"], line["planned"], line["done_count"]) == ("1×2 @ 80 kg", 1, 1)


def test_session_list_filters_by_range_and_exercise(program, athlete, gym):
    logged(program, athlete, gym, athlete.today() - DAY, "sn")
    logged(program, athlete, gym, athlete.today() - 2 * DAY, "bsq", reps="5", load="120")
    assert len(coach_summary.session_list(athlete, "kg", q="squat")[0]) == 1
    assert coach_summary.session_list(athlete, "kg", range_key="bogus")[1] == "8"
    items, _ = coach_summary.session_list(athlete, "kg", range_key="all")
    assert [i["open"] for i in items] == [True, True]


def test_recent_checkins_pick_the_scale_and_choice_answers(program, athlete, gym):
    scale = CheckinQuestion.objects.create(athlete=athlete, order=0, type=QuestionType.SCALE, text="Ready?")
    choice = CheckinQuestion.objects.create(
        athlete=athlete, order=1, type=QuestionType.CHOICE, text="Sleep?", options=["Good", "Bad"]
    )
    log = logged(program, athlete, gym, athlete.today(), finish=False)
    checkins.answer(log, scale, "7")
    checkins.answer(log, choice, "Bad")
    sessions.finish(log, 8)
    (entry,) = coach_summary.recent_checkins(athlete)
    assert (entry["scale"].value, entry["choice"].value) == ("7", "Bad")


def test_week_glance(program, athlete, gym):
    today = athlete.today()
    logged(program, athlete, gym, today - DAY)
    day = program.weeks.get(days__date=today).days.get(date=today)
    program_services.add_prescription(day, ex(gym, "sn"), athlete)
    drill = program_services.add_prescription(day, ex(gym, "mob"), athlete)
    drill.warmup = True
    drill.save()
    glance = {g["date"]: g for g in coach_summary.week_glance(athlete)}
    assert glance[today - DAY]["label"] == "✓ done"
    assert glance[today]["label"] == "1 ex" and glance[today]["today"]  # warm-ups aren't exercises
    assert glance[today + DAY]["label"] == "rest"


def test_top_prs_put_tracked_lifts_first(program, athlete, gym):
    logged(program, athlete, gym, athlete.today() - DAY, "pp", reps="3", load="70")
    logged(program, athlete, gym, athlete.today() - 2 * DAY, "sn", reps="1", load="85")
    assert [pr["name"] for pr in coach_summary.top_prs(athlete, "kg")] == ["Snatch", "Push Press"]
