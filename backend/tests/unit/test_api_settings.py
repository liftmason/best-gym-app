"""A coach's settings through the API: the gym, week types, tracked lifts, default questions."""

import pytest
from django.test import Client

from apps.signin import services as signin

from ..conftest import ex

pytestmark = pytest.mark.django_db


@pytest.fixture
def api(coach):
    return Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(coach.user).access}")


def call(api, method, path, data=None):
    return getattr(api, method)(f"/api/v1{path}", data or {}, content_type="application/json")


def test_gym_settings(api):
    current = api.get("/api/v1/settings").json()
    changed = call(
        api, "put", "/settings", current | {"gym_name": "Iron Ridge WL", "units": "lb", "digest": False}
    )
    assert changed.status_code == 200 and changed.json()["units"] == "lb" and not changed.json()["digest"]
    bad = call(api, "put", "/settings", current | {"timezone": "Mars/Base"})
    assert bad.status_code == 400 and bad.json()["error"]["message"] == "Pick a real time zone."


def test_week_types(api, gym):
    added = call(api, "post", "/week-types", {"name": "Peak", "colour": "#aa3300"})
    peak = next(w for w in added.json() if w["name"] == "Peak")
    assert peak["colour"] == "#AA3300" and peak["uses"] == 0
    updated = call(api, "put", f"/week-types/{peak['id']}", {"name": "Peaking", "colour": "#AA3300"}).json()
    assert any(w["name"] == "Peaking" for w in updated)
    assert (
        call(api, "put", f"/week-types/{peak['id']}", {"name": "Peaking", "colour": "red"}).status_code == 400
    )
    assert call(api, "post", f"/week-types/{peak['id']}/remove").json() == {"archived": False, "uses": 0}

    from apps.programs.models import WeekType

    used = WeekType.objects.filter(gym=gym, archived=False).first()
    from apps.library import services as library

    library.new_template(gym, "program", None)  # its week uses the gym's first week type
    removed = call(api, "post", f"/week-types/{used.pk}/remove").json()
    assert removed["archived"] and removed["uses"] >= 1
    restored = call(api, "post", f"/week-types/{used.pk}/restore").json()
    assert not next(w for w in restored if w["id"] == str(used.pk))["archived"]


def test_tracked_lifts(api, gym):
    tracked = api.get("/api/v1/tracked-lifts").json()
    assert [t["exercise"]["name"] for t in tracked] == ["Snatch", "Clean & Jerk", "Back Squat"]
    choices = api.get("/api/v1/trackable-lifts").json()
    assert "Snatch" not in [c["name"] for c in choices]
    added = call(api, "post", "/tracked-lifts", {"exercise_id": str(ex(gym, "fsq").pk)}).json()
    assert added[-1]["exercise"]["name"] == "Front Squat"
    moved = call(api, "post", f"/tracked-lifts/{added[-1]['id']}/move", {"direction": "up"}).json()
    assert moved[-2]["exercise"]["name"] == "Front Squat"
    left = call(api, "delete", f"/tracked-lifts/{moved[0]['id']}").json()
    assert "Snatch" not in [t["exercise"]["name"] for t in left]


def test_default_questions_and_pushing_them(api, athlete):
    from apps.workouts import questions

    added = call(api, "post", "/default-questions", {"type": "text"})
    assert added.status_code == 201
    q = added.json()
    assert (
        call(api, "patch", f"/default-questions/{q['id']}", {"text": "Anything else?"}).json()["text"]
        == "Anything else?"
    )
    assert call(api, "post", "/push-default-questions").json() == {"athletes": 1}
    assert "Anything else?" in [x.text for x in questions.active(athlete)]
