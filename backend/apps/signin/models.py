"""Passwordless sign-in (docs/EXPO_MIGRATION.md, "Sign-in"): one-time email codes, the
sign-in methods linked to each account, and a session per signed-in device. Codes and
tokens are stored only as hashes."""

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core import models as core


class IdentityKind(models.TextChoices):
    EMAIL = "email", "Email code"
    APPLE = "apple", "Apple"
    GOOGLE = "google", "Google"


class LinkedIdentity(core.Model):
    """A way to sign in to an account. `subject` is the email (lower case) for email codes,
    or the provider's stable user id for Apple and Google."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="identities")
    kind = models.CharField(max_length=10, choices=IdentityKind.choices)
    subject = models.CharField(max_length=255)
    email = models.EmailField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "linked identities"
        constraints = [models.UniqueConstraint(fields=["kind", "subject"], name="one_account_per_identity")]

    def __str__(self):
        return f"{self.get_kind_display()}: {self.email or self.subject}"


class EmailCode(core.Model):
    """The one active sign-in code for an email: hashed, short-lived, a few guesses."""

    email = models.EmailField(unique=True)
    code_hash = models.CharField(max_length=64)
    expires_at = models.DateTimeField()
    guesses = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Code for {self.email}"


class DeviceSession(core.Model):
    """One signed-in device. The access token is short-lived; refresh tokens rotate (see
    RefreshToken). Signing out, or reusing an old refresh token, revokes the session."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="device_sessions"
    )
    label = models.CharField(max_length=120, blank=True)
    access_hash = models.CharField(max_length=64, unique=True)
    access_expires_at = models.DateTimeField()
    refresh_expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(default=timezone.now)
    revoked_at = models.DateTimeField(null=True, blank=True)
    # The device's Expo push token (apps/signin/push.py); blank until the app registers one.
    push_token = models.CharField(max_length=200, blank=True, db_index=True)

    class Meta:
        ordering = ["-last_used_at"]

    def __str__(self):
        return f"{self.user} on {self.label or 'a device'}"


class RefreshToken(core.Model):
    """Every refresh token a session has had. Only the newest is unused; presenting a used
    one (after a short grace for a retried request) means it was copied: the session goes."""

    session = models.ForeignKey(DeviceSession, on_delete=models.CASCADE, related_name="refresh_tokens")
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    used_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Refresh token for {self.session}"
