"""Sign in with Apple and Google (apps/signin/social.py). Tokens are signed here with a test
key standing in for the provider's (docs/plans/S2_API.md, decision B)."""

import datetime

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from django.test import Client
from django.utils import timezone

from apps.signin import social
from apps.signin.models import IdentityKind, LinkedIdentity

pytestmark = pytest.mark.django_db
APP = "com.example.gymtrainer"
PROVIDER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
IMPOSTOR_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def providers(settings, monkeypatch):
    settings.APPLE_CLIENT_IDS = [APP]
    settings.GOOGLE_CLIENT_IDS = [APP]
    monkeypatch.setattr(social, "signing_key", lambda provider, token: PROVIDER_KEY.public_key())


@pytest.fixture
def api():
    return Client()


def token(nonce, provider="apple", key=PROVIDER_KEY, **claims):
    now = timezone.now()
    body = {
        "iss": social.PROVIDERS[provider]["issuers"][0],
        "aud": APP,
        "sub": "apple-user-1",
        "iat": now,
        "exp": now + datetime.timedelta(minutes=10),
        "nonce": social.nonce_hash(nonce),
        "email": "maya@example.com",
        "email_verified": "true",  # Apple sends a string, Google a boolean
    } | claims
    if body["exp"] == "a minute ago":
        body["exp"] = now - datetime.timedelta(minutes=1)
    return jwt.encode(body, key, algorithm="RS256")


def sign_in(api, provider="apple", nonce=None, **claims):
    nonce = nonce or api.get("/api/v1/auth/nonce").json()["nonce"]
    body = {"id_token": token(nonce, provider, **claims), "nonce": nonce, "device": "phone"}
    return api.post(f"/api/v1/auth/social/{provider}", body, content_type="application/json")


def test_a_verified_email_signs_in_to_its_account_and_links_it(api, athlete):
    response = sign_in(api)
    assert response.status_code == 200 and response.json()["signed_in"]
    assert LinkedIdentity.objects.get(kind=IdentityKind.APPLE).user == athlete.user
    again = sign_in(api, email="relay@privaterelay.appleid.com")  # found by the identity now
    assert again.json()["signed_in"]


def test_google_signs_in_too(api, athlete):
    assert sign_in(api, "google", email_verified=True).json()["signed_in"]


def test_a_new_person_gets_a_ticket_that_links_the_identity(api):
    body = sign_in(api, email="sam@example.com", sub="apple-sam").json()
    assert not body["signed_in"] and body["ticket"]
    created = api.post(
        "/api/v1/auth/signup/coach",
        {"ticket": body["ticket"], "name": "Sam Lee", "gym_name": "Barbell Club"},
        content_type="application/json",
    )
    assert created.status_code == 201
    assert (
        LinkedIdentity.objects.get(kind=IdentityKind.APPLE, subject="apple-sam").user.email
        == "sam@example.com"
    )


@pytest.mark.parametrize(
    "claims",
    [
        {"aud": "com.someone.else"},
        {"iss": "https://evil.example"},
        {"exp": "a minute ago"},  # worked out in token(), on the test's clock
        {"nonce": "not-the-hash"},
    ],
)
def test_tokens_that_do_not_check_out_are_refused(api, athlete, claims):
    response = sign_in(api, **claims)
    assert response.status_code == 401 and response.json()["error"]["code"] == "token_refused"


def test_a_token_signed_by_someone_else_is_refused(api, athlete):
    nonce = api.get("/api/v1/auth/nonce").json()["nonce"]
    forged = token(nonce, key=IMPOSTOR_KEY)
    response = api.post(
        "/api/v1/auth/social/apple", {"id_token": forged, "nonce": nonce}, content_type="application/json"
    )
    assert response.status_code == 401


def test_a_nonce_works_once(api, athlete):
    nonce = api.get("/api/v1/auth/nonce").json()["nonce"]
    assert sign_in(api, nonce=nonce).status_code == 200
    assert sign_in(api, nonce=nonce).status_code == 401  # a replayed token


def test_an_unverified_email_needs_a_code_instead(api):
    assert sign_in(api, email_verified="false", email="new@example.com").status_code == 401


def test_providers_that_are_not_set_up_do_not_exist(api, settings):
    settings.GOOGLE_CLIENT_IDS = []
    assert sign_in(api, "google").status_code == 404
    nonce = api.get("/api/v1/auth/nonce").json()["nonce"]
    response = api.post(
        "/api/v1/auth/social/myspace", {"id_token": "x", "nonce": nonce}, content_type="application/json"
    )
    assert response.status_code == 404


def test_linking_to_the_signed_in_account(api, athlete, coach):
    from apps.signin import services

    access = services.open_session(athlete.user).access
    nonce = api.get("/api/v1/auth/nonce").json()["nonce"]
    body = {"id_token": token(nonce, sub="apple-relay", email="x@privaterelay.appleid.com"), "nonce": nonce}
    linked = api.post(
        "/api/v1/auth/social/apple/link",
        body,
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {access}",
    )
    assert linked.status_code == 204
    other = services.open_session(coach.user).access
    nonce = api.get("/api/v1/auth/nonce").json()["nonce"]
    body = {"id_token": token(nonce, sub="apple-relay"), "nonce": nonce}
    taken = api.post(
        "/api/v1/auth/social/apple/link",
        body,
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {other}",
    )
    assert taken.status_code == 409
