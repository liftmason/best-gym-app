"""Sign-in endpoints (/api/v1/auth/). The rules are in services.py.

Phones keep both tokens in secure storage. The web app (`X-Client: web`) gets its refresh
token as an HttpOnly cookie scoped to /api/v1/auth/, never in the body, and keeps the
access token in memory. The cookie is only read when that header is present: other sites
can't send it without passing CORS, so it doubles as the cookie's CSRF guard.
"""

import datetime
import uuid

from django.conf import settings
from ninja import Router, Schema, Status

from apps.api.main import api, limit
from apps.core import errors

from . import services

router = Router(tags=["Sign-in"])
COOKIE = "gt_refresh"
COOKIE_PATH = "/api/v1/auth/"


class EmailIn(Schema):
    email: str


class VerifyIn(Schema):
    email: str
    code: str
    device: str = ""


class TokensOut(Schema):
    access: str
    access_expires_at: datetime.datetime
    refresh: str | None  # None for the web app: it's in the cookie
    refresh_expires_at: datetime.datetime


class VerifyOut(Schema):
    signed_in: bool
    tokens: TokensOut | None = None
    ticket: str | None = None  # a new email: finish with coach sign-up or an invite


class CoachSignUpIn(Schema):
    ticket: str
    name: str
    gym_name: str
    units: str = "kg"
    starter: str = "weightlifting"
    timezone: str = ""
    device: str = ""


class RefreshIn(Schema):
    refresh: str = ""


class DeviceOut(Schema):
    id: uuid.UUID
    label: str
    created_at: datetime.datetime
    last_used_at: datetime.datetime
    current: bool


def is_web(request):
    return request.headers.get("X-Client") == "web"


def signed_in(request, tokens, status=200, wrap=False):
    """The tokens as the answer: in the body, or for the web app with the refresh token
    moved into its cookie. `wrap` answers in VerifyOut's shape."""
    web = is_web(request)
    body = {
        "access": tokens.access,
        "access_expires_at": tokens.access_expires_at,
        "refresh": None if web else tokens.refresh,
        "refresh_expires_at": tokens.refresh_expires_at,
    }
    if wrap:
        body = {"signed_in": True, "tokens": body, "ticket": None}
    response = api.create_response(request, body, status=status)
    if web:
        response.set_cookie(
            COOKIE,
            tokens.refresh,
            max_age=int(services.REFRESH_TTL.total_seconds()),
            httponly=True,
            secure=not settings.DEBUG,
            samesite="Lax",
            path=COOKIE_PATH,
        )
    return response


@router.post("/email/start", auth=None, response={202: None})
def email_start(request, data: EmailIn):
    """Email a sign-in code. The same answer whether or not the email has an account."""
    from apps.ratelimit import client_ip

    services.start(data.email, client_ip(request))
    return Status(202, None)


@router.post("/email/verify", auth=None, response=VerifyOut)
def email_verify(request, data: VerifyIn):
    """Check the code: sign in to the email's account, or, for a new email, return a sign-up
    ticket (valid 30 minutes) for coach sign-up or joining through an invite."""
    email = services.verify(data.email, data.code)
    user = services.user_for_email(email)
    if user is None:
        return {"signed_in": False, "tokens": None, "ticket": services.ticket(email)}
    services.link_email(user, email)
    return signed_in(request, services.open_session(user, data.device), wrap=True)


@router.post("/signup/coach", auth=None, response={201: TokensOut})
def coach_sign_up(request, data: CoachSignUpIn):
    """A new coach and their gym, for an email verified by `email/verify`."""
    from apps.accounts import services as accounts

    limit(request, "signup", 10, 3600)
    email = services.ticket_email(data.ticket)
    coach = accounts.sign_up_coach(
        name=data.name,
        email=email,
        gym_name=data.gym_name,
        units=data.units,
        starter=data.starter,
        timezone=data.timezone,
    )
    services.link_ticket(coach.user, data.ticket)
    return signed_in(request, services.open_session(coach.user, data.device), status=201)


@router.post("/refresh", auth=None, response=TokensOut)
def refresh(request, data: RefreshIn):
    """New tokens for a refresh token (from the body, or the web app's cookie)."""
    token = data.refresh or (request.COOKIES.get(COOKIE, "") if is_web(request) else "")
    if not token:
        raise errors.NotSignedIn()
    return signed_in(request, services.refresh(token))


@router.post("/signout", response={204: None})
def sign_out(request):
    services.sign_out(request.device)
    response = api.create_response(request, None, status=204)
    if is_web(request):
        response.delete_cookie(COOKIE, path=COOKIE_PATH)
    return response


@router.get("/devices", response=list[DeviceOut])
def devices(request):
    return [
        {
            "id": d.pk,
            "label": d.label,
            "created_at": d.created_at,
            "last_used_at": d.last_used_at,
            "current": d.pk == request.device.pk,
        }
        for d in services.devices(request.user)
    ]


@router.post("/devices/{device_id}/signout", response={204: None})
def sign_out_device(request, device_id: uuid.UUID):
    services.sign_out_device(request.user, device_id)
    return Status(204, None)


# ---------------------------------------------------------------- Apple and Google


class NonceOut(Schema):
    nonce: str  # give the provider its SHA-256 (hex); send it back with the token


class SocialIn(Schema):
    id_token: str
    nonce: str
    device: str = ""


@router.get("/nonce", auth=None, response=NonceOut)
def nonce(request):
    """A one-time value for an Apple or Google sign-in (10 minutes)."""
    from . import social

    return {"nonce": social.new_nonce()}


@router.post("/social/{provider}", auth=None, response=VerifyOut)
def social_sign_in(request, provider: str, data: SocialIn):
    """Sign in with an identity token from Apple or Google. A new person gets a sign-up
    ticket, as with an email code; the sign-in method is linked when they finish."""
    from . import social

    limit(request, "social", 30, 15 * 60)
    user, ticket = social.sign_in(provider, data.id_token, data.nonce)
    if user is None:
        return {"signed_in": False, "tokens": None, "ticket": ticket}
    return signed_in(request, services.open_session(user, data.device), wrap=True)


@router.post("/social/{provider}/link", response={204: None})
def link_social(request, provider: str, data: SocialIn):
    """Add Apple or Google sign-in to the signed-in account (e.g. an Apple relay address)."""
    from . import social

    social.link_signed_in(request.user, provider, data.id_token, data.nonce)
    return Status(204, None)
