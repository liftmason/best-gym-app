"""Bootstrap and older history (apps/sync/bootstrap.py), with real transactions."""

import datetime

import pytest
from django.test import Client
from django.utils import timezone

from apps.accounts.models import BodyweightEntry
from apps.programs import services as program_services
from apps.programs.models import WeekType
from apps.signin import services as signin
from apps.sync import bootstrap, pull
from apps.workouts.models import SessionExercise, SessionLog, SetLog

from ..conftest import ex

pytestmark = pytest.mark.django_db(transaction=True)
DAY = datetime.timedelta(days=1)


def phone_copy(snapshot):
    """{table: {id: row}} as a phone would store the snapshot."""
    return {table: {r["id"]: r for r in rows} for table, rows in snapshot["tables"].items()}


def apply(copy, page):
    for c in page["changes"]:
        table = copy.setdefault(c["table"], {})
        if c["op"] == "upsert":
            table[c["id"]] = c["row"]
        else:
            table.pop(c["id"], None)


def sync(athlete, copy, cursor):
    while True:
        page = pull.pull(athlete, cursor)
        apply(copy, page)
        cursor = page["cursor"]
        if not page["more"]:
            return cursor


def logged(athlete, gym, days_ago):
    at = timezone.now() - days_ago * DAY
    log = SessionLog.objects.create(
        athlete=athlete, date=athlete.today() - days_ago * DAY, started_at=at, finished_at=at
    )
    se = SessionExercise.objects.create(session_log=log, exercise=ex(gym, "sn"), exercise_name="Snatch")
    SetLog.objects.create(session_exercise=se, set_number=1, load_kg=80, reps=2, done=True)
    return log


def test_bootstrap_then_pull_matches_the_server(athlete, coach, gym):
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program = program_services.start_program(athlete, "P", athlete.today(), 2, week_type, by=coach.user)
    first, second = program.weeks.order_by("order")
    program_services.set_published(first, True)
    program_services.add_prescription(first.days.first(), ex(gym, "sn"), athlete)
    entry = BodyweightEntry.objects.create(athlete=athlete, date=athlete.today(), kg=70, source="athlete")
    logged(athlete, gym, 2)

    shot = bootstrap.snapshot(athlete)
    copy = phone_copy(shot)
    assert copy["programs_programweek"].keys() == {str(first.pk)}  # the draft week isn't there

    # Meanwhile: the coach publishes week 2 and edits, the athlete logs, a row is deleted.
    program_services.set_published(second, True)
    program_services.add_prescription(second.days.first(), ex(gym, "cj"), athlete)
    logged(athlete, gym, 0)
    entry.delete()
    snatch = ex(gym, "sn")
    snatch.cue = "Stay over it"
    snatch.save()

    sync(athlete, copy, shot["cursor"])
    now = phone_copy(bootstrap.snapshot(athlete))
    assert copy == now


def test_a_new_phone_gets_twelve_months_and_pages_back_online(athlete, gym):
    recent = logged(athlete, gym, 30)
    old = logged(athlete, gym, 400)
    shot = bootstrap.snapshot(athlete)
    logs = {r["id"] for r in shot["tables"]["workouts_sessionlog"]}
    assert str(recent.pk) in logs and str(old.pk) not in logs
    assert shot["history_from"] == athlete.today() - 365 * DAY

    api = Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(athlete.user).access}")
    older = api.get("/api/v1/me/history").json()
    assert [r["id"] for r in older["tables"]["workouts_sessionlog"]] == [str(old.pk)]
    assert len(older["tables"]["workouts_setlog"]) == 1 and older["next"] is None


def test_the_endpoints(athlete, coach):
    api = Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(athlete.user).access}")
    shot = api.get("/api/v1/sync/bootstrap").json()
    assert "exercises_exercise" in shot["tables"] and shot["cursor"]
    page = api.get("/api/v1/sync/pull", {"cursor": shot["cursor"]}).json()
    assert page["more"] is False and page["library_reset"] is False
    coach_api = Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(coach.user).access}")
    assert coach_api.get("/api/v1/sync/bootstrap").status_code == 404  # coaches don't sync
