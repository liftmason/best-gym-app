"""The scheduled jobs: the coach's morning digest and the hourly cron and nightly commands."""

import datetime
import zoneinfo

import pytest
from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from apps.dashboard import alerts, digest

from ..factories import CoachFactory

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------- the digest


def _at_gym_hour(coach, hour, day_offset=0):
    zone = zoneinfo.ZoneInfo(coach.gym.timezone)
    today = timezone.now().astimezone(zone).date() + datetime.timedelta(days=day_offset)
    return datetime.datetime.combine(today, datetime.time(hour, 5), tzinfo=zone)


def test_digest_goes_at_seven_with_new_items_only(coach, athlete):
    from apps.dashboard.models import Notification

    alerts.sync_athlete(athlete)  # no program + missing metrics
    # Raised the evening before this test's "7am", so they count as new then.
    Notification.objects.update(created_at=_at_gym_hour(coach, 7) - datetime.timedelta(hours=10))
    assert digest.send(coach, _at_gym_hour(coach, 6)) == 0  # not 7am yet
    assert digest.send(coach, _at_gym_hour(coach, 7)) == 2
    assert len(mail.outbox) == 1
    email = mail.outbox[0]
    assert email.subject.endswith(": 2 new things need your attention") and "Maya Torres" in email.body
    assert "/athletes/" in email.body and "?tab=" in email.body and "Turn it off in Settings" in email.body
    assert digest.send(coach, _at_gym_hour(coach, 7)) == 0  # once a day
    coach.refresh_from_db()
    assert coach.last_digest_at is not None
    assert digest.send(coach, _at_gym_hour(coach, 7, day_offset=1)) == 0  # nothing new since
    assert len(mail.outbox) == 1


def test_cron_command_runs_everything(coach, athlete, capsys):
    call_command("cron")
    out = capsys.readouterr().out
    assert "synced alerts" in out and "digest(s) sent" in out


def test_run_hourly_reports_what_it_did_and_what_failed(coach, athlete, monkeypatch):
    import io

    from apps.dashboard import jobs

    result = jobs.run_hourly(io.StringIO())
    assert result.failures == [] and result.sent >= 0
    assert result.summary().startswith("cron: ")

    def broken(coach):
        raise ConnectionError("email provider down")

    monkeypatch.setattr(digest, "send", broken)
    result = jobs.run_hourly(io.StringIO())
    assert result.failures == [f"digest for coach {coach.pk}"]


def test_nightly_command_runs(capsys):
    call_command("nightly")
    assert "synced alerts" in capsys.readouterr().out


def _two_new_items(coach, athlete):
    from apps.dashboard.models import Notification

    alerts.sync_athlete(athlete)
    Notification.objects.update(created_at=_at_gym_hour(coach, 7) - datetime.timedelta(hours=10))


def test_a_missed_seven_oclock_run_sends_later_that_day(coach, athlete):
    # H10: only the 7am run counted, so a missed run lost the day's digest.
    _two_new_items(coach, athlete)
    assert digest.send(coach, _at_gym_hour(coach, 10)) == 2


def test_a_failed_send_is_tried_again_next_hour(coach, athlete, monkeypatch):
    # H10: the send time was saved before sending, so a failure dropped those items.
    _two_new_items(coach, athlete)

    def broken(*args, **kwargs):
        raise ConnectionError("email provider down")

    monkeypatch.setattr(digest, "send_mail", broken)
    with pytest.raises(ConnectionError):
        digest.send(coach, _at_gym_hour(coach, 7))
    coach.refresh_from_db()
    assert coach.last_digest_at is None
    monkeypatch.undo()
    assert digest.send(coach, _at_gym_hour(coach, 8)) == 2


def test_one_coach_failing_does_not_stop_the_others(coach, athlete, gym, monkeypatch):
    other = CoachFactory(gym=gym)
    sent = []

    def send(c, now=None):
        if c == coach:
            raise ConnectionError("boom")
        sent.append(c)
        return 1

    monkeypatch.setattr(digest, "send", send)
    with pytest.raises(CommandError):  # the job reports failure, after doing the rest
        call_command("cron")
    assert sent == [other]


def test_backup_check_reports_counts_and_the_newest_finished_session(athlete, capsys):
    from apps.workouts.models import SessionLog

    finished = timezone.now() - datetime.timedelta(hours=2)
    SessionLog.objects.create(athlete=athlete, date=athlete.today(), finished_at=finished)
    SessionLog.objects.create(athlete=athlete, date=athlete.today())  # still open
    call_command("backup_check")
    out = capsys.readouterr().out
    assert "workouts.SessionLog" in out and " 2\n" in out
    assert f"newest finished session: {finished}" in out
