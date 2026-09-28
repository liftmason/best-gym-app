"""Empty answers stay empty on the way out (apps/api/middleware.py).

Render's edge (Cloudflare) compressed an empty 202 into one byte of Brotli and sent
`Content-Length: 1`; the web app's API client trusted the length, failed to parse nothing as
JSON, and every empty answer (sign-in's "code sent" among them) showed "Can't reach".
"""

import pytest
from django.test import Client

pytestmark = pytest.mark.django_db


def test_an_empty_answer_asks_proxies_not_to_compress_it():
    answer = Client().post(
        "/api/v1/auth/email/start", {"email": "new@example.com"}, content_type="application/json"
    )
    assert answer.status_code == 202 and answer.content == b""
    assert "no-transform" in answer.headers["Cache-Control"]


def test_answers_with_a_body_are_left_to_compress(athlete):
    from apps.signin import services

    token = services.open_session(athlete.user).access
    answer = Client().get("/api/v1/me", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert answer.status_code == 200 and answer.content
    assert "no-transform" not in answer.headers.get("Cache-Control", "")
