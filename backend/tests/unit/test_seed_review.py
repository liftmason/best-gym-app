"""The app-review gym (manage.py seed_review; S8 decision F)."""

import pytest
from django.core.management import CommandError, call_command

from apps.accounts.models import Gym, User

pytestmark = pytest.mark.django_db


@pytest.fixture
def review(settings):
    settings.REVIEW_ACCOUNT_EMAIL = "review@liftmason.test"
    settings.REVIEW_ACCOUNT_CODE = "246810"


def test_the_review_account_coaches_and_trains_in_its_own_gym(review, gym):
    call_command("seed_review")
    user = User.objects.get(email="review@liftmason.test")
    assert user.coach.gym.name == "Liftmason Review Gym" and user.athlete.coach == user.coach
    assert user.athlete.programs.exists() and user.athlete.session_logs.exists()
    others = User.objects.filter(email__endswith="@review.liftmason.invalid")
    assert others.count() == 5 and not any(u.has_usable_password() for u in others)
    assert Gym.objects.filter(pk=gym.pk).exists()  # the other gym is untouched
    with pytest.raises(CommandError, match="Pass --reset"):
        call_command("seed_review")
    call_command("seed_review", "--reset")
    assert Gym.objects.filter(name="Liftmason Review Gym").count() == 1


def test_it_needs_the_review_settings_and_an_address_of_its_own(settings, coach):
    settings.REVIEW_ACCOUNT_EMAIL, settings.REVIEW_ACCOUNT_CODE = "", ""
    with pytest.raises(CommandError, match="Set REVIEW_ACCOUNT_EMAIL"):
        call_command("seed_review")
    settings.REVIEW_ACCOUNT_EMAIL, settings.REVIEW_ACCOUNT_CODE = coach.user.email, "246810"
    with pytest.raises(CommandError, match="already coaches"):
        call_command("seed_review")
