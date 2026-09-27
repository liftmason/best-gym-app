"""Test data factories (factory_boy). Prefer these over hand-built objects in new tests; the
shared fixtures in tests/conftest.py (gym, coach, athlete) are built from them.

`GymFactory` makes a bare gym; use `GymFactory(pack="weightlifting")` (or the `gym` fixture)
when a test needs the starter library, since installing a pack is the slow part."""

import factory
from factory.django import DjangoModelFactory

from apps.accounts import coaching
from apps.accounts.models import Athlete, Coach, Gym, User
from apps.exercises.starter import install_pack

PASSWORD = "correct-horse-battery-9"


class UserFactory(DjangoModelFactory):
    class Meta:
        model = User

    email = factory.Sequence(lambda n: f"person{n}@example.com")
    name = factory.Faker("name")
    timezone = "America/New_York"

    @classmethod
    def _create(cls, model_class, *args, **kwargs):
        return model_class.objects.create_user(kwargs.pop("email"), PASSWORD, **kwargs)


class GymFactory(DjangoModelFactory):
    class Meta:
        model = Gym
        skip_postgeneration_save = True

    name = factory.Sequence(lambda n: f"Gym {n}")
    timezone = "America/New_York"

    @factory.post_generation
    def pack(gym, create, value, **kwargs):
        if create and value:
            install_pack(gym, value)


class CoachFactory(DjangoModelFactory):
    class Meta:
        model = Coach

    user = factory.SubFactory(UserFactory)
    gym = factory.SubFactory(GymFactory)  # joined through a GymMembership

    @classmethod
    def _create(cls, model_class, *args, **kwargs):
        gym = kwargs.pop("gym")
        coach = model_class.objects.create(**kwargs)
        coaching.join_gym(coach, gym)
        return coach


class AthleteFactory(DjangoModelFactory):
    class Meta:
        model = Athlete

    user = factory.SubFactory(UserFactory)
    coach = factory.SubFactory(CoachFactory)  # linked through a Coaching; None for no coach

    @classmethod
    def _create(cls, model_class, *args, **kwargs):
        coach = kwargs.pop("coach")
        athlete = model_class.objects.create(**kwargs)
        if coach is not None:
            coaching.start(coach, athlete)
        return athlete
