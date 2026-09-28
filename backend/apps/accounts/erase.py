"""Deleting an account (docs/plans/S8_LAUNCH.md, decisions A and B).

- An athlete: everything they recorded is erased. Training history is protected from
  deletion (a session log, program, max, bodyweight or habit blocks deleting its athlete),
  so a slip in the admin or a cascade can't wipe it; `erase_athlete` is the one way to
  remove it, explicitly, in an order the protections allow. Their coach is emailed.
- A coach: their personal details are scrubbed and they can't sign in again, but the rows
  stay, because their athletes' history points at them (coaching links, the gym's
  exercises and week types, messages). Their athletes lose their coach and keep their
  history. If they were the gym's last coach, its templates, default questions and invites
  go and its subscription is cancelled.
"""

import logging

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import (
    BodyweightEntry,
    Coaching,
    CoachingStatus,
    GymMembership,
    GymRole,
    Invite,
    MaxEntry,
)
from apps.core import errors
from apps.messaging.models import Thread
from apps.programs.models import Habit, Program
from apps.workouts import videos
from apps.workouts.models import FormVideo, SessionLog


@transaction.atomic
def erase_athlete(athlete):
    """Delete the athlete and everything recorded about them: sessions, sets, check-ins,
    form videos (files too), programs, maxes, bodyweights, habits, issues, coaching links,
    messages and alerts. The user account goes as well unless it is also a coach's."""
    user = athlete.user
    keys = list(FormVideo.objects.filter(session_log__athlete=athlete).values_list("key", flat=True))
    MaxEntry.objects.filter(athlete=athlete).delete()
    BodyweightEntry.objects.filter(athlete=athlete).delete()
    Habit.objects.filter(athlete=athlete).delete()
    SessionLog.objects.filter(athlete=athlete).delete()
    Program.objects.filter(athlete=athlete).delete()
    Thread.objects.filter(athlete=athlete).delete()
    Coaching.objects.filter(athlete=athlete).delete()
    athlete.delete()
    if not hasattr(user, "coach"):
        user.delete()
    if keys and videos.enabled():
        # After the rows, once the transaction commits: a failed erase keeps its files.
        transaction.on_commit(lambda: [videos.delete(key) for key in keys])


logger = logging.getLogger(__name__)

FORMER_COACH = "Former coach"


class CannotErase(errors.Conflict):
    """The account can't be deleted as it is (an owner whose gym has other coaches)."""


HAND_OVER = "Your gym has other coaches. Make one of them its owner before deleting your account."


def _other_coaches(coach):
    membership = coach.membership
    if membership is None:
        return GymMembership.objects.none()
    return GymMembership.objects.filter(gym=membership.gym, ended_at__isnull=True).exclude(coach=coach)


@transaction.atomic
def erase_coach(coach):
    """Scrub a coach who deleted their account (see the module docstring). An owner whose
    gym has other coaches must hand it over first."""
    from apps.billing import stripe_billing
    from apps.dashboard.models import Notification
    from apps.library.models import Template
    from apps.signin.models import DeviceSession, LinkedIdentity
    from apps.workouts.models import CheckinQuestion

    from . import coaching

    membership = coach.membership
    others = _other_coaches(coach)
    if _must_hand_over(coach):
        raise CannotErase(HAND_OVER)
    for link in Coaching.objects.filter(coach=coach, status=CoachingStatus.ACTIVE).select_related("athlete"):
        coaching.end(link.athlete)
    Invite.objects.filter(coach=coach).delete()
    if membership is not None:
        gym = membership.gym
        membership.ended_at = timezone.now()
        membership.save(update_fields=["ended_at"])
        if not others.exists():  # the gym's last coach: it closes
            Template.objects.filter(gym=gym).delete()
            CheckinQuestion.objects.filter(gym=gym, athlete__isnull=True).delete()
            Invite.objects.filter(gym=gym).delete()
            transaction.on_commit(lambda: _cancel_quietly(stripe_billing, gym))

    user = coach.user
    Notification.objects.filter(recipient=user).delete()
    DeviceSession.objects.filter(user=user).delete()
    LinkedIdentity.objects.filter(user=user).delete()
    user.name = FORMER_COACH
    user.email = f"deleted-{user.pk}@deleted.invalid"
    user.set_unusable_password()
    user.is_active = False
    user.save()
    coach.title, coach.digest = "", False
    coach.save(update_fields=["title", "digest"])


def _must_hand_over(coach):
    membership = coach.membership
    return membership is not None and membership.role == GymRole.OWNER and _other_coaches(coach).exists()


def _cancel_quietly(stripe_billing, gym):
    try:
        stripe_billing.cancel(gym)
    except Exception:  # the account is gone either way; the admin sees the error
        logger.exception("Couldn't cancel the subscription of %s", gym.pk)


def erase_account(user, base_url=None):
    """What "Delete my account" does: the athlete profile is erased, the coach profile
    scrubbed (either or both). Refusals (CannotErase) change nothing."""
    from .emails import send_athlete_left

    coach = getattr(user, "coach", None)
    athlete = getattr(user, "athlete", None)
    if coach is not None and _must_hand_over(coach):
        raise CannotErase(HAND_OVER)
    with transaction.atomic():
        if athlete is not None:
            their_coach = athlete.coach if athlete.active_coaching else None
            name = user.name or user.email
            erase_athlete(athlete)
            if their_coach is not None:
                transaction.on_commit(lambda: send_athlete_left(base_url, their_coach, name))
        if coach is not None:
            erase_coach(coach)
