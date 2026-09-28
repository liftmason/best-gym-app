"""Sign-in rules. The API calls these; they hold the rules (docs/EXPO_MIGRATION.md, "Sign-in").

- `start(email, ip)` sends a 6-digit code: stored hashed, 10 minutes, one per email, 5
  guesses. The answer never says whether an account exists.
- `verify(email, code)` checks it. A known email signs in (`open_session`); a new one gets a
  sign-up ticket, a signed note that the email was verified, for the coach sign-up or
  invite-join form (`ticket_email`).
- Sessions: a 15-minute access token and a 90-day refresh token, extended on each use.
  `refresh` rotates the refresh token; presenting an old one again revokes the session.
- Fixed codes: the app-review account (REVIEW_ACCOUNT_EMAIL / REVIEW_ACCOUNT_CODE), and in
  development the seeded demo users (DEMO_SIGNIN_CODE). Production refuses any other.
"""

import datetime
import hashlib
import hmac
import secrets
from dataclasses import dataclass

from django.conf import settings
from django.core import signing
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.db import transaction
from django.template.loader import render_to_string
from django.utils import timezone

from apps import ratelimit
from apps.accounts.models import User
from apps.core import errors
from apps.core import models as core

from .models import DeviceSession, EmailCode, IdentityKind, LinkedIdentity, RefreshToken

CODE_TTL = datetime.timedelta(minutes=10)
MAX_GUESSES = 5
REFRESH_TTL = datetime.timedelta(days=90)
REUSE_GRACE = datetime.timedelta(seconds=30)  # a retried refresh whose answer was lost
TICKET_MAX_AGE = 30 * 60  # seconds to finish sign-up after verifying the email
CODE_LIMITS = [("signin-email", 5), ("signin-ip", 30)]  # code requests per 15 minutes
CODE_WINDOW = 15 * 60
TICKET_SALT = "signin.ticket"


class CodeRefused(errors.Invalid):
    """Wrong, expired, used up or never sent: the same answer for each."""


class TicketRefused(errors.Invalid):
    """The sign-up ticket is missing, altered or too old: verify the email again."""


@dataclass
class Tokens:
    session: DeviceSession
    access: str
    refresh: str

    @property
    def access_expires_at(self):
        return self.session.access_expires_at

    @property
    def refresh_expires_at(self):
        return self.session.refresh_expires_at


def normalize(email):
    email = (email or "").strip().lower()
    try:
        validate_email(email)
    except ValidationError:
        raise errors.Invalid({"email": "Enter a valid email address."}) from None
    return email


def _code_hash(email, code):
    return hmac.new(settings.SECRET_KEY.encode(), f"{email}:{code}".encode(), hashlib.sha256).hexdigest()


def _token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def fixed_code(email):
    """The fixed code for this email, if it has one (the review account; everyone during the
    free test run; demo users in development)."""
    if settings.REVIEW_ACCOUNT_CODE and email == settings.REVIEW_ACCOUNT_EMAIL:
        return settings.REVIEW_ACCOUNT_CODE
    if settings.TEST_SIGNIN_CODE:
        return settings.TEST_SIGNIN_CODE
    if settings.DEMO_SIGNIN_CODE and email.endswith("@" + settings.DEMO_EMAIL_DOMAIN):
        return settings.DEMO_SIGNIN_CODE
    return None


# ---------------------------------------------------------------- codes


def start(email, ip):
    """Send a sign-in code to `email` (any email: it may be a new coach). TooMany if the
    email or the address has asked too often. The answer is the same either way."""
    email = normalize(email)
    allowed = [
        ratelimit.hit(name, key, limit, CODE_WINDOW)
        for (name, limit), key in zip(CODE_LIMITS, (email, ip), strict=True)
    ]
    if not all(allowed):
        raise errors.TooMany("Too many codes asked for. Wait a few minutes and try again.")
    code = fixed_code(email) or f"{secrets.randbelow(10**6):06d}"
    EmailCode.objects.update_or_create(
        email=email,
        defaults={
            "code_hash": _code_hash(email, code),
            "expires_at": timezone.now() + CODE_TTL,
            "guesses": 0,
        },
    )
    context = {"code": code, "minutes": int(CODE_TTL.total_seconds() // 60)}
    subject = render_to_string("emails/signin_code_subject.txt", context).strip()
    send_mail(subject, render_to_string("emails/signin_code.txt", context), None, [email])


def verify(email, code):
    """The verified email, or CodeRefused. A right code is used up; each wrong one counts,
    and the fifth kills the code."""
    email = normalize(email)
    with transaction.atomic():  # decide and record inside; raise after, so a guess is kept
        row = EmailCode.objects.select_for_update().filter(email=email).first()
        if row is None or row.expires_at <= timezone.now() or row.guesses >= MAX_GUESSES:
            refused = "That code has expired. Ask for a new one."
        elif not hmac.compare_digest(row.code_hash, _code_hash(email, "".join((code or "").split()))):
            row.guesses += 1
            row.save(update_fields=["guesses"])
            refused = "That code isn't right."
        else:
            row.delete()
            refused = None
    if refused:
        raise CodeRefused(refused)
    return email


def user_for_email(email):
    """The account this email signs in to, if any."""
    identity = (
        LinkedIdentity.objects.select_related("user").filter(kind=IdentityKind.EMAIL, subject=email).first()
    )
    if identity:
        return identity.user
    return User.objects.filter(email__iexact=email).first()


def ticket(email, identity=None):
    """A sign-up ticket: the verified email, and an Apple or Google identity (kind, subject)
    to link when the account is made."""
    return signing.dumps({"email": email, "identity": list(identity) if identity else None}, salt=TICKET_SALT)


def ticket_claims(value):
    try:
        claims = signing.loads(value or "", salt=TICKET_SALT, max_age=TICKET_MAX_AGE)
        claims["email"]  # noqa: B018 - must be there
        return claims
    except signing.BadSignature, KeyError, TypeError:
        raise TicketRefused("Verify your email again to carry on.") from None


def ticket_email(value):
    return ticket_claims(value)["email"]


def link_ticket(user, value):
    """Link what a sign-up ticket verified to the new account: its email, and the Apple or
    Google identity it came from."""
    claims = ticket_claims(value)
    link_email(user, claims["email"])
    if claims.get("identity"):
        from .social import link

        kind, subject = claims["identity"]
        link(user, kind, subject, claims["email"])


def link_email(user, email):
    LinkedIdentity.objects.get_or_create(
        kind=IdentityKind.EMAIL, subject=email, defaults={"user": user, "email": email}
    )


# ---------------------------------------------------------------- sessions


def _new_access(session, now):
    access = secrets.token_urlsafe(32)
    session.access_hash = _token_hash(access)
    session.access_expires_at = now + datetime.timedelta(minutes=settings.ACCESS_TOKEN_TTL_MINUTES)
    return access


def _new_refresh(session, now):
    refresh = secrets.token_urlsafe(32)
    RefreshToken.objects.create(session=session, token_hash=_token_hash(refresh))
    session.refresh_expires_at = now + REFRESH_TTL
    return refresh


@transaction.atomic
def open_session(user, label=""):
    """Sign `user` in on a new device."""
    now = timezone.now()
    session = DeviceSession(user=user, label=(label or "")[:120], last_used_at=now)
    access = _new_access(session, now)
    session.refresh_expires_at = now + REFRESH_TTL
    session.save()
    return Tokens(session, access, _new_refresh(session, now))


def refresh(token):
    """New tokens for a refresh token (which is then used up). NotSignedIn if it's unknown,
    expired or revoked; presenting a used one after the grace period revokes the session."""
    with transaction.atomic():  # decide and record inside; raise after, so a revoke is kept
        tokens = _refresh(token)
    if tokens is None:
        raise errors.NotSignedIn()
    return tokens


def _refresh(token):
    row = RefreshToken.objects.select_related("session").filter(token_hash=_token_hash(token or "")).first()
    if row is None:
        return None
    session = row.session
    core.lock(session)
    session.refresh_from_db()
    now = timezone.now()
    if session.revoked_at or session.refresh_expires_at <= now:
        return None
    row.refresh_from_db()
    if row.used_at:
        if now - row.used_at > REUSE_GRACE:
            session.revoked_at = now  # an old token came back: assume it was copied
            session.save(update_fields=["revoked_at"])
        return None
    row.used_at = now
    row.save(update_fields=["used_at"])
    access = _new_access(session, now)
    session.last_used_at = now
    refresh_token = _new_refresh(session, now)
    session.save()
    return Tokens(session, access, refresh_token)


def authenticate(access):
    """The live session for an access token, or None."""
    now = timezone.now()
    session = (
        DeviceSession.objects.select_related("user")
        .filter(access_hash=_token_hash(access or ""), access_expires_at__gt=now, revoked_at__isnull=True)
        .first()
    )
    if session is None or not session.user.is_active:
        return None
    if now - session.last_used_at > datetime.timedelta(minutes=5):  # not a write per request
        DeviceSession.objects.filter(pk=session.pk).update(last_used_at=now)
    return session


def sign_out(session):
    DeviceSession.objects.filter(pk=session.pk).update(revoked_at=timezone.now())


def devices(user):
    return DeviceSession.objects.filter(
        user=user, revoked_at__isnull=True, refresh_expires_at__gt=timezone.now()
    )


def sign_out_device(user, session_id):
    """Sign out one of the user's devices; NotFound for anyone else's."""
    session = devices(user).filter(pk=session_id).first()  # look up first: refused means no write
    if session is None:
        raise errors.NotFound()
    sign_out(session)
