import pytest

from apps.workouts.models import CheckinQuestion, copy_defaults_to, install_default_questions

pytestmark = pytest.mark.django_db
HX = {"HTTP_HX_REQUEST": "true"}


@pytest.fixture
def defaults(gym):
    install_default_questions(gym)
    return list(CheckinQuestion.objects.gym_defaults(gym).active())


@pytest.fixture
def maya(athlete, defaults):
    copy_defaults_to(athlete)
    return athlete


def test_a_question_needs_exactly_one_owner(gym, maya):
    from django.db import IntegrityError

    with pytest.raises(IntegrityError):
        CheckinQuestion.objects.create(gym=gym, athlete=maya, type="scale", text="x")
