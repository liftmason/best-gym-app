"""Templates, saved weeks and sessions, and applying them, through the API."""

import pytest
from django.db import connection
from django.test import Client
from django.test.utils import CaptureQueriesContext

from apps.library.models import Template, TemplateApplication
from apps.programs.models import Program
from apps.signin import services as signin

from ..conftest import ex

pytestmark = pytest.mark.django_db


@pytest.fixture
def api(coach):
    return Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(coach.user).access}")


def call(api, method, path, data=None):
    return getattr(api, method)(f"/api/v1{path}", data or {}, content_type="application/json")


@pytest.fixture
def editor(api):
    response = call(api, "post", "/templates", {"kind": "program"})
    assert response.status_code == 201
    return response.json()


def first_session(editor):
    return editor["weeks"][0]["sessions"][0]


def test_a_new_template_and_its_settings(api, editor):
    assert editor["kind"] == "program" and editor["weeks"] and editor["stats"]["weeks"] == 1
    patched = call(
        api, "patch", f"/templates/{editor['id']}", {"name": "Strength block", "sessions_per_week": 4}
    ).json()
    assert patched["name"] == "Strength block" and patched["sessions_per_week"] == 4
    assert call(api, "patch", f"/templates/{editor['id']}", {"sessions_per_week": 9}).status_code == 400
    cards = api.get("/api/v1/templates?kind=program").json()
    assert [c["name"] for c in cards] == ["Strength block"]


def test_slots_fixed_and_tag_based(api, editor, gym):
    base = f"/templates/{editor['id']}"
    session = first_session(editor)["id"]
    after = call(
        api, "post", f"{base}/template-sessions/{session}/slots", {"exercise_id": str(ex(gym, "sn").pk)}
    ).json()
    slot = first_session(after)["slots"][0]
    assert slot["kind"] == "exercise" and slot["exercise"]["name"] == "Snatch"

    tag = ex(gym, "sn").tags.first()
    after = call(api, "post", f"{base}/template-sessions/{session}/slots", {"tag_ids": [str(tag.pk)]}).json()
    tagged = first_session(after)["slots"][1]
    assert tagged["kind"] == "tag" and tagged["tags"] == [{"id": str(tag.pk), "name": tag.name}]

    detail = api.get(f"/api/v1{base}/slots/{slot['id']}").json()
    dose = detail["dose"] | {"sets": 4, "load_basis": "percent", "load_value": "75"}
    edited = call(
        api,
        "put",
        f"{base}/slots/{slot['id']}",
        {"kind": "exercise", "exercise_id": str(ex(gym, "sn").pk), "dose": dose},
    )
    assert edited.status_code == 200 and "75%" in edited.json()["summary"]
    wrong = call(
        api,
        "put",
        f"{base}/slots/{slot['id']}",
        {"kind": "tag", "tag_ids": [str(tag.pk)], "default_id": str(ex(gym, "bsq").pk)},
    )
    assert wrong.status_code == 400  # a default must carry every tag

    moved = call(api, "post", f"{base}/slots/{slot['id']}/move", {"session_id": session, "index": 1}).json()
    assert [s["id"] for s in first_session(moved)["slots"]][1] == slot["id"]
    removed = call(api, "delete", f"{base}/slots/{slot['id']}").json()
    assert len(first_session(removed)["slots"]) == 1


def test_weeks_sessions_and_habits(api, editor, gym):
    base = f"/templates/{editor['id']}"
    session = first_session(editor)["id"]
    call(api, "post", f"{base}/template-sessions/{session}/slots", {"exercise_id": str(ex(gym, "sn").pk)})
    slot = first_session(api.get(f"/api/v1{base}").json())["slots"][0]
    detail = api.get(f"/api/v1{base}/slots/{slot['id']}").json()
    call(
        api,
        "put",
        f"{base}/slots/{slot['id']}",
        {
            "kind": "exercise",
            "exercise_id": str(ex(gym, "sn").pk),
            "dose": detail["dose"] | {"load_basis": "percent", "load_value": "70"},
        },
    )

    bumped = call(api, "post", f"{base}/weeks", {"points": "2.5"})
    assert (
        bumped.status_code == 201
        and "72.5%" in bumped.json()["weeks"][1]["sessions"][0]["slots"][0]["summary"]
    )
    assert call(api, "post", f"{base}/weeks", {"points": "lots"}).status_code == 400
    week2 = bumped.json()["weeks"][1]["id"]
    assert (
        call(api, "patch", f"{base}/weeks/{week2}", {"focus_note": "Heavier"}).json()["weeks"][1][
            "focus_note"
        ]
        == "Heavier"
    )
    assert len(call(api, "post", f"{base}/weeks/{week2}/duplicate").json()["weeks"]) == 3
    left = call(api, "delete", f"{base}/weeks/{week2}").json()["weeks"]
    assert len(left) == 2
    second = left[1]["id"]  # the copy, now week 2

    added = call(api, "post", f"{base}/weeks/{second}/sessions", {"name": "Extra"}).json()
    extra = added["weeks"][1]["sessions"][-1]
    assert extra["name"] == "Extra"
    assert call(api, "patch", f"{base}/template-sessions/{extra['id']}", {"name": "Bonus"}).status_code == 200
    assert call(api, "delete", f"{base}/template-sessions/{extra['id']}").status_code == 200

    habit = call(api, "post", f"{base}/habits", {"name": "Sleep", "emoji": "😴"}).json()["habits"][0]
    assert call(api, "delete", f"{base}/habits/{habit['id']}").json()["habits"] == []


def test_saving_parts_and_using_them(api, editor, gym, athlete):
    base = f"/templates/{editor['id']}"
    week = editor["weeks"][0]["id"]
    session = first_session(editor)["id"]
    call(api, "post", f"{base}/template-sessions/{session}/slots", {"exercise_id": str(ex(gym, "sn").pk)})
    saved_week = call(api, "post", f"{base}/weeks/{week}/save", {}).json()
    saved_session = call(
        api, "post", f"{base}/template-sessions/{session}/save", {"name": "Snatch day"}
    ).json()
    assert saved_week["kind"] == "week" and saved_session["exercises"] == ["Snatch"]
    other = call(api, "post", "/templates", {"kind": "program"}).json()
    options = api.get(f"/api/v1/templates/{other['id']}/saved?kind=session").json()
    assert [o["name"] for o in options] == ["Snatch day"]
    used = call(
        api,
        "post",
        f"/templates/{other['id']}/use-saved",
        {"kind": "session", "source_id": saved_session["id"], "template_week_id": other["weeks"][0]["id"]},
    )
    assert used.status_code == 201 and used.json()["weeks"][0]["sessions"][-1]["name"] == "Snatch day"
    assert call(api, "delete", f"/templates/{other['id']}").status_code == 204


@pytest.fixture
def block(api, editor, gym):
    """A two-week template with a snatch in each session."""
    base = f"/templates/{editor['id']}"
    for s in editor["weeks"][0]["sessions"]:
        call(api, "post", f"{base}/template-sessions/{s['id']}/slots", {"exercise_id": str(ex(gym, "sn").pk)})
    call(api, "post", f"{base}/weeks", {})
    return Template.objects.get(pk=editor["id"])


def test_previewing_writes_nothing_and_shows_what_confirming_writes(api, block, athlete):
    base = f"/athletes/{athlete.pk}/apply"
    assert [s["id"] for s in api.get(f"/api/v1{base}/sources").json()] == [str(block.pk)]
    with CaptureQueriesContext(connection) as ctx:
        shown = call(api, "post", f"{base}/preview", {"template_id": str(block.pk)}).json()
    assert not [
        q
        for q in ctx.captured_queries
        if q["sql"].split()[0] in ("INSERT", "UPDATE", "DELETE") and "signin_devicesession" not in q["sql"]
    ]
    assert shown["choices"]["days"] and shown["choices"]["start"] == shown["placements"][0]["value"]
    assert shown["summary"]["weeks"] == len(shown["weeks"]) == 2 and shown["summary"]["new_program"]
    assert shown["weeks"][0]["days"][0]["exercises"][0]["exercise"] == "Snatch"

    applied = call(api, "post", base, shown["choices"] | {"template_id": str(block.pk)})
    assert applied.status_code == 201
    program = Program.objects.get(pk=applied.json()["program_id"])
    assert program.weeks.count() == 2 and TemplateApplication.objects.count() == 1


def test_a_stale_start_is_refused(api, block, athlete):
    response = call(
        api, "post", f"/athletes/{athlete.pk}/apply", {"template_id": str(block.pk), "start": "at:gone"}
    )
    assert response.status_code == 409 and response.json()["error"]["code"] == "cannot_apply"


def test_saving_a_board_into_the_library(api, athlete, coach, gym):
    from apps.programs import services as program_services

    week_type = gym.week_types.get(name="Accumulation")
    program = program_services.start_program(athlete, "Block", athlete.today(), 1, week_type, by=coach.user)
    week = program.weeks.get()
    program_services.add_prescription(week.days.first(), ex(gym, "sn"), athlete)
    saved = call(api, "post", f"/athletes/{athlete.pk}/weeks/{week.pk}/save", {}).json()
    assert saved["kind"] == "week" and saved["name"].startswith("Accumulation")
    whole = call(api, "post", f"/athletes/{athlete.pk}/program/save", {}).json()
    assert whole["kind"] == "program" and "Block" in whole["name"]
    session = week.days.first().sessions.get()
    one = call(api, "post", f"/athletes/{athlete.pk}/planned-sessions/{session.pk}/save", {}).json()
    assert one["kind"] == "session" and one["exercises"] == ["Snatch"]
