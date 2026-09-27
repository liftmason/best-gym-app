"""Cursor pagination for lists that grow (the feed, session history): newest first, and a
cursor that stays right when new rows arrive. A cursor is opaque to the app (URL-safe
base64 of "<iso time>|<id>" of the last row); pass it back as `before` for the next page."""

import base64
import binascii
import datetime
import uuid

from django.db.models import Q

from apps.core import errors

MAX_LIMIT = 100


def page(queryset, before="", limit=50, field="created_at"):
    """(rows, next cursor or None) for `queryset`, newest first by `field` then id."""
    limit = max(1, min(int(limit or 50), MAX_LIMIT))
    queryset = queryset.order_by(f"-{field}", "-id")
    if before:
        try:
            at, pk = base64.urlsafe_b64decode(before.encode()).decode().split("|")
            at, pk = datetime.datetime.fromisoformat(at), uuid.UUID(pk)
        except ValueError, binascii.Error, UnicodeDecodeError:
            raise errors.Invalid({"before": "Not a cursor from this list."}) from None
        queryset = queryset.filter(Q(**{f"{field}__lt": at}) | Q(**{field: at, "id__lt": pk}))
    rows = list(queryset[: limit + 1])
    more = len(rows) > limit
    rows = rows[:limit]
    last = rows[-1] if rows else None
    if not more:
        return rows, None
    return rows, base64.urlsafe_b64encode(f"{getattr(last, field).isoformat()}|{last.pk}".encode()).decode()
