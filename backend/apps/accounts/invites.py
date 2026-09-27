"""Invites: a coach creates or revokes one; an athlete accepts one, as a new account or
their existing one. The link is the credential (single use, 144-bit token, 14-day expiry);
the email on an invite only pre-fills the form (docs/EXPO_MIGRATION.md, "Sign-in")."""

from django.db import transaction
from django.utils import timezone

from apps.workouts.models import copy_defaults_to

from . import coaching
from .models import Athlete, Invite, InviteStatus, User
from .services import AccountExists, check_new_account, email_taken, valid_timezone


class InviteUnusable(Exception):
    """Accepted, revoked or expired."""


class AlreadyAthlete(Exception):
    """This account's athlete profile already has an active coach."""


class InvalidInvite(Exception):
    """With the message to show."""


def template_choices(gym):
    """What an invite can start the athlete on: the gym's program templates and saved weeks."""
    from apps.library.models import Template, TemplateKind

    return Template.objects.filter(gym=gym, kind__in=[TemplateKind.PROGRAM, TemplateKind.WEEK]).order_by(
        "kind", "name"
    )


def create(coach, email="", starting_template=None, base_url=None):
    """A pending invite. `starting_template` must be one of the coach's gym's program
    templates or saved weeks. With an email address and the site's `base_url`, the join link
    is emailed; with no address the coach shares the link themselves."""
    from django.core.exceptions import ValidationError
    from django.core.validators import validate_email

    from apps.library.models import TemplateKind

    email = (email or "").strip()
    if email:
        try:
            validate_email(email)
        except ValidationError:
            raise InvalidInvite("Enter a valid email address.") from None

    if starting_template is not None and (
        starting_template.gym_id != coach.gym.pk
        or starting_template.kind not in (TemplateKind.PROGRAM, TemplateKind.WEEK)
    ):
        raise ValueError("That template isn't one of this gym's programs or saved weeks.")
    invite = Invite.objects.create(
        coach=coach, gym=coach.gym, email=email, starting_template=starting_template
    )
    if email and base_url:
        from .emails import send_invite_email

        send_invite_email(base_url, invite)
    return invite


def revoke(coach, invite_id):
    """Revoke one of the coach's pending invites. Invite.DoesNotExist for anyone else's."""
    invite = Invite.objects.get(pk=invite_id, coach=coach, status=InviteStatus.PENDING)
    invite.status = InviteStatus.REVOKED
    invite.save(update_fields=["status"])
    return invite


def pending(coach):
    return [i for i in coach.invites.filter(status=InviteStatus.PENDING) if not i.is_expired]


def check_can_join(user):
    """Raise if this signed-in account can't join a coach: its athlete profile, if it has
    one, must be without a coach (archived athletes join a new coach with their history)."""
    if user.athlete_profile:
        raise AlreadyAthlete()


@transaction.atomic
def accept(invite_id, *, user=None, name="", email="", password=None, timezone_name=""):
    """Join through an invite: as the signed-in `user`, or as a new account (name, email,
    optional password). Creates the athlete profile with the gym's units (or reuses the
    account's coachless one), links it to the coach, copies the gym's check-in questions,
    applies the starting template as an unpublished draft, and marks the invite accepted.
    The invite row is locked, so two people can't use one link."""
    invite = Invite.objects.select_for_update().select_related("gym", "coach__user").get(pk=invite_id)
    if not invite.is_usable:
        raise InviteUnusable()
    gym = invite.gym
    if user is not None:
        check_can_join(user)
    else:
        name = check_new_account(name, email, password)
        if email_taken(email):
            raise AccountExists(email)
        user = User.objects.create_user(
            email, password, name=name, timezone=valid_timezone(timezone_name, gym.timezone)
        )
    athlete = getattr(user, "athlete", None) or Athlete.objects.create(user=user, units=gym.units)
    coaching.start(invite.coach, athlete)
    copy_defaults_to(athlete)
    if invite.starting_template_id:
        _apply_starting_template(invite, athlete)
    invite.status = InviteStatus.ACCEPTED
    invite.accepted_by = user
    invite.accepted_at = timezone.now()
    invite.save(update_fields=["status", "accepted_by", "accepted_at"])
    return athlete


def _apply_starting_template(invite, athlete):
    """The invite's template becomes an unpublished draft program from next week, on the
    template's default training days, for the coach to review and publish."""
    from apps.library import apply

    template = invite.starting_template
    try:
        apply.confirm(
            athlete,
            template,
            apply.default_days(template),
            apply.RECENT,
            "new:next",
            False,
            invite.coach.user,
        )
    except apply.CannotApply:
        pass  # an empty template: the coach builds the program by hand
