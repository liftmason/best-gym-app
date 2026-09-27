"""A coach's athlete endpoints: profile, archiving, metrics, invites. Ownership is the
permission sweep's job (test_permission_sweep.py); these check what the endpoints do."""

import pytest
from django.test import Client

from apps.accounts.models import BodyweightEntry, Invite, MaxUpdates
from apps.signin import services as signin

pytestmark = pytest.mark.django_db


@pytest.fixture
def api(coach):
    return Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(coach.user).access}")


def put(api, path, data):
    return api.put(f"/api/v1{path}", data, content_type="application/json")


def post(api, path, data=None):
    return api.post(f"/api/v1{path}", data or {}, content_type="application/json")


def test_an_athlete_and_their_metrics_in_the_gyms_unit(api, athlete, gym):
    gym.units = "lb"
    gym.save()
    response = put(api, f"/athletes/{athlete.pk}/metrics/bodyweight", {"value": "180"})
    assert response.status_code == 200
    bodyweight = next(m for m in response.json() if m["key"] == "bodyweight")
    assert bodyweight["value"] == "180 lb" and bodyweight["source"] == "Coach"
    assert float(BodyweightEntry.objects.get().kg) == pytest.approx(81.65, abs=0.01)
    body = api.get(f"/api/v1/athletes/{athlete.pk}").json()
    assert body["athlete"]["name"] == "Maya Torres" and "bodyweight" not in body["missing_metrics"]
    history = api.get(f"/api/v1/athletes/{athlete.pk}/metrics").json()["history"]
    assert history[0]["what"] == "Bodyweight" and history[0]["value"] == "180 lb"


def test_a_bad_metric_says_why(api, athlete):
    response = put(api, f"/athletes/{athlete.pk}/metrics/bodyweight", {"value": "heavy"})
    assert response.status_code == 400 and response.json()["error"]["message"]
    assert put(api, f"/athletes/{athlete.pk}/metrics/nonsense", {"value": "1"}).status_code == 404


def test_reminders_go_once_a_day(api, athlete, mailoutbox):
    assert post(api, f"/athletes/{athlete.pk}/remind-metrics").json()["missing"]
    assert post(api, f"/athletes/{athlete.pk}/remind-metrics").status_code == 429
    assert len(mailoutbox) == 1


def test_max_updates_and_archiving(api, athlete):
    assert put(api, f"/athletes/{athlete.pk}/max-updates", {"value": "auto"}).status_code == 204
    athlete.refresh_from_db()
    assert athlete.max_updates == MaxUpdates.AUTO
    assert put(api, f"/athletes/{athlete.pk}/max-updates", {"value": "sometimes"}).status_code == 400
    assert post(api, f"/athletes/{athlete.pk}/archive").status_code == 204
    assert api.get(f"/api/v1/athletes/{athlete.pk}").status_code == 404  # no longer theirs
    assert api.get("/api/v1/roster").json() == []


def test_invites(api, coach, mailoutbox):
    created = post(api, "/invites", {"email": "pat@example.com"})
    assert created.status_code == 201
    body = created.json()
    assert body["email_sent"] and body["link"].endswith(f"/join/{Invite.objects.get().token}/")
    assert [i["email"] for i in api.get("/api/v1/invites").json()] == ["pat@example.com"]
    assert post(api, f"/invites/{body['id']}/resend").status_code == 204 and len(mailoutbox) == 2
    assert post(api, f"/invites/{body['id']}/revoke").status_code == 204
    assert api.get("/api/v1/invites").json() == []
    assert post(api, "/invites", {"email": "nope"}).status_code == 400


def test_an_invite_can_start_the_athlete_on_a_template(api, coach, gym):
    from apps.library import services as library
    from apps.library.models import TemplateKind

    template = library.new_template(gym, TemplateKind.PROGRAM, coach.user)
    choices = api.get("/api/v1/invites/templates").json()
    assert [c["id"] for c in choices] == [str(template.pk)]
    created = post(api, "/invites", {"starting_template_id": str(template.pk)}).json()
    assert created["starting_template"] == template.display_name and not created["email_sent"]
    wrong = post(api, "/invites", {"starting_template_id": "01a0d425-0000-7000-8000-000000000000"})
    assert wrong.status_code == 400 and "starting_template_id" in wrong.json()["error"]["fields"]


# ---------------------------------------------------------------- training


def _log(athlete, gym, days_ago, load=105):
    import datetime

    from django.utils import timezone

    from apps.workouts.models import SessionExercise, SessionLog, SetLog

    from ..conftest import ex

    date = athlete.today() - datetime.timedelta(days=days_ago)
    at = timezone.now() - datetime.timedelta(days=days_ago)
    log = SessionLog.objects.create(
        athlete=athlete, date=date, started_at=at, finished_at=at, name="Snatch day"
    )
    se = SessionExercise.objects.create(session_log=log, exercise=ex(gym, "sn"), exercise_name="Snatch")
    SetLog.objects.create(session_exercise=se, set_number=1, load_kg=load, reps=1, done=True)
    return log


def test_the_overview(api, athlete, gym):
    for days_ago in (2, 9, 16):
        _log(athlete, gym, days_ago, load=100 + days_ago)
    body = api.get(f"/api/v1/athletes/{athlete.pk}/overview").json()
    assert len(body["week"]) == 7 and body["top_prs"][0]["name"] == "Snatch"
    assert body["chart"]["lift"]["name"] == "Snatch" and len(body["chart"]["points"]) == 3
    assert len(body["weekly"]) == 8


def test_sessions_come_a_page_at_a_time(api, athlete, gym):
    for days_ago in range(5):
        _log(athlete, gym, days_ago)
    first = api.get(f"/api/v1/athletes/{athlete.pk}/sessions?limit=3").json()
    rest = api.get(f"/api/v1/athletes/{athlete.pk}/sessions?limit=3&before={first['next']}").json()
    dates = [s["date"] for s in first["items"] + rest["items"]]
    assert len(dates) == 5 and dates == sorted(dates, reverse=True) and rest["next"] is None
    line = first["items"][0]["exercises"][0]
    assert line["name"] == "Snatch" and line["did"] == "1×1 @ 105 kg"


def test_a_new_coach_sees_only_what_the_athlete_allows(athlete, coach, gym, frozen_clock):
    import datetime

    from apps.accounts import coaching

    from ..factories import CoachFactory

    _log(athlete, gym, 3)
    coaching.end(athlete)
    frozen_clock.shift(datetime.timedelta(days=1))
    new_coach = CoachFactory(gym=gym)
    coaching.start(new_coach, athlete)
    _log(athlete, gym, 0)
    client = Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(new_coach.user).access}")

    def count():
        return len(client.get(f"/api/v1/athletes/{athlete.pk}/sessions?range=all").json()["items"])

    assert count() == 2  # full earlier history by default
    athlete.hide_history_before_link = True
    athlete.save()
    assert count() == 1
    assert len(client.get(f"/api/v1/athletes/{athlete.pk}/overview").json()["chart"]["points"]) == 1


def test_a_pr_waiting_for_the_coach(api, athlete, gym):
    from apps.accounts.models import MaxEntry

    from ..conftest import ex

    MaxEntry.objects.create(
        athlete=athlete, exercise=ex(gym, "sn"), date=athlete.today(), kg=100, source="coach"
    )
    _log(athlete, gym, 0, load=110)
    (pending,) = api.get(f"/api/v1/athletes/{athlete.pk}/prs").json()
    assert pending["lift"] == "110 kg ×1" and pending["current_max"] == "100 kg"
    assert post(api, f"/athletes/{athlete.pk}/prs/{pending['set_id']}", {"use": True}).status_code == 204
    assert api.get(f"/api/v1/athletes/{athlete.pk}/prs").json() == []
    again = post(api, f"/athletes/{athlete.pk}/prs/{pending['set_id']}", {"use": True})
    assert again.status_code == 409


def test_videos_and_issues(api, athlete, gym, monkeypatch):
    from django.utils import timezone

    from apps.workouts import issues, videos
    from apps.workouts.models import FormVideo

    monkeypatch.setattr(videos, "view_url", lambda key: f"https://bucket.example/{key}?signed")
    log = _log(athlete, gym, 0)
    video = FormVideo.objects.create(
        session_log=log,
        exercise_name="Snatch",
        key="v1",
        content_type="video/mp4",
        size=1,
        uploaded_at=timezone.now(),
    )
    assert api.get(f"/api/v1/athletes/{athlete.pk}/videos/{video.pk}").json()["url"].endswith("v1?signed")
    assert (
        post(api, f"/athletes/{athlete.pk}/videos/{video.pk}/review", {"feedback": "Hips late"}).status_code
        == 204
    )
    video.refresh_from_db()
    assert video.reviewed_at and athlete.threads.get().messages.get().body.endswith("Hips late")
    issue = issues.report(log, "pain", "Wrist")
    assert [i["text"] for i in api.get(f"/api/v1/athletes/{athlete.pk}/issues").json()] == ["Wrist"]
    assert post(api, f"/athletes/{athlete.pk}/issues/{issue.pk}/resolve").status_code == 204
    assert api.get(f"/api/v1/athletes/{athlete.pk}/issues").json() == []


# ---------------------------------------------------------------- messages, habits, questions


def test_messages(api, athlete, coach):
    from apps.messaging import services as messaging
    from apps.messaging.models import Thread

    assert api.get(f"/api/v1/athletes/{athlete.pk}/messages").json() == {"items": [], "next": None}
    sent = post(api, f"/athletes/{athlete.pk}/messages", {"body": "  Nice pull today  "})
    assert (
        sent.status_code == 201
        and sent.json()["sender"] == "coach"
        and sent.json()["body"] == "Nice pull today"
    )
    messaging.send(Thread.for_athlete(athlete), athlete.user, "Thanks!")
    items = api.get(f"/api/v1/athletes/{athlete.pk}/messages").json()["items"]
    assert [(m["sender"], m["read"]) for m in items] == [("athlete", False), ("coach", False)]
    assert post(api, f"/athletes/{athlete.pk}/messages/read").json() == {"marked": 1}
    assert post(api, f"/athletes/{athlete.pk}/messages", {"body": "   "}).status_code == 400


def test_messages_are_rate_limited(api, athlete):
    for _ in range(30):
        post(api, f"/athletes/{athlete.pk}/messages", {"body": "hi"})
    assert post(api, f"/athletes/{athlete.pk}/messages", {"body": "hi"}).status_code == 429


def test_habits(api, athlete):
    created = post(api, f"/athletes/{athlete.pk}/habits", {"name": "Sleep 8h", "emoji": "😴"})
    assert created.status_code == 201 and len(created.json()["last_seven"]) == 7
    assert post(api, f"/athletes/{athlete.pk}/habits", {"name": "Sleep 8h"}).status_code == 409
    habit_id = created.json()["id"]
    assert post(api, f"/athletes/{athlete.pk}/habits/{habit_id}/archive").status_code == 204
    assert all(h["id"] != habit_id for h in api.get(f"/api/v1/athletes/{athlete.pk}/habits").json())


def test_check_in_questions(api, athlete):
    q = post(api, f"/athletes/{athlete.pk}/questions", {"type": "choice"}).json()
    base = f"/athletes/{athlete.pk}/questions/{q['id']}"
    reworded = api.patch(f"/api/v1{base}", {"text": "Anything sore?"}, content_type="application/json")
    assert reworded.json()["text"] == "Anything sore?"
    with_option = post(api, f"{base}/options", {"option": "Knees"}).json()
    assert "Knees" in with_option["options"]
    index = with_option["options"].index("Knees")
    assert "Knees" not in api.delete(f"/api/v1{base}/options/{index}").json()["options"]
    assert post(api, f"{base}/move", {"direction": "sideways"}).status_code == 400
    reset = post(api, f"/athletes/{athlete.pk}/reset-questions").json()
    assert q["id"] not in [x["id"] for x in reset]
