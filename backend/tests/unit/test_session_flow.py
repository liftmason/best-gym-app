"""The athlete's session flow in apps/workouts (sessions.py, issues.py), tested directly:
starting a planned session, logging sets, warm-up ticks, finishing, issue reports, units."""

import datetime
from decimal import Decimal

import pytest

from apps.accounts import services as account_services
from apps.dashboard import alerts
from apps.programs import services as program_services
from apps.programs.models import ProgramSession, WeekType
from apps.workouts import issues, sessions
from apps.workouts.models import IssueReport, SetLog

from ..conftest import ex
from ..factories import AthleteFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def week(athlete, coach, gym):
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program = program_services.start_program(athlete, "P", athlete.today(), 1, week_type, by=coach.user)
    week = program.weeks.get()
    program_services.set_published(week, True)
    return week


def planned(week, athlete, gym, date, key="sn"):
    day = week.days.get(date=date)
    program_services.add_prescription(day, ex(gym, key), athlete)
    return day.sessions.get()


@pytest.fixture
def log(week, athlete, gym):
    return sessions.start_planned(athlete, planned(week, athlete, gym, athlete.today()).pk)


# ---------------------------------------------------------------- starting


def test_today_and_missed_days_start_later_days_wait(week, athlete, gym):
    today = athlete.today()
    assert sessions.start_planned(athlete, planned(week, athlete, gym, today).pk).date == today
    tomorrow = today + datetime.timedelta(days=1)
    with pytest.raises(sessions.NotYetUnlocked) as locked:
        sessions.start_planned(athlete, planned(week, athlete, gym, tomorrow, "bsq").pk)
    assert locked.value.date == tomorrow


def test_draft_weeks_and_other_athletes_sessions_cannot_be_started(week, athlete, coach, gym):
    session = planned(week, athlete, gym, athlete.today())
    with pytest.raises(ProgramSession.DoesNotExist):
        sessions.start_planned(AthleteFactory(coach=coach), session.pk)
    program_services.set_published(week, False)
    with pytest.raises(ProgramSession.DoesNotExist):
        sessions.start_planned(athlete, session.pk)


def test_starting_twice_resumes_the_same_log(week, athlete, gym):
    session = planned(week, athlete, gym, athlete.today())
    assert sessions.start_planned(athlete, session.pk) == sessions.start_planned(athlete, session.pk)


# ---------------------------------------------------------------- logging sets


def test_a_set_in_pounds_is_stored_in_kg(log):
    se = log.exercises.get()
    sessions.log_set(se, 1, load="225", reps="3", rir="2", done=True, unit="lb")
    s = SetLog.objects.get()
    assert (s.load_kg, s.reps, s.rir, s.done) == (Decimal("102.06"), 3, 2, True)


def test_time_is_entered_in_minutes_or_seconds(log):
    se = log.exercises.get()
    assert sessions.log_set(se, 1, time="2.5", time_unit="min").duration_seconds == 150
    assert sessions.log_set(se, 2, time="45").duration_seconds == 45


@pytest.mark.parametrize(
    "fields",
    [
        {"load": "2001"},
        {"load": "-1"},
        {"load": "heavy"},
        {"reps": "1000"},
        {"reps": "2.5"},
        {"rir": "6"},
        {"time": "1441", "time_unit": "min"},
        {"time_unit": "hours"},
    ],
)
def test_out_of_range_sets_are_refused(log, fields):
    with pytest.raises(sessions.InvalidSet):
        sessions.log_set(log.exercises.get(), 1, **fields)
    assert not SetLog.objects.exists()


def test_set_numbers_run_1_to_50(log):
    for number in (0, 51):
        with pytest.raises(sessions.InvalidSet):
            sessions.log_set(log.exercises.get(), number, reps="1")


def test_the_log_closes_24_hours_after_finishing(log, frozen_clock):
    se = log.exercises.get()
    sessions.log_set(se, 1, reps="2", done=True)
    sessions.finish(log, 8)
    sessions.log_set(se, 1, reps="3", done=True)  # a correction within the day
    frozen_clock.shift(datetime.timedelta(hours=25))
    for action in (
        lambda: sessions.log_set(se, 1, reps="4"),
        lambda: sessions.finish(log, 7),
    ):
        with pytest.raises(sessions.SessionClosed):
            action()


# ---------------------------------------------------------------- warm-ups and finishing


def test_warmup_ticks_only_while_open(week, athlete, gym, frozen_clock):
    session = planned(week, athlete, gym, athlete.today(), "mob")
    rx = session.prescriptions.get()
    rx.warmup = True
    rx.save()
    log = sessions.start_planned(athlete, session.pk)
    drill = log.exercises.get(warmup=True)
    assert sessions.check_warmup(drill, True).checked_at is not None
    sessions.finish(log, 6)
    frozen_clock.shift(datetime.timedelta(hours=25))
    with pytest.raises(sessions.SessionClosed):
        sessions.check_warmup(drill, False)


@pytest.mark.parametrize("rpe", [0, 11, "hard", None])
def test_finish_needs_an_rpe_from_1_to_10(log, rpe):
    with pytest.raises(sessions.InvalidFinish):
        sessions.finish(log, rpe)


def test_finish_tidies_the_comment_and_limits_it(log):
    assert sessions.finish(log, "8", "  quick bar  ").comment == "quick bar"
    with pytest.raises(sessions.InvalidFinish):
        sessions.finish(log, 8, "x" * 2001)


# ---------------------------------------------------------------- issues and units


def test_an_issue_alerts_the_coach_until_resolved(log, coach):
    issue = issues.report(log, "pain", "  Left wrist at lockout ")
    assert issue.text == "Left wrist at lockout" and issue.athlete == log.athlete
    assert alerts.feed(coach).filter(kind="issue", cleared_at__isnull=True).exists()
    issues.resolve(issue)
    first = issue.resolved_at
    issues.resolve(issue)  # resolving again changes nothing
    assert issue.resolved_at == first
    assert not alerts.feed(coach).filter(kind="issue", cleared_at__isnull=True).exists()


def test_issues_need_a_kind_and_a_reasonable_length(log):
    with pytest.raises(issues.InvalidIssue):
        issues.report(log, "gossip")
    with pytest.raises(issues.InvalidIssue):
        issues.report(log, "other", "x" * 2001)
    assert not IssueReport.objects.exists()


def test_athletes_choose_kg_or_lb(athlete):
    assert account_services.set_units(athlete, "lb").units == "lb"
    with pytest.raises(ValueError):
        account_services.set_units(athlete, "stone")
