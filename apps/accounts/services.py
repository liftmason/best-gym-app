"""Creating accounts. Views and (from sub-project 2) the API call these; they hold the rules.

Passwords are optional: sign-in moves to email codes in sub-project 2, and an account made
without one simply has no usable password."""

import zoneinfo

from django.db import transaction

from apps.exercises.starter import PACKS, install_pack
from apps.workouts.models import install_default_questions

from .models import Coach, Gym, Units, User


class AccountExists(Exception):
    """Someone already has an account with this email (emails match regardless of case)."""


def valid_timezone(value, fallback):
    """A browser- or phone-reported IANA zone if it's real, else `fallback`."""
    return value if value in zoneinfo.available_timezones() else fallback


def email_taken(email):
    return User.objects.filter(email__iexact=User.objects.normalize_email(email)).exists()


@transaction.atomic
def sign_up_coach(*, name, email, gym_name, units, starter, timezone, password=None):
    """A new coach with their own gym: the chosen starter pack, the default check-in
    questions, and the gym's zone from the coach's device (UTC if it isn't a real zone)."""
    if units not in Units.values:
        raise ValueError(f"Unknown units: {units!r}")
    if starter not in PACKS:
        raise ValueError(f"Unknown starter pack: {starter!r}")
    if email_taken(email):
        raise AccountExists(email)
    tz = valid_timezone(timezone, "UTC")
    gym = Gym.objects.create(name=gym_name, units=units, timezone=tz)
    install_pack(gym, starter)
    install_default_questions(gym)
    user = User.objects.create_user(email, password, name=name, timezone=tz)
    return Coach.objects.create(user=user, gym=gym)
