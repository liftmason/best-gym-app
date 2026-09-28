"""Empty JSON answers carry `null` (apps/api/middleware.py).

Render's edge (Cloudflare) compressed an empty 202 into one byte of Brotli and sent
`Content-Length: 1`; the web app's API client trusted the length, failed to parse nothing as
JSON, and every empty answer (sign-in's "code sent" among them) showed "Can't reach". A body
of `null` is valid JSON however the edge encodes it. (Cache-Control: no-transform was tried
first; Render's edge ignores it.)
"""

import json

import pytest
from django.test import Client

pytestmark = pytest.mark.django_db


def test_an_empty_json_answer_carries_null():
    answer = Client().post(
        "/api/v1/auth/email/start", {"email": "new@example.com"}, content_type="application/json"
    )
    assert answer.status_code == 202
    assert json.loads(answer.content) is None
    assert answer.headers["Content-Length"] == str(len(answer.content))


def test_answers_with_a_body_are_untouched(athlete):
    from apps.signin import services

    token = services.open_session(athlete.user).access
    answer = Client().get("/api/v1/me", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert answer.status_code == 200 and json.loads(answer.content)["name"]


def test_a_no_content_answer_stays_empty():
    from django.http import HttpResponse
    from django.test import RequestFactory

    from apps.api.middleware import EmptyJsonIsNullMiddleware

    empty = HttpResponse(status=204, content_type="application/json")
    answer = EmptyJsonIsNullMiddleware(lambda request: empty)(RequestFactory().get("/api/v1/x"))
    assert answer.status_code == 204 and answer.content == b""
