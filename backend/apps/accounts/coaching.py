"""Who coaches whom, and who may see what.

A coach's athletes are the ones with an active Coaching link to them; every "this coach's
athletes" query goes through `athletes_for`, and every "may this coach see this athlete's
data" check through `can_view`. Archiving an athlete ends the link; joining another coach
starts a new one on the same athlete profile, so the history stays with the athlete.

History visibility (docs/EXPO_MIGRATION.md): a coach sees an athlete's data only while
their link is active. A new coach sees the full earlier history unless the athlete hides
what came before the link started (`Athlete.hide_history_before_link`).
"""

from django.db import transaction
from django.db.models import Prefetch
from django.utils import timezone

from apps.core import errors

from .models import Athlete, Coaching, CoachingStatus, GymMembership, GymRole


class AlreadyCoached(errors.Conflict):
    """The athlete already has an active coach."""


def _active():
    return Coaching.objects.filter(status=CoachingStatus.ACTIVE)


def athletes_for(coach):
    """The coach's athletes (active links), each with its link loaded so `athlete.coach`
    and `athlete.gym` cost no query."""
    return (
        Athlete.objects.filter(coachings__coach=coach, coachings__status=CoachingStatus.ACTIVE)
        .select_related("user")
        .prefetch_related(
            Prefetch(
                "coachings", queryset=_active().select_related("coach__user", "gym"), to_attr="active_links"
            )
        )
    )


def athlete_for(coach, athlete_id):
    """One of the coach's athletes; Athlete.DoesNotExist for anyone else's."""
    return athletes_for(coach).get(pk=athlete_id)


def link_for(coach, athlete):
    """The active link between them, or None."""
    return _active().filter(coach=coach, athlete=athlete).first()


def visible_from(coach, athlete):
    """The first date of the athlete's training this coach may see: None for all of it.
    Only meaningful while `can_view` is true."""
    if not athlete.hide_history_before_link:
        return None
    link = link_for(coach, athlete)
    return timezone.localdate(link.started_at, athlete.user.zoneinfo) if link else None


def can_view(coach, athlete, on=None):
    """May this coach see the athlete's data (from the date `on`, if given)?"""
    link = link_for(coach, athlete)
    if link is None:
        return False
    if on is None or not athlete.hide_history_before_link:
        return True
    return on >= timezone.localdate(link.started_at, athlete.user.zoneinfo)


@transaction.atomic
def start(coach, athlete):
    """Start coaching an athlete, at the coach's gym."""
    if _active().select_for_update().filter(athlete=athlete).exists():
        raise AlreadyCoached()
    link = Coaching.objects.create(coach=coach, athlete=athlete, gym=coach.gym)
    athlete.forget_coaching()
    return link


def end(athlete):
    """End the athlete's active link (archiving them). Returns it, or None if there was none."""
    link = _active().filter(athlete=athlete).first()
    if link is not None:
        link.status, link.ended_at = CoachingStatus.ENDED, timezone.now()
        link.save(update_fields=["status", "ended_at"])
        athlete.forget_coaching()
    return link


def join_gym(coach, gym, role=GymRole.COACH):
    """The coach's gym from now on; one active membership per coach for now."""
    membership = GymMembership.objects.create(coach=coach, gym=gym, role=role)
    coach.__dict__.pop("membership", None)
    return membership
