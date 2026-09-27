"""/healthz, which Render's probe calls before host checks and the HTTPS redirect."""

import pytest
from django.test import override_settings

pytestmark = pytest.mark.django_db


def test_healthz_touches_database(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@override_settings(ALLOWED_HOSTS=["gymtrainer.onrender.com"], SECURE_SSL_REDIRECT=True)
def test_healthz_skips_host_check_and_https_redirect(client):
    # Render's internal probe: plain HTTP, unknown Host header.
    response = client.get("/healthz", HTTP_HOST="10.0.0.12:10000")
    assert response.status_code == 200
