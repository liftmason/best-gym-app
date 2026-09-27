"""Push notifications (apps/signin/push.py): registering a device's token, who hears of what,
and delivery through Expo, including tokens Expo says are gone."""

import json

import pytest
from django.core.exceptions import ImproperlyConfigured
from django.test import Client

from apps.messaging import services as messaging
from apps.programs import services as program_services
from apps.programs.models import WeekType
from apps.signin import push
from apps.signin import services as signin
from apps.signin.models import DeviceSession
from apps.workouts import form_videos, issues, videos
from apps.workouts.models import SessionExercise, SessionLog
from config.settings import checks

from ..conftest import ex

pytestmark = pytest.mark.django_db

TOKEN = "ExponentPushToken[abc123]"


@pytest.fixture(autouse=True)
def outbox():
    push.outbox.clear()
    yield push.outbox
    push.outbox.clear()


@pytest.fixture
def committed(django_capture_on_commit_callbacks):
    """`with committed():` runs what waits for the commit (pushes) at the block's end."""
    return lambda: django_capture_on_commit_callbacks(execute=True)


def device(user, token=TOKEN):
    session = signin.open_session(user).session
    push.register(session, token)
    return session


def test_a_token_belongs_to_one_device_at_a_time(athlete, coach):
    first = device(athlete.user)
    second = device(coach.user)  # the same phone, signed in as someone else
    first.refresh_from_db()
    assert first.push_token == "" and second.push_token == TOKEN
    with pytest.raises(push.InvalidToken):
        push.register(second, "not-a-token")


def test_a_coach_message_reaches_the_athletes_phone_after_commit(athlete, coach, outbox, committed):
    device(athlete.user)
    thread = messaging.thread_for(athlete)
    with committed():
        messaging.send(thread, coach.user, "Great session today")
        assert outbox == []  # nothing before the commit
    (sent,) = outbox
    assert sent["to"] == TOKEN and sent["title"] == coach.user.name and sent["body"] == "Great session today"
    assert sent["data"] == {"sync": True, "type": "message"}


def test_the_coach_hears_of_messages_issues_and_videos(athlete, coach, gym, outbox, monkeypatch, committed):
    device(coach.user, "ExponentPushToken[coach]")
    log = SessionLog.objects.create(athlete=athlete, date=athlete.today())
    se = SessionExercise.objects.create(session_log=log, exercise=ex(gym, "sn"), exercise_name="Snatch")
    monkeypatch.setattr(videos, "stored_size", lambda key: 1000)
    with committed():
        messaging.send(messaging.thread_for(athlete), athlete.user, "Knee is better")
        issues.report(log, "pain", "Left wrist")
        video, _ = form_videos.start_upload(se, 1000, "video/mp4")
        form_videos.confirm(video)
    titles = [m["title"] for m in outbox]
    name = athlete.user.name
    assert titles == [name, f"{name} reported an issue", f"{name} uploaded a form video"]
    assert {m["data"]["athlete_id"] for m in outbox} == {str(athlete.pk)}


def test_publishing_tells_the_athlete_and_unpublishing_syncs_silently(athlete, coach, gym, outbox, committed):
    device(athlete.user)
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program = program_services.start_program(athlete, "P", athlete.today(), 1, week_type, by=coach.user)
    week = program.weeks.get()
    with committed():
        program_services.set_published(week, True)
        program_services.set_published(week, False)
    shown, silent = outbox
    assert shown["title"] == "New training week" and shown["data"]["type"] == "week"
    assert "title" not in silent and silent["_contentAvailable"] and silent["data"] == {"sync": True}


def test_signed_out_devices_get_nothing(athlete, coach, outbox, committed):
    session = device(athlete.user)
    signin.sign_out(session)
    with committed():
        messaging.send(messaging.thread_for(athlete), coach.user, "Hello?")
    assert outbox == []


def test_expo_delivery_forgets_gone_devices_and_never_fails_the_request(
    athlete, coach, settings, monkeypatch, caplog, committed
):
    settings.PUSH_PROVIDER = "expo"
    gone = device(athlete.user)
    posted = []

    def expo(messages):
        posted.append(messages)
        return {"data": [{"status": "error", "message": "gone", "details": {"error": "DeviceNotRegistered"}}]}

    monkeypatch.setattr(push, "_post", expo)
    with committed():
        messaging.send(messaging.thread_for(athlete), coach.user, "One")
    gone.refresh_from_db()
    assert posted and gone.push_token == ""

    push.register(gone, TOKEN)

    def down(messages):
        raise TimeoutError("exp.host timed out")

    monkeypatch.setattr(push, "_post", down)
    with committed():
        message = messaging.send(messaging.thread_for(athlete), coach.user, "Two")
    assert message.pk and "push to user" in caplog.text


def test_the_push_token_endpoints(athlete):
    tokens = signin.open_session(athlete.user)
    api = Client(HTTP_AUTHORIZATION=f"Bearer {tokens.access}")
    put = api.put("/api/v1/auth/push-token", json.dumps({"token": TOKEN}), content_type="application/json")
    assert put.status_code == 204
    assert DeviceSession.objects.get(pk=tokens.session.pk).push_token == TOKEN
    bad = api.put("/api/v1/auth/push-token", json.dumps({"token": "x"}), content_type="application/json")
    assert bad.status_code == 400 and "token" in bad.json()["error"]["fields"]
    assert api.delete("/api/v1/auth/push-token").status_code == 204
    assert DeviceSession.objects.get(pk=tokens.session.pk).push_token == ""
    assert Client().put("/api/v1/auth/push-token", "{}", content_type="application/json").status_code == 401


def test_push_settings_are_checked():
    assert checks.push(" Expo ") == "expo"
    with pytest.raises(ImproperlyConfigured):
        checks.push("expoo")
    base = {"email_provider": "console", "from_email": "a@b.c", "site_url": "https://x.example"}
    assert any("PUSH_PROVIDER" in p for p in checks.production_problems(**base, push_provider=""))
    assert not checks.production_problems(**base, push_provider="expo")
