"""Shared fixtures: a gym with the starter library, a coach, and an athlete of that coach,
built with the factories in tests/factories.py."""

import pytest

from .factories import PASSWORD, AthleteFactory, CoachFactory, GymFactory, UserFactory

__all__ = ["PASSWORD"]


@pytest.fixture
def gym(db):
    # The mockup's library; tracks snatch, C&J, back squat.
    return GymFactory(name="Iron Ridge Weightlifting", pack="weightlifting")


@pytest.fixture
def make_user(db):
    def make(email, name="", **extra):
        return UserFactory(email=email, name=name, **extra)

    return make


@pytest.fixture
def coach(gym):
    return CoachFactory(user=UserFactory(email="dana@example.com", name="Dana Whitfield"), gym=gym)


@pytest.fixture
def athlete(coach):
    return AthleteFactory(user=UserFactory(email="maya@example.com", name="Maya Torres"), coach=coach)


@pytest.fixture
def coach_client(client, coach):
    client.force_login(coach.user)
    return client


@pytest.fixture
def athlete_client(client, athlete):
    client.force_login(athlete.user)
    return client


def lift_field(gym, key):
    """The form/URL key for a starter lift in this gym, e.g. lift_field(gym, "sn") -> "lift_12"."""
    from apps.exercises.models import Exercise

    return f"lift_{Exercise.objects.get(gym=gym, key=key).pk}"


def cat(gym, name):
    """A gym's category by name (case-insensitive)."""
    from apps.exercises.models import Category

    return Category.objects.get(gym=gym, name__iexact=name)


def tag_ids(gym, *names):
    """Primary keys of a gym's tags by name, in the order given."""
    from apps.exercises.models import Tag

    by_name = {t.name.lower(): t.pk for t in Tag.objects.filter(gym=gym)}
    return [by_name[n.lower()] for n in names]


def ex(gym, key):
    """A starter exercise by its key. Tests only: features never look exercises up by key."""
    from apps.exercises.models import Exercise

    return Exercise.objects.get(gym=gym, key=key)
