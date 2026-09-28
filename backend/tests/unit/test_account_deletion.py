"""Deleting one's own account (POST /api/v1/me/delete; accounts/erase.py; S8 decisions A, B)."""

import datetime
from types import SimpleNamespace

import pytest
from django.core import mail
from django.test import Client
from django.utils import timezone

from apps.accounts import invites
from apps.accounts.models import Athlete, Coaching, CoachingStatus, GymRole, User
from apps.exercises.models import Exercise
from apps.library.models import Template
from apps.signin import services as signin
from apps.workouts import questions
from apps.workouts.models import CheckinQuestion, SessionExercise, SessionLog, SetLog

from ..conftest import ex
from ..factories import CoachFactory

pytestmark = pytest.mark.django_db


def client_for(user):
    return Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(user).access}")


def delete(api, confirm="DELETE"):
    return api.post("/api/v1/me/delete", {"confirm": confirm}, content_type="application/json")


def _log(athlete, gym):
    now = timezone.now() - datetime.timedelta(days=2)
    log = SessionLog.objects.create(
        athlete=athlete, date=athlete.today(), started_at=now, finished_at=now, name="Snatch day"
    )
    se = SessionExercise.objects.create(session_log=log, exercise=ex(gym, "sn"), exercise_name="Snatch")
    SetLog.objects.create(session_exercise=se, set_number=1, load_kg=80, reps=1, done=True)
    return log


def test_an_athlete_deleting_erases_everything_and_tells_their_coach(
    athlete, coach, gym, django_capture_on_commit_callbacks
):
    _log(athlete, gym)
    api = client_for(athlete.user)
    user_id, name = athlete.user.pk, athlete.user.name
    with django_capture_on_commit_callbacks(execute=True):  # the email goes once it's done
        assert delete(api, "delete ").status_code == 204  # any case, spacing tidied
    assert not User.objects.filter(pk=user_id).exists() and not SessionLog.objects.exists()
    assert api.get("/api/v1/me").status_code == 401  # every session ends with it
    (email,) = mail.outbox
    assert email.to == [coach.user.email] and email.subject == f"{name} deleted their account"


def test_nothing_changes_without_the_word(athlete):
    refused = delete(client_for(athlete.user), "yes")
    assert refused.status_code == 400
    assert refused.json()["error"]["fields"] == {"confirm": "Type DELETE to confirm."}
    assert Athlete.objects.filter(pk=athlete.pk).exists()


def test_a_coach_deleting_is_scrubbed_and_their_athletes_keep_their_history(athlete, coach, gym):
    coach.memberships.update(role=GymRole.OWNER)
    log = _log(athlete, gym)
    Template.objects.create(gym=gym, kind="program", name="Block")
    invites.create(coach, email="new@example.com")
    questions.add(athlete, "text")  # the athlete's own copy stays
    api = client_for(coach.user)
    assert delete(api).status_code == 204

    user = User.objects.get(pk=coach.user.pk)
    assert user.name == "Former coach" and user.email.endswith("@deleted.invalid") and not user.is_active
    assert not user.has_usable_password() and api.get("/api/v1/me").status_code == 401
    link = Coaching.objects.get(athlete=athlete)
    assert link.status == CoachingStatus.ENDED
    assert SessionLog.objects.filter(pk=log.pk).exists() and Exercise.objects.filter(gym=gym).exists()
    assert not Template.objects.filter(gym=gym).exists() and not gym.invites.exists()
    assert not CheckinQuestion.objects.filter(gym=gym, athlete__isnull=True).exists()
    assert CheckinQuestion.objects.filter(athlete=athlete).exists()


def test_an_owner_with_other_coaches_hands_the_gym_over_first(coach, gym):
    coach.memberships.update(role=GymRole.OWNER)
    CoachFactory(gym=gym)
    refused = delete(client_for(coach.user))
    assert refused.status_code == 409 and "Make one of them its owner" in refused.json()["error"]["message"]
    assert User.objects.get(pk=coach.user.pk).is_active


def test_the_last_coach_leaving_cancels_the_subscription(
    coach, gym, settings, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.billing import stripe_billing
    from apps.billing.models import Plan, Subscription, SubscriptionStatus

    settings.BILLING_ENABLED = True
    plan = Plan.objects.create(code="pro", name="Pro")
    sub = Subscription.objects.create(gym=gym, plan=plan, stripe_subscription_id="sub_123")
    cancelled = []
    fake = SimpleNamespace(v1=SimpleNamespace(subscriptions=SimpleNamespace(cancel=cancelled.append)))
    monkeypatch.setattr(stripe_billing, "client", lambda: fake)
    with django_capture_on_commit_callbacks(execute=True):
        assert delete(client_for(coach.user)).status_code == 204
    sub.refresh_from_db()
    assert cancelled == ["sub_123"] and sub.status == SubscriptionStatus.CANCELED
