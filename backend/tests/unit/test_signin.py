"""Passwordless sign-in (apps/signin/services.py): codes, sign-up tickets, device sessions."""

import datetime
import re

import pytest

from apps.core import errors
from apps.signin import services
from apps.signin.models import EmailCode
from config.settings import checks

pytestmark = pytest.mark.django_db
IP = "203.0.113.5"


def sent_code(mailoutbox):
    return re.search(r"\b(\d{6})\b", mailoutbox[-1].body).group(1)


# ---------------------------------------------------------------- codes


def test_a_code_is_emailed_and_stored_only_as_a_hash(mailoutbox):
    services.start(" Maya@Example.com ", IP)
    code = sent_code(mailoutbox)
    assert mailoutbox[-1].to == ["maya@example.com"]
    row = EmailCode.objects.get()
    assert row.email == "maya@example.com" and code not in row.code_hash
    assert services.verify("maya@example.com", code) == "maya@example.com"


def test_a_code_works_once(mailoutbox):
    services.start("maya@example.com", IP)
    code = sent_code(mailoutbox)
    services.verify("maya@example.com", code)
    with pytest.raises(services.CodeRefused):
        services.verify("maya@example.com", code)


def test_five_wrong_guesses_kill_the_code(mailoutbox):
    services.start("maya@example.com", IP)
    code = sent_code(mailoutbox)
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(services.MAX_GUESSES):
        with pytest.raises(services.CodeRefused):
            services.verify("maya@example.com", wrong)
    with pytest.raises(services.CodeRefused):
        services.verify("maya@example.com", code)


def test_a_code_expires_after_ten_minutes(mailoutbox, frozen_clock):
    services.start("maya@example.com", IP)
    frozen_clock.shift(datetime.timedelta(minutes=11))
    with pytest.raises(services.CodeRefused):
        services.verify("maya@example.com", sent_code(mailoutbox))


def test_a_new_code_replaces_the_old_one(mailoutbox):
    services.start("maya@example.com", IP)
    first = sent_code(mailoutbox)
    services.start("maya@example.com", IP)
    second = sent_code(mailoutbox)
    if first != second:
        with pytest.raises(services.CodeRefused):
            services.verify("maya@example.com", first)
    assert services.verify("maya@example.com", second)


def test_code_requests_are_limited_per_email_and_per_address(mailoutbox):
    for _ in range(5):
        services.start("maya@example.com", IP)
    with pytest.raises(errors.TooMany):
        services.start("maya@example.com", "198.51.100.1")
    for i in range(25):  # 5 of the 30 already came from IP
        services.start(f"person{i}@example.com", IP)
    with pytest.raises(errors.TooMany):
        services.start("someone@example.com", IP)


def test_an_invalid_email_is_refused():
    with pytest.raises(errors.Invalid):
        services.start("not an email", IP)


def test_fixed_codes_for_the_review_account_and_demo_users_only(settings, mailoutbox):
    settings.REVIEW_ACCOUNT_EMAIL, settings.REVIEW_ACCOUNT_CODE = "review@example.com", "424242"
    settings.DEMO_SIGNIN_CODE = "123456"
    assert services.fixed_code("review@example.com") == "424242"
    assert services.fixed_code("dana@ironridge.example") == "123456"
    assert services.fixed_code("maya@example.com") is None
    services.start("review@example.com", IP)
    assert services.verify("review@example.com", "424242")


def test_production_refuses_fixed_codes_for_anyone_else():
    good = {"email_provider": "resend", "from_email": "hi@gym.example", "site_url": "https://gym.example"}
    assert checks.production_problems(**good, review_email="review@gym.example", review_code="424242") == []
    assert checks.production_problems(**good, demo_code="123456")
    assert checks.production_problems(**good, review_code="424242")  # no review account named
    assert checks.production_problems(**good, review_email="r@gym.example", review_code="42")



def test_the_test_run_code_works_for_every_email(settings, mailoutbox):
    # The free test run (docs/plans/S8B_TEST_RUN.md): no sending domain yet, so everyone
    # signs in with one shared code instead of an emailed one.
    settings.TEST_SIGNIN_CODE = "739215"
    settings.REVIEW_ACCOUNT_EMAIL, settings.REVIEW_ACCOUNT_CODE = "review@example.com", "424242"
    assert services.fixed_code("anyone@example.com") == "739215"
    assert services.fixed_code("review@example.com") == "424242"
    services.start("anyone@example.com", IP)
    assert services.verify("anyone@example.com", "739215") == "anyone@example.com"
    settings.TEST_SIGNIN_CODE = ""
    assert services.fixed_code("anyone@example.com") is None


def test_production_refuses_a_weak_test_run_code():
    good = {"email_provider": "console", "from_email": "x@localhost", "site_url": "https://gym.example"}
    assert checks.production_problems(**good, test_code="739215") == []
    assert checks.production_problems(**good, test_code="12")
    assert checks.production_problems(**good, test_code="123456")  # the published demo code


# ---------------------------------------------------------------- sign-up tickets


def test_a_ticket_carries_the_verified_email_for_half_an_hour(frozen_clock):
    ticket = services.ticket("new@example.com")
    assert services.ticket_email(ticket) == "new@example.com"
    with pytest.raises(services.TicketRefused):
        services.ticket_email(ticket[:-2] + "xx")
    frozen_clock.shift(datetime.timedelta(minutes=31))
    with pytest.raises(services.TicketRefused):
        services.ticket_email(ticket)


# ---------------------------------------------------------------- sessions


def test_an_access_token_works_for_fifteen_minutes(athlete, frozen_clock):
    tokens = services.open_session(athlete.user, "Maya's phone")
    assert services.authenticate(tokens.access).user == athlete.user
    frozen_clock.shift(datetime.timedelta(minutes=16))
    assert services.authenticate(tokens.access) is None
    assert services.authenticate("made-up") is None


def test_the_access_token_lifetime_follows_the_setting(athlete, frozen_clock, settings):
    # The free test run keeps web sign-ins for a week: the web app can't refresh through its
    # cookie while the app and the API are on different sites (docs/plans/S8B_TEST_RUN.md).
    settings.ACCESS_TOKEN_TTL_MINUTES = 7 * 24 * 60
    tokens = services.open_session(athlete.user, "Maya's laptop")
    frozen_clock.shift(datetime.timedelta(days=6))
    assert services.authenticate(tokens.access).user == athlete.user
    frozen_clock.shift(datetime.timedelta(days=2))
    assert services.authenticate(tokens.access) is None


def test_refreshing_rotates_both_tokens(athlete):
    first = services.open_session(athlete.user)
    second = services.refresh(first.refresh)
    assert second.access != first.access and second.refresh != first.refresh
    assert services.authenticate(first.access) is None and services.authenticate(second.access)


def test_an_old_refresh_token_revokes_the_device(athlete, frozen_clock):
    first = services.open_session(athlete.user)
    second = services.refresh(first.refresh)
    with pytest.raises(errors.NotSignedIn):  # a retry within the grace: refused, not revoked
        services.refresh(first.refresh)
    assert services.authenticate(second.access)
    frozen_clock.shift(datetime.timedelta(minutes=1))
    with pytest.raises(errors.NotSignedIn):  # later: someone copied it
        services.refresh(first.refresh)
    with pytest.raises(errors.NotSignedIn):
        services.refresh(second.refresh)


def test_refresh_tokens_last_ninety_days_from_last_use(athlete, frozen_clock):
    tokens = services.open_session(athlete.user)
    frozen_clock.shift(datetime.timedelta(days=80))
    tokens = services.refresh(tokens.refresh)
    frozen_clock.shift(datetime.timedelta(days=80))
    tokens = services.refresh(tokens.refresh)  # still fine: extended on use
    frozen_clock.shift(datetime.timedelta(days=91))
    with pytest.raises(errors.NotSignedIn):
        services.refresh(tokens.refresh)


def test_signing_out_this_device_or_another(athlete, coach):
    phone = services.open_session(athlete.user, "phone")
    laptop = services.open_session(athlete.user, "laptop")
    assert {d.label for d in services.devices(athlete.user)} == {"phone", "laptop"}
    services.sign_out_device(athlete.user, laptop.session.pk)
    assert services.authenticate(laptop.access) is None and services.authenticate(phone.access)
    with pytest.raises(errors.NotFound):
        services.sign_out_device(coach.user, phone.session.pk)  # someone else's
    services.sign_out(phone.session)
    assert services.authenticate(phone.access) is None
    with pytest.raises(errors.NotSignedIn):
        services.refresh(phone.refresh)


def test_email_sign_in_finds_the_account(athlete):
    assert services.user_for_email("maya@example.com") == athlete.user
    assert services.user_for_email("nobody@example.com") is None
