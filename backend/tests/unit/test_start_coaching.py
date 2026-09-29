"""Starting to coach from an account that already exists (POST /api/v1/me/coach): an athlete
who begins coaching, or the site admin's own account. Coach sign-up only takes new emails."""

import pytest
from django.test import Client

from apps.accounts import services
from apps.accounts.models import GymRole, User
from apps.signin import services as signin

pytestmark = pytest.mark.django_db

GYM = {
    "name": "Will Spear",
    "gym_name": "Spear Barbell",
    "units": "kg",
    "starter": "weightlifting",
    "timezone": "America/New_York",
}


def test_an_existing_account_starts_coaching_its_own_new_gym():
    user = User.objects.create_user("admin@example.com", "a-long-password", name="Admin")
    coach = services.start_coaching(user, **GYM)
    user.refresh_from_db()
    assert user.coach_profile == coach and user.name == "Will Spear"
    assert coach.gym.name == "Spear Barbell" and coach.membership.role == GymRole.OWNER
    assert coach.gym.exercises.exists()  # the starter pack, as at sign-up


def test_an_athlete_keeps_training_with_their_coach_after_starting_to_coach(athlete):
    coach = services.start_coaching(athlete.user, **GYM)
    athlete.refresh_from_db()
    assert athlete.coach is not None and athlete.coach != coach
    assert athlete.user.coach_profile == coach


def test_a_coach_cannot_start_a_second_gym_this_way(coach):
    with pytest.raises(services.AlreadyCoaching):
        services.start_coaching(coach.user, **GYM)


def test_the_endpoint_starts_coaching_and_me_shows_it():
    user = User.objects.create_user("admin@example.com", "a-long-password", name="Admin")
    api = Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(user).access}")
    started = api.post("/api/v1/me/coach", GYM, content_type="application/json")
    assert started.status_code == 201, started.content
    assert api.get("/api/v1/me").json()["coach"]
    again = api.post("/api/v1/me/coach", GYM, content_type="application/json")
    assert again.status_code == 409 and again.json()["error"]["code"] == "already_coaching"
    blank = api.post("/api/v1/me/coach", {**GYM, "gym_name": " "}, content_type="application/json")
    assert blank.status_code == 409  # checked after "already coaching"


def test_a_blank_gym_name_is_refused():
    user = User.objects.create_user("new@example.com", "a-long-password", name="New")
    api = Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(user).access}")
    blank = api.post("/api/v1/me/coach", {**GYM, "gym_name": " "}, content_type="application/json")
    assert blank.status_code == 400 and "gym name" in blank.json()["error"]["message"]
    assert User.objects.get(pk=user.pk).coach_profile is None
