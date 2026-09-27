"""Fixes from the security audit (24 September): sign-in limits (also on the admin's
sign-in), ended programs, archived athletes joining, malformed modal posts, and message
threads fetched by another site."""

import pytest
from django.conf import settings

pytestmark = pytest.mark.django_db


def sign_in(client, email, ip):
    return client.post("/accounts/login/", {"username": email, "password": "wrong"}, HTTP_X_FORWARDED_FOR=ip)


def test_admin_sign_in_is_limited_too(client, athlete):
    url = f"/{settings.ADMIN_PATH}login/"
    assert client.get(url).status_code == 200
    for _ in range(10):
        client.post(
            url, {"username": "maya@example.com", "password": "wrong"}, HTTP_X_FORWARDED_FOR="192.0.2.9"
        )
    response = client.post(
        url, {"username": "maya@example.com", "password": "wrong"}, HTTP_X_FORWARDED_FOR="192.0.2.9"
    )
    assert response.status_code == 429
