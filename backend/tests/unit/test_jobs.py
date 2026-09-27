"""The scheduled jobs: the coach's morning digest and the hourly cron and nightly commands."""

import datetime
import zoneinfo

import pytest
from django.core import mail
from django.core.management import call_command
from django.utils import timezone

from apps.dashboard import alerts, digest
from apps.exercises.models import Exercise
from apps.programs import services as program_services
from apps.programs.models import WeekType
from apps.workouts import sessions, videos
from apps.workouts.models import FormVideo

pytestmark = pytest.mark.django_db
MB = 1024 * 1024


@pytest.fixture
def log(athlete, coach):
    week_type = WeekType.objects.get(gym=coach.gym, name="Accumulation")
    program = program_services.start_program(athlete, "Block", athlete.today(), 1, week_type, by=coach.user)
    day = program.weeks.get().days.get(date=athlete.today())
    program_services.add_prescription(day, Exercise.objects.get(gym=coach.gym, key="sn"), athlete)
    return sessions.start(athlete, day.sessions.get())


@pytest.fixture
def stored(monkeypatch):
    """Pretend the bucket holds whatever was signed for (no network in unit tests)."""
    deleted = []
    monkeypatch.setattr(videos, "stored_size", lambda key: FormVideo.objects.get(key=key).size)
    monkeypatch.setattr(videos, "delete", lambda key: deleted.append(key))
    monkeypatch.setattr(videos, "view_url", lambda key: f"https://bucket.example/{key}?signed")
    return deleted


def upload(client, log, size=5 * MB, content_type="video/mp4"):
    se = log.exercises.get()
    return client.post(
        f"/app/log/{log.pk}/videos/start/", {"se": se.pk, "size": size, "content_type": content_type}
    )


# ---------------------------------------------------------------- form videos


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
    assert email.subject.startswith("2 new things need your attention") and "Maya Torres" in email.body
    assert "/coach/athletes/" in email.body and "Turn it off in Settings" in email.body
    assert digest.send(coach, _at_gym_hour(coach, 7)) == 0  # once a day
    coach.refresh_from_db()
    assert coach.last_digest_at is not None
    assert digest.send(coach, _at_gym_hour(coach, 7, day_offset=1)) == 0  # nothing new since
    assert len(mail.outbox) == 1


def test_cron_command_runs_everything(coach, athlete, capsys):
    call_command("cron")
    out = capsys.readouterr().out
    assert "synced alerts" in out and "digest(s) sent" in out


# ---------------------------------------------------------------- units, the app, errors


# ---------------------------------------------------------------- rate limits


def test_nightly_command_runs(capsys):
    call_command("nightly")
    assert "synced alerts" in capsys.readouterr().out
