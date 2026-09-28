"""The exercise library, categories and tags through the API."""

import pytest
from django.test import Client

from apps.exercises.models import Exercise
from apps.signin import services as signin

from ..conftest import ex

pytestmark = pytest.mark.django_db


@pytest.fixture
def api(coach):
    return Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(coach.user).access}")


def call(api, method, path, data=None):
    return getattr(api, method)(f"/api/v1{path}", data or {}, content_type="application/json")


def test_searching_the_library(api, gym):
    names = [e["name"] for e in api.get("/api/v1/exercises?q=snatch").json()]
    assert "Snatch" in names and "Back Squat" not in names
    snatch = next(e for e in api.get("/api/v1/exercises").json() if e["name"] == "Snatch")
    assert snatch["tracked"] and snatch["category"]["name"]


def test_creating_and_editing_an_exercise(api, gym):
    category = gym.categories.first()
    tag = gym.tags.first()
    body = {
        "name": "Tall Snatch",
        "category_id": str(category.pk),
        "tag_ids": [str(tag.pk)],
        "youtube_url": "youtu.be/x",
    }
    created = call(api, "post", "/exercises", body)
    assert created.status_code == 201
    made = created.json()
    assert (
        made["tags"] == [{"id": str(tag.pk), "name": tag.name}]
        and made["youtube_url"] == "https://youtu.be/x"
    )
    clash = call(api, "post", "/exercises", body | {"name": "tall snatch"})
    assert clash.status_code == 400 and "name" in clash.json()["error"]["fields"]
    percent = call(api, "put", f"/exercises/{made['id']}", body | {"percent_of_id": str(ex(gym, "sn").pk)})
    assert percent.json()["percent_of"]["name"] == "Snatch"
    choices = [c["name"] for c in api.get(f"/api/v1/exercises/{made['id']}/percent-of").json()]
    assert "Snatch" in choices and "Tall Snatch" not in choices


def test_unknown_tags_and_categories_are_refused(api, gym):
    from ..factories import GymFactory

    elsewhere = GymFactory(pack="weightlifting")
    body = {"name": "Odd lift", "category_id": str(elsewhere.categories.first().pk)}
    assert call(api, "post", "/exercises", body).status_code == 400
    body = {
        "name": "Odd lift",
        "category_id": str(gym.categories.first().pk),
        "tag_ids": [str(elsewhere.tags.first().pk)],
    }
    assert call(api, "post", "/exercises", body).json()["error"]["fields"] == {
        "tag_ids": "Pick from your own tags."
    }


def test_archiving_restoring_and_deleting(api, gym):
    lift = ex(gym, "hsn")
    assert call(api, "delete", f"/exercises/{lift.pk}").status_code == 409  # archive first
    assert call(api, "post", f"/exercises/{lift.pk}/archive").json() == {
        "was_tracked": False,
        "percent_users": 0,
    }
    assert [e["name"] for e in api.get("/api/v1/exercises?archived=true").json()] == [lift.name]
    impact = api.get(f"/api/v1/exercises/{lift.pk}/deletion").json()
    assert impact["logged"] == 0 and impact["prescriptions"] == 0
    assert call(api, "delete", f"/exercises/{lift.pk}").status_code == 200
    assert not Exercise.objects.filter(pk=lift.pk).exists()


def test_categories_and_tags(api, gym):
    added = call(api, "post", "/categories", {"name": "Accessories"}).json()
    accessories = next(c for c in added if c["name"] == "Accessories")
    moved = call(api, "post", f"/categories/{accessories['id']}/move", {"direction": "up"}).json()
    assert [c["name"] for c in moved].index("Accessories") == len(moved) - 2
    busy = next(c for c in moved if c["exercises"])
    refused = call(api, "post", f"/categories/{busy['id']}/delete", {})
    assert refused.status_code == 400
    kept = call(api, "post", f"/categories/{busy['id']}/delete", {"move_to_id": accessories["id"]}).json()
    assert next(c for c in kept if c["name"] == "Accessories")["exercises"] == busy["exercises"]

    tag = call(api, "post", "/tags", {"name": "Explosive"}).json()
    assert call(api, "patch", f"/tags/{tag['id']}", {"name": "Speed work"}).json()["name"] == "Speed work"
    assert call(api, "delete", f"/tags/{tag['id']}").status_code == 204


def test_adding_a_starter_pack_later_adds_only_whats_missing(api, gym):
    before = Exercise.objects.filter(gym=gym).count()
    added = call(api, "post", "/starter-exercises", {"pack": "general"}).json()["added"]
    assert added > 0 and Exercise.objects.filter(gym=gym).count() == before + added
    assert call(api, "post", "/starter-exercises", {"pack": "general"}).json() == {"added": 0}
    refused = call(api, "post", "/starter-exercises", {"pack": "yoga"})
    assert refused.status_code == 400
    assert refused.json()["error"]["fields"] == {"pack": "Pick one of the starter packs."}
