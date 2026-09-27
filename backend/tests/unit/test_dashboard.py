"""Phase 6: the attention feed, the dashboard, and coach–athlete messages."""

import datetime
from decimal import Decimal

import pytest

from apps.accounts import coaching
from apps.accounts.models import MaxEntry, MaxUpdates
from apps.dashboard import alerts
from apps.dashboard.models import NotificationKind
from apps.messaging.models import Message, Thread
from apps.programs import services as program_services
from apps.programs.models import WeekType
from apps.workouts import sessions
from apps.workouts.models import IssueReport

from ..conftest import ex
from ..factories import CoachFactory

pytestmark = pytest.mark.django_db
DAY = datetime.timedelta(days=1)


def kinds(coach):
    return sorted(n.kind for n in alerts.feed(coach))


@pytest.fixture
def program(athlete, coach):
    """Three published weeks from last week, so "3 days from today" is inside it whatever
    the weekday (with two weeks it ran out on Fridays to Sundays)."""
    week_type = WeekType.objects.get(gym=coach.gym, name="Accumulation")
    program = program_services.start_program(
        athlete, "Block", athlete.today() - 7 * DAY, 3, week_type, by=coach.user
    )
    for week in program.weeks.all():
        program_services.set_published(week, True)
    return program


def plan(program, date, athlete, gym, key="sn"):
    day = program.weeks.get(days__date=date).days.get(date=date)
    rx = program_services.add_prescription(day, ex(gym, key), athlete)
    return rx.session


# ---------------------------------------------------------------- conditions


def test_no_program_and_missing_metrics(coach, athlete):
    alerts.sync_athlete(athlete)
    assert kinds(coach) == [NotificationKind.METRICS_MISSING, NotificationKind.PROGRAM_ENDING]
    assert "No program yet" in alerts.feed(coach).get(kind="program_ending").text


def test_program_running_out_clears_when_weeks_are_added(coach, athlete, gym, program):
    last = athlete.today() + 3 * DAY
    plan(program, last, athlete, gym)
    alerts.sync_athlete(athlete)
    row = alerts.feed(coach).get(kind="program_ending")
    assert "runs out" in row.text and "(3 days)" in row.text
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    week = program_services.add_week(program, week_type)
    program_services.add_prescription(week.days.last(), ex(gym, "cj"), athlete)
    alerts.sync_athlete(athlete)
    assert not alerts.feed(coach).filter(kind="program_ending").exists()


def test_missed_sessions_leave_once_logged(coach, athlete, gym, program):
    session = plan(program, athlete.today() - DAY, athlete, gym)
    alerts.sync_athlete(athlete)
    assert "Missed" in alerts.feed(coach).get(kind="missed").text
    sessions.finish(sessions.start(athlete, session), 7, "")
    alerts.sync_athlete(athlete)
    assert not alerts.feed(coach).filter(kind="missed").exists()


# ---------------------------------------------------------------- events


def test_threads_are_per_coach(coach, athlete, make_user):
    old = Thread.for_athlete(athlete)
    Message.objects.create(thread=old, sender=coach.user, body="Old coach's note")
    other = CoachFactory(user=make_user("sam@example.com", "Sam"), gym=coach.gym)
    coaching.end(athlete)
    coaching.start(other, athlete)
    assert not Thread.for_athlete(athlete).messages.exists()  # a fresh thread with the new coach


def test_automatic_max_updates_are_reported(coach, athlete, program, gym):
    athlete.max_updates = MaxUpdates.AUTO
    athlete.save()
    MaxEntry.objects.create(
        athlete=athlete, exercise=ex(gym, "sn"), date=athlete.today() - 30 * DAY, kg=100, source="coach"
    )
    log = sessions.start(athlete, plan(program, athlete.today(), athlete, gym))
    sessions.save_set(
        log.exercises.get(), 1, load_kg=Decimal("104"), reps=1, duration_seconds=None, rir=None, done=True
    )
    sessions.finish(log, 9, "")
    assert "Snatch max updated to 104 kg" in alerts.feed(coach).get(kind="pr").text


# ---------------------------------------------------------------- the dashboard


def test_nightly_syncs_every_coach(athlete, coach):
    from django.core.management import call_command

    call_command("nightly")
    assert alerts.feed(coach).filter(kind="program_ending").exists()


def test_alert_links_go_to_the_item(coach, athlete, program, gym):
    from apps.workouts.models import SessionLog

    alerts.sync_athlete(athlete)
    links = {n.kind: alerts.link_for(n) for n in alerts.feed(coach)}
    assert links["metrics_missing"].endswith("/metrics/#metricsPanel")
    assert "program/?week=" in links["program_ending"] or links["program_ending"].endswith("/program/")
    old = SessionLog.objects.create(athlete=athlete, date=athlete.today() - 70 * DAY, name="Old")
    issue = IssueReport.objects.create(athlete=athlete, session_log=old, kind="pain")
    alerts.issue_reported(issue)
    row = alerts.feed(coach).get(kind="issue")
    assert alerts.link_for(row).endswith(
        f"/sessions/?range=all#issue-{issue.pk}"
    )  # outside the default 8 weeks
    session = plan(program, athlete.today() - DAY, athlete, gym)
    alerts.sync_athlete(athlete)
    missed = alerts.feed(coach).get(kind="missed")
    assert alerts.link_for(missed).endswith(f"?week={session.day.week_id}#day-{session.day_id}")
