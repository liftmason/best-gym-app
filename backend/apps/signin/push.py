"""Push notifications through Expo's push service (https://docs.expo.dev/push-notifications/sending-notifications/).

Each signed-in device may register its Expo push token (on its DeviceSession). A push goes
to every live device of a user. Every push carries `sync: true`, so the app syncs at once;
a silent one (`nudge`) does only that.

Pushes are sent after the database commits, with short timeouts. A failure is logged and
never fails the request that caused it. A token Expo says is gone is forgotten.

PUSH_PROVIDER: "expo" sends; "console" (or blank) logs; "memory" keeps them in `outbox`
for tests.
"""

import json
import logging
import re
import urllib.request

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.core import errors

log = logging.getLogger(__name__)

EXPO_URL = "https://exp.host/--/api/v2/push/send"
TIMEOUT = 5  # seconds: this runs inside a web request, after its commit
BATCH = 100  # Expo takes at most 100 messages a request
TOKEN = re.compile(r"^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$")

outbox = []  # PUSH_PROVIDER "memory"


class InvalidToken(errors.Invalid):
    """Not an Expo push token."""


def register(device, token):
    """This device's token. A token moves: if another session had it (the phone signed in
    again), that one loses it, so a phone never gets someone else's pushes."""
    from .models import DeviceSession

    token = (token or "").strip()
    if not TOKEN.match(token):
        raise InvalidToken({"token": "That isn't an Expo push token."})
    with transaction.atomic():
        DeviceSession.objects.filter(push_token=token).exclude(pk=device.pk).update(push_token="")
        device.push_token = token
        device.save(update_fields=["push_token"])


def unregister(device):
    device.push_token = ""
    device.save(update_fields=["push_token"])


def _tokens(user):
    from .models import DeviceSession

    return list(
        DeviceSession.objects.filter(
            user=user, revoked_at__isnull=True, refresh_expires_at__gt=timezone.now()
        )
        .exclude(push_token="")
        .values_list("push_token", flat=True)
    )


def to_user(user, title="", body="", data=None, silent=False):
    """Push to each of the user's devices once the current transaction commits."""
    if user is None:
        return
    payload = {"sync": True, **(data or {})}

    def send():
        tokens = _tokens(user)
        if not tokens:
            return
        messages = []
        for token in tokens:
            message = {"to": token, "data": payload}
            if silent:
                message["_contentAvailable"] = True  # iOS: wake the app to sync, show nothing
                message["priority"] = "normal"
            else:
                message.update(title=title[:100], body=body[:180], sound="default", priority="high")
            messages.append(message)
        try:
            deliver(messages)
        except Exception:
            log.exception("push to user %s failed", user.pk)

    transaction.on_commit(send)


def nudge(user):
    """A silent push: the app syncs, and the person sees nothing."""
    to_user(user, silent=True)


def deliver(messages):
    provider = settings.PUSH_PROVIDER
    if provider == "memory":
        outbox.extend(messages)
        return
    if provider != "expo":
        for message in messages:
            log.info("push (not sent, PUSH_PROVIDER=%r): %s", provider, message)
        return
    for start in range(0, len(messages), BATCH):
        batch = messages[start : start + BATCH]
        _forget_gone(batch, _post(batch))


def _post(messages):
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if settings.EXPO_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {settings.EXPO_ACCESS_TOKEN}"
    request = urllib.request.Request(EXPO_URL, json.dumps(messages).encode(), headers, method="POST")
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:  # noqa: S310 (a fixed https URL)
        return json.loads(response.read())


def _forget_gone(messages, answer):
    """Expo answers one ticket per message, in order; DeviceNotRegistered means the app is gone."""
    from .models import DeviceSession

    for message, ticket in zip(messages, answer.get("data") or [], strict=False):
        if ticket.get("status") == "error":
            reason = (ticket.get("details") or {}).get("error")
            if reason == "DeviceNotRegistered":
                DeviceSession.objects.filter(push_token=message["to"]).update(push_token="")
            else:
                log.warning("push refused: %s %s", reason, ticket.get("message"))
