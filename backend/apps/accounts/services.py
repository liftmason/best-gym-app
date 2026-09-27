"""Creating accounts. Views and (from sub-project 2) the API call these; they hold the rules.

Passwords are optional: sign-in moves to email codes in sub-project 2, and an account made
without one simply has no usable password."""

import zoneinfo

from django.db import transaction

from apps.core import errors
from apps.exercises.starter import PACKS, install_pack
from apps.workouts.models import install_default_questions

from . import coaching
from .models import Coach, Gym, GymRole, MaxUpdates, Units, User, WeekStart


class AccountExists(errors.Conflict):
    """Someone already has an account with this email (emails match regardless of case)."""


class InvalidAccount(errors.Invalid):
    """With the message to show (a weak password, a missing or overlong name)."""


MAX_NAME, MAX_GYM_NAME = 150, 120


def check_new_account(name, email, password=None):
    """A person's name (required, up to 150 characters) and, when given, a password that
    passes Django's password validators. Returns the tidied name."""
    from django.contrib.auth import password_validation
    from django.core.exceptions import ValidationError

    name = " ".join((name or "").split())
    if not name or len(name) > MAX_NAME:
        raise InvalidAccount(f"Enter a name of up to {MAX_NAME} characters.")
    if password:
        try:
            password_validation.validate_password(password, User(email=email or "", name=name))
        except ValidationError as err:
            raise InvalidAccount(" ".join(err.messages)) from None
    return name


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
        raise InvalidAccount(f"Unknown units: {units!r}")
    name = check_new_account(name, email, password)
    gym_name = " ".join((gym_name or "").split())
    if not gym_name or len(gym_name) > MAX_GYM_NAME:
        raise InvalidAccount(f"Enter a gym name of up to {MAX_GYM_NAME} characters.")
    if starter not in PACKS:
        raise InvalidAccount(f"Unknown starter pack: {starter!r}")
    if email_taken(email):
        raise AccountExists(email)
    tz = valid_timezone(timezone, "UTC")
    gym = Gym.objects.create(name=gym_name, units=units, timezone=tz)
    install_pack(gym, starter)
    install_default_questions(gym)
    user = User.objects.create_user(email, password, name=name, timezone=tz)
    coach = Coach.objects.create(user=user)
    coaching.join_gym(coach, gym, GymRole.OWNER)
    return coach


def set_units(athlete, value):
    """Kilograms or pounds in the athlete's own app (loads are stored in kg either way)."""
    if value not in Units.values:
        raise errors.Invalid(f"Unknown units: {value!r}")
    athlete.units = value
    athlete.save(update_fields=["units"])
    return athlete


class InvalidSettings(errors.Invalid):
    """With the message to show."""


@transaction.atomic
def update_gym_settings(coach, *, gym_name, coach_title, digest, timezone, units, week_start):
    """The coach's own title and digest choice, and their gym's name, zone, units and the
    day training weeks start (new programs only; existing ones keep their dates)."""
    gym_name = (gym_name or "").strip()
    if not gym_name or len(gym_name) > 120:
        raise InvalidSettings("The gym needs a name of up to 120 characters.")
    coach_title = (coach_title or "").strip()
    if len(coach_title) > 60:
        raise InvalidSettings("Keep the title to 60 characters.")
    if timezone not in zoneinfo.available_timezones():
        raise InvalidSettings("Pick a real time zone.")
    if units not in Units.values:
        raise InvalidSettings("Pick kilograms or pounds.")
    if int(week_start) not in WeekStart.values:
        raise InvalidSettings("Pick the day weeks start on.")
    gym = coach.gym
    gym.name, gym.timezone, gym.units, gym.week_start = gym_name, timezone, units, int(week_start)
    gym.full_clean()
    gym.save()
    coach.title, coach.digest = coach_title, bool(digest)
    coach.save(update_fields=["title", "digest"])
    return coach


def set_max_updates(athlete, value):
    """Whether session PRs update the athlete's maxes automatically or wait for the coach."""
    from apps.dashboard import alerts

    if value not in MaxUpdates.values:
        raise errors.Invalid(f"Unknown choice: {value!r}")
    athlete.max_updates = value
    athlete.save(update_fields=["max_updates"])
    alerts.sync_prs(athlete)
    return athlete


def coach_athletes(coach):
    """The coach's own active athletes."""
    return coaching.athletes_for(coach)


def coach_athlete(coach, athlete_id):
    """One of the coach's own active athletes (Athlete.DoesNotExist for anyone else)."""
    return coaching.athlete_for(coach, athlete_id)


def roster(coach, q=""):
    """The coach's active athletes, optionally by name or email, each with how many metrics
    are missing."""
    from django.db.models import Q

    from .metrics import missing_metrics

    athletes = coach_athletes(coach).select_related("user")
    q = (q or "").strip()
    if q:
        athletes = athletes.filter(Q(user__name__icontains=q) | Q(user__email__icontains=q))
    return [{"athlete": a, "missing": len(missing_metrics(a))} for a in athletes]
