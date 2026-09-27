"""Sign in with Apple and Google (docs/EXPO_MIGRATION.md, "Sign-in"). The app gets an
identity token from the provider's own button; the backend checks it and finds the account.

- The token's signature is checked against the provider's published keys, and its issuer,
  audience (our app's client ids, APPLE_CLIENT_IDS / GOOGLE_CLIENT_IDS) and expiry.
- Nonce: the app asks us for one (`new_nonce`, signed, 10 minutes, usable once), gives the
  provider its SHA-256 (hex), and sends us the nonce itself; the token must carry the hash.
  A token copied off one sign-in can't be replayed.
- Finding the account: the provider's user id (a LinkedIdentity), else a verified email
  that matches an account (the identity is linked to it), else a sign-up ticket that
  carries the identity for the coach sign-up or invite forms to link.
"""

import hashlib

import jwt
from django.conf import settings
from django.core import signing

from apps import ratelimit
from apps.core import errors

from . import services
from .models import IdentityKind, LinkedIdentity

NONCE_SALT = "signin.nonce"
NONCE_MAX_AGE = 10 * 60
PROVIDERS = {
    IdentityKind.APPLE: {
        "issuers": ["https://appleid.apple.com"],
        "keys": "https://appleid.apple.com/auth/keys",
        "audiences": "APPLE_CLIENT_IDS",
    },
    IdentityKind.GOOGLE: {
        "issuers": ["https://accounts.google.com", "accounts.google.com"],
        "keys": "https://www.googleapis.com/oauth2/v3/certs",
        "audiences": "GOOGLE_CLIENT_IDS",
    },
}
_key_clients = {}


class TokenRefused(errors.NotSignedIn):
    """The identity token didn't check out (signature, audience, expiry or nonce)."""


def new_nonce():
    return signing.dumps(services.secrets.token_urlsafe(16), salt=NONCE_SALT)


def nonce_hash(nonce):
    return hashlib.sha256(nonce.encode()).hexdigest()


def signing_key(provider, token):
    """The provider's public key for this token (fetched from its published keys, cached)."""
    url = PROVIDERS[provider]["keys"]
    client = _key_clients.setdefault(url, jwt.PyJWKClient(url, cache_keys=True, timeout=5))
    return client.get_signing_key_from_jwt(token).key


def verify(provider, token, nonce):
    """The token's claims, or TokenRefused."""
    if provider not in PROVIDERS:
        raise errors.NotFound()
    config = PROVIDERS[provider]
    audiences = getattr(settings, config["audiences"])
    if not audiences:
        raise errors.NotFound()  # this provider isn't set up here
    try:
        signing.loads(nonce or "", salt=NONCE_SALT, max_age=NONCE_MAX_AGE)
    except signing.BadSignature:
        raise TokenRefused("Start signing in again.") from None
    if not ratelimit.hit("nonce", nonce, 1, NONCE_MAX_AGE):
        raise TokenRefused("Start signing in again.")  # used already
    try:
        claims = jwt.decode(
            token,
            signing_key(provider, token),
            algorithms=["RS256", "ES256"],
            audience=audiences,
            issuer=config["issuers"],
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
    except (jwt.PyJWTError, jwt.PyJWKClientError) as err:
        raise TokenRefused("That sign-in didn't check out. Try again.") from err
    if claims.get("nonce") != nonce_hash(nonce):
        raise TokenRefused("Start signing in again.")
    return claims


def _verified_email(claims):
    verified = claims.get("email_verified") in (True, "true")
    return claims["email"].strip().lower() if verified and claims.get("email") else None


def sign_in(provider, token, nonce):
    """(user, None) for a known person, or (None, sign-up ticket carrying the identity)."""
    claims = verify(provider, token, nonce)
    identity = (
        LinkedIdentity.objects.select_related("user").filter(kind=provider, subject=claims["sub"]).first()
    )
    if identity:
        return identity.user, None
    email = _verified_email(claims)
    user = services.user_for_email(email) if email else None
    if user:
        link(user, provider, claims["sub"], email)
        return user, None
    if not email:
        raise TokenRefused("That account has no verified email. Sign in with a code instead.")
    return None, services.ticket(email, identity=(provider, claims["sub"]))


def link(user, provider, subject, email=""):
    """Add a provider sign-in to an account. Conflict if it's already another account's."""
    identity, created = LinkedIdentity.objects.get_or_create(
        kind=provider, subject=subject, defaults={"user": user, "email": email or ""}
    )
    if not created and identity.user_id != user.pk:
        raise errors.Conflict("That sign-in belongs to another account.")
    return identity


def link_signed_in(user, provider, token, nonce):
    """Link a provider to the signed-in account (e.g. an Apple relay address)."""
    claims = verify(provider, token, nonce)
    return link(user, provider, claims["sub"], claims.get("email") or "")
