"""Suggested loads and weekly compliance (audit M1-M4, M13)."""

import datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest

from apps.accounts.models import MaxEntry
from apps.programs import services as program_services
from apps.programs.models import LoadBasis, Prescription, WeekType
from apps.programs.prescriptions import suggested_weight
from apps.workouts import charts, history, sessions

from ..conftest import ex

pytestmark = pytest.mark.django_db
DAY = datetime.timedelta(days=1)


def test_plate_rounding_rounds_once():
    # M4: 63.747 went to 63.75 first, then up to 64.
    assert sessions.plate_round(Decimal("63.747"), "kg") == Decimal("63.5")
    assert sessions.plate_round(Decimal("80"), "kg") == Decimal("80")
    assert sessions.plate_round(Decimal("100"), "lb") == Decimal("220")


def test_only_percentage_loads_are_plate_rounded():
    # M3: a coach's fixed 101.25 kg showed as 101.5 in the player.
    fixed = SimpleNamespace(load_basis=LoadBasis.WEIGHT, max_kg=None)
    percent = SimpleNamespace(load_basis=LoadBasis.PERCENT, max_kg=Decimal("82"))
    assert sessions.suggested_load(fixed, Decimal("101.25"), "kg") == Decimal("101.25")
    assert sessions.suggested_load(percent, Decimal("77"), "kg") == Decimal("63")
    rpe = SimpleNamespace(load_basis=LoadBasis.RPE, max_kg=None)
    assert sessions.suggested_load(rpe, Decimal("8"), "kg") is None


def test_the_coach_sees_the_same_suggested_weight_as_the_athlete(athlete, coach, gym):
    # M2: 77% of 82 kg showed as ≈ 63.14 kg to the coach and 63 kg to the athlete.
    MaxEntry.objects.create(
        athlete=athlete, exercise=ex(gym, "sn"), date=athlete.today(), kg=82, source="coach"
    )
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program = program_services.start_program(athlete, "P", athlete.today(), 1, week_type, by=coach.user)
    program_services.add_prescription(program.weeks.get().days.first(), ex(gym, "sn"), athlete)
    rx = Prescription.objects.get()
    rx.load_basis, rx.load_value = LoadBasis.PERCENT, Decimal("77")
    assert suggested_weight(rx, athlete, "kg") == "≈ 63 kg of Snatch max 82 kg"


@pytest.fixture
def two_weeks(athlete, coach, gym):
    """Last week and this week, published; today is Thursday 24 September (week from Monday)."""
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program = program_services.start_program(
        athlete, "P", athlete.today() - 7 * DAY, 2, week_type, by=coach.user
    )
    for week in program.weeks.all():
        program_services.set_published(week, True)
    return program


def plan(program, athlete, gym, date):
    day = program.weeks.get(days__date=date).days.get(date=date)
    program_services.add_prescription(day, ex(gym, "sn"), athlete)
    return day.sessions.get()


def test_this_weeks_compliance_counts_this_week_only(two_weeks, athlete, gym):
    # M1: the trailing 7 days took in last Saturday's missed session.
    today = athlete.today()
    monday = gym.week_start_for(today)
    plan(two_weeks, athlete, gym, monday - 2 * DAY)  # last Saturday, missed
    done = plan(two_weeks, athlete, gym, monday)
    sessions.finish(sessions.start_planned(athlete, done.pk), 7)
    rows = charts.weekly(athlete)
    assert rows[-1][0] == monday and rows[-1][2] == 100
    assert rows[-2][2] == 0  # last week: the missed Saturday


def test_scheduled_days_can_start_from_a_date(two_weeks, athlete, gym):
    # M13: there was no lower bound, so every call read the whole program.
    today = athlete.today()
    plan(two_weeks, athlete, gym, today - 8 * DAY)
    plan(two_weeks, athlete, gym, today - DAY)
    days = history.scheduled_days(athlete, today, since=today - 3 * DAY)
    assert [d for d, _ in days] == [today - DAY]
