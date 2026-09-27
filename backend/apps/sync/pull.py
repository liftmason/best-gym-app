"""Pull: what changed in an athlete's scope since their cursor (docs/EXPO_MIGRATION.md,
"Sync protocol").

**The cursor never skips a change.** Transaction ids are handed out when a transaction
first writes, but transactions commit in any order, so "everything after sequence N" would
miss one that started earlier and committed later. A cursor is therefore a window of
transaction ids `[lo, hi)`: `hi` is the oldest transaction still running when the window
opens, so every transaction inside it has finished and all its changes are there to read.
Within a window, pages go by sequence number (`after`). When a window is read to the end,
the next one opens at `hi`. A long-running transaction only delays what comes after it.

Each changed row is sent as it is now if the athlete may see it (scope.visible), else as a
deletion marker, whatever the reason: deleted, unpublished, or moved out of scope.
"""

import base64
import json
from collections import defaultdict

from django.db import connection

from apps.core import errors

from . import scope
from .models import Change

PAGE = 500


class BadCursor(errors.Invalid):
    """Not a cursor this server gave out: bootstrap again."""


def encode(cursor):
    return base64.urlsafe_b64encode(json.dumps(cursor).encode()).decode()


def decode(value):
    try:
        cursor = json.loads(base64.urlsafe_b64decode(value.encode()))
        return {
            "lo": int(cursor["lo"]),
            "hi": cursor.get("hi"),
            "after": int(cursor.get("after", 0)),
            "gym": cursor.get("gym"),
        }
    except ValueError, KeyError, TypeError:
        raise BadCursor({"cursor": "Not a cursor from this server: bootstrap again."}) from None


def horizon():
    """The oldest transaction still running: everything below it has finished."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_snapshot_xmin(pg_current_snapshot())::text::bigint")
        return cursor.fetchone()[0]


def _changes(athlete, gym, lo, hi, after, limit):
    library_tables = [scope.table_of(label) for label in scope.LIBRARY]
    rows = Change.objects.filter(txid__gte=lo, txid__lt=hi, seq__gt=after)
    mine = rows.filter(athlete_id=athlete.pk)
    theirs = rows.filter(gym_id=gym.pk, table__in=library_tables) if gym else rows.none()
    return list((mine | theirs).order_by("seq")[: limit + 1])


def rows_for(athlete, gym, keys):
    """[{table, id, op, row}] for (table, id) keys: the current row if visible, else a
    deletion marker."""
    wanted = defaultdict(set)
    for table, row_id in keys:
        wanted[table].add(row_id)
    found = {}
    for table, row_ids in wanted.items():
        label = scope.label_for(table)
        if label is None:
            continue
        for obj in scope.visible(label, athlete, gym).filter(pk__in=row_ids):
            found[(table, obj.pk)] = scope.serialize(label, obj)
    out = []
    for table, row_id in keys:
        if scope.label_for(table) is None:
            continue
        row = found.get((table, row_id))
        out.append({"table": table, "id": str(row_id), "op": "upsert" if row else "delete", "row": row})
    return out


def pull(athlete, cursor_value, limit=PAGE):
    """{changes, cursor, more, library_reset, library}: one page."""
    cursor = decode(cursor_value)
    from .purge import below

    if cursor["lo"] < below():
        raise errors.Gone("This device hasn't synced for a long time: download everything again (bootstrap).")
    gym = athlete.gym
    gym_id = str(gym.pk) if gym else None
    library_reset = cursor["gym"] != gym_id
    if cursor["hi"] is None:
        cursor["hi"] = horizon()
    batch = _changes(athlete, gym, cursor["lo"], cursor["hi"], cursor["after"], limit)
    more = len(batch) > limit
    batch = batch[:limit]
    keys = list(dict.fromkeys((c.table, c.row_id) for c in batch))  # each row once, in order
    changes = rows_for(athlete, gym, keys)
    if more:
        next_cursor = {"lo": cursor["lo"], "hi": cursor["hi"], "after": batch[-1].seq, "gym": gym_id}
    else:
        next_cursor = {"lo": cursor["hi"], "hi": None, "after": 0, "gym": gym_id}
    library = None
    if library_reset:
        from .bootstrap import library_rows

        library = library_rows(gym)
    return {
        "changes": changes,
        "cursor": encode(next_cursor),
        "more": more,
        "library_reset": library_reset,
        "library": library,
    }
