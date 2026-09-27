"""What a gym's plan allows (apps/billing/entitlements.py), and the places that ask."""

import datetime

import pytest
from django.test import Client
from django.utils import timezone

from apps.accounts import invites
from apps.billing import entitlements
from apps.billing.models import Plan, Subscription, SubscriptionStatus
from apps.signin import services as signin

from ..factories import AthleteFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def billing(settings):
    settings.BILLING_ENABLED = True


def on_plan(gym, **limits):
    plan = Plan.objects.create(code="small", name="Small", **limits)
    return Subscription.objects.create(gym=gym, plan=plan)


def api_for(user):
    return Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(user).access}")


def test_everything_is_allowed_while_billing_is_off(coach, athlete, gym):
    on_plan(gym, max_athletes=0, form_videos=False)
    for action in (entitlements.ADD_ATHLETE, entitlements.FORM_VIDEOS, entitlements.PROGRAM):
        assert entitlements.check(gym, action).allowed
    assert invites.create(coach).pk


def test_a_gym_without_a_subscription_is_on_the_default_plan(gym, settings):
    assert entitlements.plan_for(gym).code == settings.DEFAULT_PLAN == "unlimited"


def test_the_athlete_limit(billing, coach, athlete, gym):
    on_plan(gym, max_athletes=1)
    with pytest.raises(entitlements.NotEntitled):
        invites.create(coach)
    response = api_for(coach.user).post("/api/v1/invites", {}, content_type="application/json")
    assert response.status_code == 402 and response.json()["error"]["code"] == "not_entitled"


def test_an_invite_made_before_the_limit_can_not_join_past_it(billing, coach, gym, settings):
    settings.BILLING_ENABLED = False
    invite = invites.create(coach)
    AthleteFactory(coach=coach)
    settings.BILLING_ENABLED = True
    on_plan(gym, max_athletes=1)
    with pytest.raises(entitlements.NotEntitled):
        invites.accept(invite.pk, name="Pat", email="pat@example.com")


def test_form_videos_are_a_plan_feature(billing, athlete, gym):
    from apps.workouts.models import SessionExercise, SessionLog

    on_plan(gym, form_videos=False)
    log = SessionLog.objects.create(athlete=athlete, date=athlete.today())
    se = SessionExercise.objects.create(session_log=log, exercise_name="Snatch")
    body = {"session_exercise_id": str(se.pk), "size": 1000, "content_type": "video/mp4"}
    response = api_for(athlete.user).post(
        f"/api/v1/me/sessions/{log.pk}/videos", body, content_type="application/json"
    )
    assert response.status_code == 402


def test_programming_goes_read_only_a_week_after_a_failed_payment(billing, coach, athlete, gym):
    sub = on_plan(gym)
    api = api_for(coach.user)
    add = {"name": "Tall Snatch", "category_id": str(gym.categories.first().pk)}
    sub.payment_failed_at = timezone.now() - datetime.timedelta(days=6)
    sub.save()
    assert api.post("/api/v1/exercises", add, content_type="application/json").status_code == 201  # grace
    sub.payment_failed_at = timezone.now() - datetime.timedelta(days=8)
    sub.save()
    assert (
        api.post(
            "/api/v1/exercises", add | {"name": "Hang Snatch 2"}, content_type="application/json"
        ).status_code
        == 402
    )
    assert api.get("/api/v1/exercises").status_code == 200  # reading still works
    assert api.get(f"/api/v1/athletes/{athlete.pk}/program").status_code == 200
    me = api.get("/api/v1/me").json()["coach"]["entitlements"]
    assert me["billing_enabled"] and not me["programming"] and me["plan"]["name"] == "Small"


def test_athletes_keep_logging_whatever_the_gym_owes(billing, athlete, gym):
    sub = on_plan(gym)
    sub.payment_failed_at = timezone.now() - datetime.timedelta(days=30)
    sub.save()
    response = api_for(athlete.user).post(
        "/api/v1/me/metrics", {"values": {"bodyweight": "70"}}, content_type="application/json"
    )
    assert response.status_code == 200 and response.json()["filled"] == ["bodyweight"]


def test_a_cancelled_subscription_falls_back_to_the_default_plan(billing, gym):
    sub = on_plan(gym, form_videos=False)
    sub.status = SubscriptionStatus.CANCELED
    sub.save()
    assert (
        entitlements.plan_for(gym).code == "unlimited"
        and entitlements.check(gym, entitlements.FORM_VIDEOS).allowed
    )
