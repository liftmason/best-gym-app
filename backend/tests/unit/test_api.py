"""The API's plumbing and sign-in endpoints (/api/v1/): the error shape, bearer tokens, the
web app's refresh cookie, joining through an invite, and the committed OpenAPI schema."""

import re

import pytest
from django.test import Client

from apps.accounts import coaching, invites
from apps.api.management.commands.openapi import PATH, schema_text
from apps.signin import services as signin

from ..factories import AthleteFactory

pytestmark = pytest.mark.django_db
WEB = {"HTTP_X_CLIENT": "web"}


@pytest.fixture
def api():
    return Client()


def post(api, path, data=None, **extra):
    return api.post(f"/api/v1{path}", data or {}, content_type="application/json", **extra)


def get(api, path, token=None, **extra):
    if token:
        extra["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    return api.get(f"/api/v1{path}", **extra)


def sign_in(api, mailoutbox, email, **extra):
    """Start and verify a code; returns the verify response's JSON."""
    assert post(api, "/auth/email/start", {"email": email}).status_code == 202
    code = re.search(r"\b(\d{6})\b", mailoutbox[-1].body).group(1)
    response = post(api, "/auth/email/verify", {"email": email, "code": code, "device": "test"}, **extra)
    assert response.status_code == 200, response.content
    return response


def test_the_committed_openapi_schema_is_current():
    assert PATH.read_text() == schema_text(), "run: python manage.py openapi"


def test_errors_have_one_shape(api):
    response = get(api, "/me")
    assert response.status_code == 401
    assert response.json() == {"error": {"code": "not_signed_in", "message": "Sign in again.", "fields": {}}}
    response = post(api, "/auth/email/start", {})
    assert response.status_code == 400 and "email" in response.json()["error"]["fields"]
    response = post(api, "/auth/email/start", {"email": "nope"})
    assert response.json()["error"] == {
        "code": "invalid",
        "message": "Enter a valid email address.",
        "fields": {"email": "Enter a valid email address."},
    }
    response = api.post("/api/v1/auth/email/start", "{not json", content_type="application/json")
    assert response.status_code == 400 and response.json()["error"]["code"] == "invalid_request"


def test_an_athlete_signs_in_with_a_code(api, athlete, mailoutbox):
    body = sign_in(api, mailoutbox, "Maya@example.com").json()
    assert body["signed_in"] and body["ticket"] is None
    me = get(api, "/me", body["tokens"]["access"]).json()
    assert me["email"] == "maya@example.com" and me["coach"] is None
    assert me["athlete"]["coach_name"] == "Dana Whitfield"


def test_a_new_coach_signs_up_with_a_ticket(api, mailoutbox):
    body = sign_in(api, mailoutbox, "sam@example.com").json()
    assert not body["signed_in"] and body["ticket"]
    response = post(
        api,
        "/auth/signup/coach",
        {
            "ticket": body["ticket"],
            "name": "Sam Lee",
            "gym_name": "Barbell Club",
            "timezone": "Europe/London",
        },
    )
    assert response.status_code == 201
    me = get(api, "/me", response.json()["access"]).json()
    assert me["coach"]["gym"]["name"] == "Barbell Club" and me["coach"]["role"] == "owner"
    again = post(api, "/auth/signup/coach", {"ticket": body["ticket"], "name": "Sam", "gym_name": "Two"})
    assert again.status_code == 409 and again.json()["error"]["code"] == "account_exists"


def test_a_new_coach_picks_from_the_servers_starter_packs(api):
    from apps.exercises.starter import PACKS

    listed = get(api, "/auth/signup/starters").json()
    assert [p["key"] for p in listed] == list(PACKS) and all(p["label"] and p["description"] for p in listed)


def test_both_sign_ups_declare_their_tokens_in_the_schema():
    """They answer through signed_in(), which Ninja doesn't check: the schema must say so."""
    import json

    paths = json.loads(schema_text())["paths"]
    for path in ("/api/v1/auth/signup/coach", "/api/v1/join/{token}/signup"):
        answer = paths[path]["post"]["responses"]["201"]["content"]["application/json"]["schema"]
        assert answer["$ref"].endswith("/TokensOut"), path


def test_refresh_signout_and_devices(api, athlete, mailoutbox):
    first = sign_in(api, mailoutbox, "maya@example.com").json()["tokens"]
    second = sign_in(api, mailoutbox, "maya@example.com").json()["tokens"]
    listed = get(api, "/auth/devices", second["access"]).json()
    assert len(listed) == 2 and sum(d["current"] for d in listed) == 1

    fresh = post(api, "/auth/refresh", {"refresh": first["refresh"]}).json()
    assert get(api, "/me", fresh["access"]).status_code == 200
    other = next(d["id"] for d in listed if not d["current"])
    auth = {"HTTP_AUTHORIZATION": f"Bearer {second['access']}"}
    assert post(api, f"/auth/devices/{other}/signout", **auth).status_code == 204
    assert get(api, "/me", fresh["access"]).status_code == 401
    assert post(api, "/auth/signout", **auth).status_code == 204
    assert get(api, "/me", second["access"]).status_code == 401


def test_the_web_app_keeps_its_refresh_token_in_a_cookie(api, athlete, mailoutbox):
    response = sign_in(api, mailoutbox, "maya@example.com", **WEB)
    assert response.json()["tokens"]["refresh"] is None
    cookie = response.cookies["gt_refresh"]
    assert cookie["httponly"] and cookie["path"] == "/api/v1/auth/" and cookie["samesite"] == "Lax"
    assert post(api, "/auth/refresh", **WEB).status_code == 200  # the client sends the cookie back
    assert post(api, "/auth/refresh").status_code == 401  # the cookie alone, without the header, isn't read


def test_joining_through_an_invite_as_a_new_account(api, coach, mailoutbox):
    invite = invites.create(coach, "new@example.com")
    preview = get(api, f"/join/{invite.token}").json()
    assert preview == {"coach_name": "Dana Whitfield", "gym_name": coach.gym.name, "email": "new@example.com"}
    ticket = sign_in(api, mailoutbox, "new@example.com").json()["ticket"]
    response = post(api, f"/join/{invite.token}/signup", {"ticket": ticket, "name": "Nia Park"})
    assert response.status_code == 201
    me = get(api, "/me", response.json()["access"]).json()
    assert me["name"] == "Nia Park" and me["athlete"]["coach_name"] == "Dana Whitfield"
    assert get(api, f"/join/{invite.token}").status_code == 410  # used
    assert get(api, "/join/not-a-token").status_code == 404


def test_an_athlete_without_a_coach_joins_a_new_one(api, athlete, coach, mailoutbox):
    coaching.end(athlete)
    invite = invites.create(coach)
    access = sign_in(api, mailoutbox, "maya@example.com").json()["tokens"]["access"]
    response = post(api, f"/join/{invite.token}/accept", HTTP_AUTHORIZATION=f"Bearer {access}")
    assert response.status_code == 200 and response.json()["athlete_id"] == str(athlete.pk)
    busy = signin.open_session(AthleteFactory(coach=coach).user)  # already has a coach
    auth = f"Bearer {busy.access}"
    again = post(api, f"/join/{invites.create(coach).token}/accept", HTTP_AUTHORIZATION=auth)
    assert again.status_code == 409 and again.json()["error"]["code"] == "already_athlete"
    # Say why and what to do: the default "That can't be done right now." said neither.
    assert again.json()["error"]["message"] == (
        "You already train with Dana Whitfield at Iron Ridge Weightlifting. An athlete has one coach"
        " at a time: ask Dana Whitfield to archive you, then open this link again."
    )


def test_code_requests_are_rate_limited(api, mailoutbox):
    for _ in range(5):
        post(api, "/auth/email/start", {"email": "maya@example.com"})
    response = post(api, "/auth/email/start", {"email": "maya@example.com"})
    assert response.status_code == 429 and response.json()["error"]["code"] == "too_many"


def test_the_web_app_may_call_the_api_from_its_own_origin(api, settings):
    settings.CORS_ALLOWED_ORIGINS = ["https://app.example.com"]
    response = api.options(
        "/api/v1/me",
        HTTP_ORIGIN="https://app.example.com",
        HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
        HTTP_ACCESS_CONTROL_REQUEST_HEADERS="authorization,x-client",
    )
    assert response["Access-Control-Allow-Origin"] == "https://app.example.com"
    assert response["Access-Control-Allow-Credentials"] == "true"
    syncing = api.options(
        "/api/v1/sync/pull",
        HTTP_ORIGIN="https://app.example.com",
        HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
        HTTP_ACCESS_CONTROL_REQUEST_HEADERS="authorization,x-client,x-schema-version",
    )
    assert "x-schema-version" in syncing["Access-Control-Allow-Headers"]
    other = api.options(
        "/api/v1/me", HTTP_ORIGIN="https://evil.example", HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET"
    )
    assert "Access-Control-Allow-Origin" not in other


def clashes(paths):
    """Pairs of paths one request could match both of: the same length, and at every place
    either the same word or a parameter on at least one side, with a word facing a
    parameter somewhere."""
    found = []
    for i, a in enumerate(paths):
        for b in paths[i + 1 :]:
            sa, sb = a.strip("/").split("/"), b.strip("/").split("/")
            if len(sa) != len(sb):
                continue
            pairs = list(zip(sa, sb, strict=True))
            param = [(x.startswith("{"), y.startswith("{")) for x, y in pairs]
            if all(x == y or px or py for (x, y), (px, py) in zip(pairs, param, strict=True)) and any(
                px != py for px, py in param
            ):
                found.append(f"{a} <-> {b}")
    return found


def test_the_clash_check_finds_a_word_behind_a_parameter():
    assert clashes(["/a/{id}/questions/{q}", "/a/{id}/questions/reset"])
    assert not clashes(["/a/{id}/questions/{q}", "/a/{id}/reset-questions", "/join/{token}", "/invites/x"])


def test_no_route_hides_behind_another():
    # Path parameters match any text, so /athletes/{id}/questions/reset would be caught by
    # /athletes/{id}/questions/{question_id} (a 405). Literal words go elsewhere in the path.
    from apps.api.main import api as ninja_api

    found = clashes(list(ninja_api.get_openapi_schema()["paths"]))
    assert not found, "\n".join(found)


def test_each_path_lives_in_one_router():
    # Django routes a path to the first router that has it, so GET /me in one router and
    # PATCH /me in another makes PATCH a 405.
    from apps.api.main import api as ninja_api

    seen, split = {}, []
    for prefix, router in ninja_api._routers:
        for path in router.path_operations:
            full = (prefix.rstrip("/") + "/" + path.lstrip("/")).rstrip("/")
            if full in seen and seen[full] is not router:
                split.append(full)
            seen[full] = router
    assert len(seen) > 50, "the check found too few paths: has Ninja's router list moved?"
    assert not split, split
