"""The coach's attention feed across athletes (audit H1, M6, M12)."""

import datetime

import pytest

from apps.accounts.models import MaxEntry, MaxUpdates
from apps.dashboard import alerts
from apps.dashboard.models import Notification, NotificationKind
from apps.programs import services as program_services
from apps.programs.models import WeekType
from apps.workouts import sessions

from ..conftest import ex
from ..factories import AthleteFactory

pytestmark = pytest.mark.django_db


def start(athlete, coach, weeks=1, first_day=None):
    week_type = WeekType.objects.get(gym=coach.gym, name="Accumulation")
    return program_services.start_program(
        athlete, "Block", first_day or athlete.today(), weeks, week_type, by=coach.user
    )


def rows(coach, kind):
    return Notification.objects.filter(recipient=coach.user, kind=kind, cleared_at__isnull=True)


def test_the_same_condition_for_two_athletes_keeps_two_rows(coach, athlete):
    # H1: both have no program ("none"); B's alert used to take over A's row.
    other = AthleteFactory(coach=coach)
    alerts.sync_athlete(athlete)
    alerts.sync_athlete(other)
    assert {r.athlete for r in rows(coach, NotificationKind.PROGRAM_ENDING)} == {athlete, other}

    start(athlete, coach, weeks=4)
    alerts.sync_athlete(athlete)  # A's condition changes; B's row is untouched
    texts = {r.athlete: r.text for r in rows(coach, NotificationKind.PROGRAM_ENDING)}
    assert "has no sessions yet" in texts[athlete] and "No program yet" in texts[other]


def test_handling_one_athletes_alert_leaves_the_others(coach, athlete):
    other = AthleteFactory(coach=coach)
    for a in (athlete, other):
        alerts.notify(a, NotificationKind.METRICS_MISSING, "metrics", f"{a} is missing numbers", "")
    alerts.handled(athlete, NotificationKind.METRICS_MISSING, "metrics")
    assert [r.athlete for r in rows(coach, NotificationKind.METRICS_MISSING)] == [other]


# ---------------------------------------------------------------- max updated (M6)


@pytest.fixture
def finished(athlete, coach, gym):
    athlete.max_updates = MaxUpdates.AUTO
    athlete.save()
    MaxEntry.objects.create(
        athlete=athlete,
        exercise=ex(gym, "sn"),
        date=athlete.today() - datetime.timedelta(days=30),
        kg=100,
        source="coach",
    )
    week = start(athlete, coach).weeks.get()
    program_services.set_published(week, True)
    day = week.days.get(date=athlete.today())
    program_services.add_prescription(day, ex(gym, "sn"), athlete)
    log = sessions.start_planned(athlete, day.sessions.get().pk)
    se = log.exercises.get()
    sessions.log_set(se, 1, load="105", reps="1", done=True)
    sessions.finish(log, 8)
    return se


def test_editing_a_session_updates_its_max_alert_rather_than_adding_one(finished, coach):
    sessions.log_set(finished, 1, load="107", reps="1", done=True)
    sessions.log_set(finished, 1, load="108", reps="1", done=True)
    (row,) = rows(coach, NotificationKind.PR)
    assert "108" in row.text


def test_a_corrected_typo_takes_its_max_alert_away(finished, coach):
    sessions.log_set(finished, 1, load="95", reps="1", done=True)  # it was never a PR
    assert not rows(coach, NotificationKind.PR).exists()


# ---------------------------------------------------------------- program running out (M12)


def test_only_published_weeks_count_towards_the_program(coach, athlete):
    program = start(athlete, coach, weeks=2)
    first, second = program.weeks.order_by("order")
    program_services.set_published(first, True)
    for week in (first, second):
        program_services.add_prescription(week.days.order_by("date").last(), ex(coach.gym, "sn"), athlete)
    _, last = alerts.program_end_date(athlete)
    assert last == first.days.order_by("date").last().date

    alerts.sync_athlete(athlete)
    row = rows(coach, NotificationKind.PROGRAM_ENDING).get()
    assert "runs out" in row.text and "1 draft week not yet published" in row.text


def test_a_program_with_only_drafts_has_nothing_published(coach, athlete):
    program = start(athlete, coach)
    program_services.add_prescription(program.weeks.get().days.first(), ex(coach.gym, "sn"), athlete)
    alerts.sync_athlete(athlete)
    assert "nothing published yet" in rows(coach, NotificationKind.PROGRAM_ENDING).get().text
