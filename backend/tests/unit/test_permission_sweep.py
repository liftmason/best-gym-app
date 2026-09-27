"""The permission sweep (audit H15; docs/EXPO_MIGRATION.md, "Testing"). Every endpoint that
takes an id in its path is called with ids that belong to someone else, as each kind of
outsider, and must answer 404 (401 when signed out) and write nothing.

"Write nothing" means no INSERT, UPDATE or DELETE statement at all, not merely none that
changed a row: endpoints look the object up through its owner first and only then write.

The routes come from the API's own schema, so a new endpoint is swept automatically. Each
path parameter must be listed in PARAMS below with whose it is: a new one fails
`test_every_path_parameter_is_known` until it's added. Request bodies are built from the
schema, so the call gets past validation to the ownership check.
"""

import uuid

import pytest
from django.db import connection
from django.test import Client
from django.test.utils import CaptureQueriesContext

from apps.accounts import coaching
from apps.api.main import api as ninja_api
from apps.signin import services as signin

from ..factories import AthleteFactory, CoachFactory, GymFactory

pytestmark = pytest.mark.django_db

# Path parameter -> (whose it is, how to get one of the world's). "athlete": an athlete's
# data (their coach may use it); "gym": shared by a gym's coaches; "user": one account's.
PARAMS = {
    "device_id": ("user", lambda w: w["device"].pk),
    "notification_id": ("user", lambda w: w["notification"].pk),
}

# Endpoints whose path parameter is itself the credential, so anyone holding it may use it.
EXEMPT = {
    ("post", "/api/v1/invites/{token}/accept"): "the invite link is the credential",
}

# Writes a refused request may still make: counting it for rate limits, and noting when
# the caller's own device was last used.
ALLOWED_WRITES = ('INSERT INTO "ratelimit_counter"', 'UPDATE "signin_devicesession" SET "last_used_at"')


def operations():
    schema = ninja_api.get_openapi_schema(path_prefix="/api/v1")
    for path, methods in schema["paths"].items():
        for method, op in methods.items():
            yield path, method, op, schema


def _resolve(schema, node):
    while "$ref" in node:
        node = schema["components"]["schemas"][node["$ref"].split("/")[-1]]
    return node


def example(schema, node):
    """A value that passes the schema: the smallest of each type."""
    node = _resolve(schema, node)
    if "anyOf" in node:
        return example(schema, node["anyOf"][0])
    if "enum" in node:
        return node["enum"][0]
    kind = node.get("type")
    if kind == "object":
        return {
            k: example(schema, v)
            for k, v in node.get("properties", {}).items()
            if k in node.get("required", [])
        }
    if kind == "array":
        return []
    if kind == "integer" or kind == "number":
        return 1
    if kind == "boolean":
        return False
    if node.get("format") == "uuid":
        return str(uuid.uuid7())
    return "x"


def body_for(op, schema):
    content = op.get("requestBody", {}).get("content", {}).get("application/json")
    return example(schema, content["schema"]) if content else None


def swept():
    """(method, path, params, body, scope) for each endpoint with an id in its path."""
    for path, method, op, schema in operations():
        names = [p["name"] for p in op.get("parameters", []) if p["in"] == "path"]
        if not names or (method, path) in EXEMPT or "security" not in op:
            continue
        scopes = {PARAMS[n][0] for n in names if n in PARAMS}
        scope = "athlete" if "athlete" in scopes else "gym" if "gym" in scopes else "user"
        yield method, path, names, body_for(op, schema), scope


def test_every_path_parameter_is_known():
    unknown = {
        p["name"]
        for path, method, op, _ in operations()
        if (method, path) not in EXEMPT and "security" in op
        for p in op.get("parameters", [])
        if p["in"] == "path" and p["name"] not in PARAMS
    }
    assert not unknown, f"add these to PARAMS in {__name__}: {sorted(unknown)}"


@pytest.fixture
def world(gym):
    """The owner's side: a coach and athlete in `gym`, with their data and a signed-in device."""
    owner = CoachFactory(gym=gym)
    athlete = AthleteFactory(coach=owner)
    from apps.dashboard import alerts
    from apps.dashboard.models import NotificationKind

    return {
        "gym": gym,
        "coach": owner,
        "athlete": athlete,
        "device": signin.open_session(athlete.user).session,
        "notification": alerts.notify(athlete, NotificationKind.ISSUE, "issue:x", "Sore wrist", ""),
    }


def outsiders(world):
    """(label, access token or None, scopes they must be refused)."""
    other_gym = CoachFactory(gym=GymFactory())
    same_gym = CoachFactory(gym=world["gym"])
    ended = CoachFactory(gym=world["gym"])
    moved = AthleteFactory(coach=ended)
    coaching.end(moved)
    other_athlete = AthleteFactory(coach=other_gym)

    def token(user):
        return signin.open_session(user).access

    return [
        ("signed out", None, {"athlete", "gym", "user"}),
        ("another gym's coach", token(other_gym.user), {"athlete", "gym", "user"}),
        ("a coach in the same gym", token(same_gym.user), {"athlete", "user"}),
        ("a coach whose link has ended", token(ended.user), {"athlete", "user"}),
        ("another athlete", token(other_athlete.user), {"athlete", "gym", "user"}),
    ]


def test_outsiders_get_not_found_and_change_nothing(world):
    client = Client()
    failures = []
    routes = list(swept())
    assert routes, "nothing swept: has the schema moved?"
    for label, access, refused in outsiders(world):
        for method, path, names, body, scope in routes:
            if scope not in refused:
                continue
            url = path
            for name in names:
                url = url.replace("{" + name + "}", str(PARAMS[name][1](world)))
            extra = {"HTTP_AUTHORIZATION": f"Bearer {access}"} if access else {}
            with CaptureQueriesContext(connection) as ctx:
                if method == "get":
                    response = client.get(url, **extra)
                else:
                    response = getattr(client, method)(
                        url, body or {}, content_type="application/json", **extra
                    )
            expected = 401 if access is None else 404
            writes = [
                q["sql"][:80]
                for q in ctx.captured_queries
                if q["sql"].split()[0].upper() in ("INSERT", "UPDATE", "DELETE")
                and not q["sql"].startswith(ALLOWED_WRITES)
            ]
            if response.status_code != expected or writes:
                failures.append(f"{label}: {method.upper()} {path} -> {response.status_code} {writes}")
    assert not failures, "\n".join(failures)
