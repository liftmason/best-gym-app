"""Who's signed in (/me), and joining a coach through an invite link. The rules are in
services.py, invites.py and coaching.py."""

import uuid

from ninja import Router, Schema, Status

from apps.api.main import limit
from apps.billing import entitlements
from apps.core import errors
from apps.signin.api import TokensOut

from . import invites
from .models import Invite

router = Router(tags=["Account"])


class GymOut(Schema):
    id: uuid.UUID
    name: str
    units: str
    timezone: str
    week_start: int


class PlanRef(Schema):
    code: str
    name: str


class AthleteCount(Schema):
    used: int
    max: int | None


class Entitlements(Schema):
    """What the gym's plan allows now. Hide upgrade prompts while billing_enabled is false."""

    billing_enabled: bool
    plan: PlanRef
    status: str | None
    athletes: AthleteCount
    form_videos: bool
    programming: bool  # false: programming is read-only (a lapsed payment)


class CoachProfileOut(Schema):
    id: uuid.UUID
    title: str
    role: str
    gym: GymOut
    entitlements: Entitlements


class AthleteProfileOut(Schema):
    id: uuid.UUID
    units: str
    coach_name: str | None
    gym_name: str | None
    hide_history_before_link: bool
    week_start: int  # 0 Monday … 6 Sunday: the gym's training week (weekly habit targets)
    max_updates: str  # auto: a session's PR becomes the max; coach: the coach decides
    height_cm: str | None  # the athlete's own metrics that aren't dated rows (metrics.py)
    years_training: str | None  # <1, 1-3, 3-5, 5+


class MeOut(Schema):
    id: uuid.UUID
    email: str
    name: str
    timezone: str
    coach: CoachProfileOut | None
    athlete: AthleteProfileOut | None


def _gym(gym):
    return {
        "id": gym.pk,
        "name": gym.name,
        "units": gym.units,
        "timezone": gym.timezone,
        "week_start": gym.week_start,
    }


@router.get("/me", response=MeOut)
def me(request):
    """The signed-in person and their profiles: a coach (with their gym), an athlete (with
    their coach), or both. An athlete without a coach has `coach_name` null."""
    user = request.user
    coach = user.coach_profile
    athlete = getattr(user, "athlete", None)
    return {
        "id": user.pk,
        "email": user.email,
        "name": user.name,
        "timezone": user.timezone,
        "coach": {
            "id": coach.pk,
            "title": coach.title,
            "role": coach.membership.role,
            "gym": _gym(coach.gym),
            "entitlements": entitlements.summary(coach.gym),
        }
        if coach and coach.membership
        else None,
        "athlete": {
            "id": athlete.pk,
            "units": athlete.units,
            "coach_name": athlete.coach.user.name if athlete.active_coaching else None,
            "gym_name": athlete.gym.name if athlete.active_coaching else None,
            "hide_history_before_link": athlete.hide_history_before_link,
            "week_start": athlete.gym.week_start if athlete.gym else 0,
            "max_updates": athlete.max_updates,
            "height_cm": format(athlete.height_cm, "f") if athlete.height_cm is not None else None,
            "years_training": athlete.years_training or None,
        }
        if athlete
        else None,
    }


class Profile(Schema):
    name: str | None = None
    timezone: str | None = None


@router.patch("/me", response={204: None})
def update_profile(request, data: Profile):
    """Change one's own name or time zone (next to GET /me: one path, one router)."""
    from . import services

    services.update_profile(request.user, name=data.name, timezone=data.timezone)
    return Status(204, None)


class DeleteAccount(Schema):
    confirm: str  # the word DELETE, typed


@router.post("/me/delete", response={204: None})
def delete_account(request, data: DeleteAccount):
    """Delete one's own account (the stores require it): the athlete's data is erased, a
    coach's details scrubbed (accounts/erase.py). Every session ends with it."""
    from django.conf import settings

    from . import erase

    if data.confirm.strip().upper() != "DELETE":
        raise errors.Invalid({"confirm": "Type DELETE to confirm."})
    erase.erase_account(request.user, base_url=settings.SITE_URL)
    return Status(204, None)


# ---------------------------------------------------------------- invites


class InviteOut(Schema):
    coach_name: str
    gym_name: str
    email: str  # pre-fills the form; any email can join


class JoinNewIn(Schema):
    ticket: str
    name: str
    timezone: str = ""
    device: str = ""


class JoinedOut(Schema):
    athlete_id: uuid.UUID
    coach_name: str
    gym_name: str


def _invite(token):
    """A usable invite by its link token: NotFound for none, Gone once used or expired."""
    invite = Invite.objects.select_related("coach__user", "gym").filter(token=token).first()
    if invite is None:
        raise errors.NotFound()
    if not invite.is_usable:
        raise invites.InviteUnusable()
    return invite


def _joined(athlete):
    return {"athlete_id": athlete.pk, "coach_name": athlete.coach.user.name, "gym_name": athlete.gym.name}


@router.get("/join/{token}", auth=None, response=InviteOut, tags=["Joining"])
def invite(request, token: str):
    """What an invite link is for, before joining."""
    invite = _invite(token)
    return {"coach_name": invite.coach.user.name, "gym_name": invite.gym.name, "email": invite.email}


@router.post("/join/{token}/accept", response=JoinedOut, tags=["Joining"])
def accept_invite(request, token: str):
    """Join as the signed-in account (an athlete without a coach, or a new athlete profile)."""
    limit(request, "join", 10, 3600)
    return _joined(invites.accept(_invite(token).pk, user=request.user))


@router.post("/join/{token}/signup", auth=None, response={201: TokensOut}, tags=["Joining"])
def join_new(request, token: str, data: JoinNewIn):
    """Join as a new account, for an email verified by `auth/email/verify` (its ticket).
    Answers with the new account's tokens, like signing in."""
    from apps.signin import services as signin
    from apps.signin.api import signed_in

    limit(request, "join", 10, 3600)
    email = signin.ticket_email(data.ticket)
    athlete = invites.accept(_invite(token).pk, name=data.name, email=email, timezone_name=data.timezone)
    signin.link_ticket(athlete.user, data.ticket)
    return signed_in(request, signin.open_session(athlete.user, data.device), status=201)
