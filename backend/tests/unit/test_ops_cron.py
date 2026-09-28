"""POST /api/v1/ops/cron: the hourly jobs for hosts without a cron service (the free test
run, docs/plans/S8B_TEST_RUN.md). It hides behind 404 unless CRON_TOKEN matches."""

import pytest
from django.test import Client

from apps.dashboard import digest

pytestmark = pytest.mark.django_db

URL = "/api/v1/ops/cron"
TOKEN = "a-long-random-cron-token-for-tests"


def call(header=None):
    extra = {"HTTP_AUTHORIZATION": header} if header is not None else {}
    return Client().post(URL, **extra)


@pytest.fixture
def cron_on(settings):
    settings.CRON_TOKEN = TOKEN


def test_off_without_a_token_configured(settings):
    settings.CRON_TOKEN = ""
    assert call(f"Bearer {TOKEN}").status_code == 404
    assert call("Bearer ").status_code == 404  # an empty token never matches an empty setting
    assert call().status_code == 404


def test_a_missing_or_wrong_token_is_not_found(cron_on):
    assert call().status_code == 404
    assert call("Bearer wrong").status_code == 404
    assert call(TOKEN).status_code == 404  # no scheme
    assert call("Bearer é-not-ascii").status_code == 404  # compare_digest refuses non-ASCII str


def test_a_sign_in_token_is_not_a_cron_token(cron_on, coach):
    from apps.signin import services

    access = services.open_session(coach.user).access
    assert call(f"Bearer {access}").status_code == 404


def test_the_right_token_runs_the_jobs(cron_on, coach, athlete):
    answer = call(f"Bearer {TOKEN}")
    assert answer.status_code == 200
    body = answer.json()
    assert body["failed"] == [] and {"expired", "abandoned", "digests"} <= body.keys()


def test_a_failed_step_is_a_500_after_the_rest_ran(cron_on, coach, athlete, monkeypatch):
    def broken(coach):
        raise ConnectionError("email provider down")

    monkeypatch.setattr(digest, "send", broken)
    answer = call(f"Bearer {TOKEN}")
    assert answer.status_code == 500
    assert answer.json()["failed"] == [f"digest for coach {coach.pk}"]


def test_the_setting_ignores_spaces_pasted_around_the_token(monkeypatch):
    import importlib

    from config.settings import base

    monkeypatch.setenv("CRON_TOKEN", f"  {TOKEN}\n")
    assert importlib.reload(base).CRON_TOKEN == TOKEN
    monkeypatch.delenv("CRON_TOKEN")
    importlib.reload(base)
