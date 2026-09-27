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
