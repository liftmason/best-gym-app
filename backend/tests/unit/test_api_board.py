"""The program board endpoints. Ownership is the permission sweep's job; these check what
the board does through the API."""

import pytest
from django.test import Client

from apps.signin import services as signin

from ..conftest import ex

pytestmark = pytest.mark.django_db


@pytest.fixture
def api(coach):
    return Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(coach.user).access}")


def call(api, method, path, data=None):
    response = getattr(api, method)(f"/api/v1{path}", data or {}, content_type="application/json")
    return response


@pytest.fixture
def board(api, athlete, gym):
    """A two-week block started from the board; returns the board's JSON."""
    week_type = gym.week_types.get(name="Accumulation")
    body = {
        "name": "Block 1",
        "first_day": str(athlete.today()),
        "weeks": 2,
        "week_type_id": str(week_type.pk),
    }
    response = call(api, "post", f"/athletes/{athlete.pk}/program", body)
    assert response.status_code == 201, response.content
    return response.json()


def test_no_program_yet(api, athlete):
    body = api.get(f"/api/v1/athletes/{athlete.pk}/program").json()
    assert body["program"] is None and body["week"] is None and body["week_types"]


def test_starting_a_block_opens_on_this_week(board, athlete):
    assert board["program"]["name"] == "Block 1" and len(board["weeks"]) == 2
    week = board["week"]
    assert len(week["days"]) == 7 and week["undo"] is None and not week["published"]
    assert any(d["date"] == str(athlete.today()) for d in week["days"])


def test_adding_editing_and_undoing_an_exercise(api, board, athlete, gym):
    gym.units = "lb"
    gym.save()
    day = board["week"]["days"][0]["id"]
    added = call(
        api,
        "post",
        f"/athletes/{athlete.pk}/days/{day}/prescriptions",
        {"exercise_id": str(ex(gym, "bsq").pk)},
    )
    assert added.status_code == 201
    rx = added.json()
    dose = rx["dose"] | {
        "sets": 5,
        "rep_scheme": "3",
        "load_basis": "weight",
        "load_value": "225",
        "rir": "1-2",
    }
    edited = call(api, "put", f"/athletes/{athlete.pk}/prescriptions/{rx['id']}", dose).json()
    assert (
        edited["dose"]["load_value"] == "225"
        and "225 lb" in edited["summary"]
        and "RIR 1–2" in edited["summary"]
    )
    bad = call(api, "put", f"/athletes/{athlete.pk}/prescriptions/{rx['id']}", dose | {"sets": 0})
    assert bad.status_code == 400 and "sets" in bad.json()["error"]["fields"]
    week = api.get(f"/api/v1/athletes/{athlete.pk}/program").json()["week"]
    assert week["undo"] == "Edit Back Squat"
    week_id = week["id"]
    assert call(api, "post", f"/athletes/{athlete.pk}/weeks/{week_id}/undo").json() == {
        "undone": "Edit Back Squat"
    }
    again = api.get(f"/api/v1/athletes/{athlete.pk}/prescriptions/{rx['id']}").json()
    assert again["dose"]["sets"] == rx["dose"]["sets"]


def test_moving_and_swapping(api, board, athlete, gym):
    days = board["week"]["days"]
    base = f"/athletes/{athlete.pk}"
    first = call(
        api, "post", f"{base}/days/{days[0]['id']}/prescriptions", {"exercise_id": str(ex(gym, "sn").pk)}
    ).json()
    call(api, "post", f"{base}/days/{days[1]['id']}/prescriptions", {"exercise_id": str(ex(gym, "cj").pk)})
    week = api.get(f"/api/v1{base}/program").json()["week"]
    target = week["days"][1]["sessions"][0]["id"]
    assert (
        call(
            api, "post", f"{base}/prescriptions/{first['id']}/move", {"session_id": target, "index": 0}
        ).status_code
        == 204
    )
    week = api.get(f"/api/v1{base}/program").json()["week"]
    assert [i["exercise"]["name"] for i in week["days"][1]["sessions"][0]["items"]] == [
        "Snatch",
        "Clean & Jerk",
    ]
    swap_to = first["swaps"][0]
    swapped = call(
        api, "post", f"{base}/prescriptions/{first['id']}/swap", {"exercise_id": swap_to["id"]}
    ).json()
    assert swapped["exercise"]["name"] == swap_to["name"]
    from apps.exercises.models import Exercise

    offered = {s["id"] for s in swapped["swaps"]} | {swapped["exercise"]["id"]}
    outsider = Exercise.objects.filter(gym=gym).exclude(pk__in=offered).first()
    not_a_swap = call(
        api, "post", f"{base}/prescriptions/{first['id']}/swap", {"exercise_id": str(outsider.pk)}
    )
    assert not_a_swap.status_code == 400


def test_week_settings_publish_duplicate_and_delete(api, board, athlete):
    base = f"/athletes/{athlete.pk}"
    week_id = board["week"]["id"]
    patched = call(
        api, "patch", f"{base}/weeks/{week_id}", {"published": True, "focus_note": "Technique"}
    ).json()
    assert patched["published"] and patched["focus_note"] == "Technique"
    copy = call(api, "post", f"{base}/weeks/{week_id}/duplicate")
    assert copy.status_code == 201 and not copy.json()["published"]
    assert len(api.get(f"/api/v1{base}/program").json()["weeks"]) == 3
    assert call(api, "delete", f"{base}/weeks/{copy.json()['id']}").status_code == 204
    added = call(api, "post", f"{base}/program/weeks")
    assert added.status_code == 201 and added.json()["label"] == "Wk 3"
    cleared = call(api, "post", f"{base}/weeks/{week_id}/clear").json()
    assert cleared["kept"] == 0 and cleared["undo"] == "Clear Wk 1"


def test_sessions_on_a_day(api, board, athlete):
    base = f"/athletes/{athlete.pk}"
    day = board["week"]["days"][2]["id"]
    # The first add on an empty day makes two ("Session 1" and "Session 2"); three is the most.
    for _ in range(2):
        assert call(api, "post", f"{base}/days/{day}/sessions").status_code == 201
    assert call(api, "post", f"{base}/days/{day}/sessions").status_code == 409
    sessions = next(d for d in api.get(f"/api/v1{base}/program").json()["week"]["days"] if d["id"] == day)[
        "sessions"
    ]
    assert (
        call(api, "patch", f"{base}/planned-sessions/{sessions[0]['id']}", {"name": "AM"}).status_code == 204
    )
    assert call(api, "delete", f"{base}/planned-sessions/{sessions[1]['id']}").status_code == 204


def test_the_rail_searches_the_gyms_exercises_with_history(api, athlete, gym):
    names = [e["name"] for e in api.get(f"/api/v1/athletes/{athlete.pk}/rail?q=snatch&sort=az").json()]
    assert "Snatch" in names and all("Squat" not in n for n in names if "Snatch" not in n)
    tag = gym.tags.first()
    tagged = api.get(f"/api/v1/athletes/{athlete.pk}/rail?tags={tag.pk}").json()
    assert tagged and all(tag.name in e["tags"] for e in tagged)
