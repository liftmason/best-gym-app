"""Sync for an athlete's phone (/api/v1/sync/...): pull, bootstrap and push. Coaches don't
sync; their screens use the API online. The rules are in pull.py, bootstrap.py and push.py."""

import datetime
import uuid
from typing import Any

from ninja import Router, Schema

from apps.api.main import athlete_of

from . import pull as pulling

router = Router(tags=["Sync"])


class Row(Schema):
    table: str
    id: str
    op: str  # upsert, delete
    row: dict[str, Any] | None


class PullOut(Schema):
    changes: list[Row]
    cursor: str  # pass back for the next page
    more: bool  # true: pull again straight away
    library_reset: bool  # true: replace the gym library with `library`
    library: list[Row] | None


@router.get("/sync/pull", response=PullOut)
def pull(request, cursor: str):
    """What changed since `cursor` (from bootstrap or the last pull), a page at a time."""
    return pulling.pull(athlete_of(request), cursor)


class BootstrapOut(Schema):
    tables: dict[str, list[dict[str, Any]]]  # table -> rows
    cursor: str  # pull from here next
    history_from: datetime.date  # older sessions: GET /me/history


@router.get("/sync/bootstrap", response=BootstrapOut)
def bootstrap(request):
    """A new device's first copy of the athlete's scope (12 months of history)."""
    from . import bootstrap as booting

    return booting.snapshot(athlete_of(request))


class HistoryOut(Schema):
    tables: dict[str, list[dict[str, Any]]]
    next: str | None


@router.get("/me/history", response=HistoryOut, tags=["My training"])
def older_history(request, before: str = "", limit: int = 20):
    """Sessions older than the phone's copy, a page at a time (online only)."""
    from . import bootstrap as booting

    tables, cursor = booting.older_sessions(athlete_of(request), before, limit)
    return {"tables": tables, "next": cursor}


class Action(Schema):
    id: uuid.UUID  # chosen by the phone; the same id again is the same action
    name: str  # session.start, set.save, … (apps/sync/actions.py)
    at: datetime.datetime | None = None  # when the athlete did it
    payload: dict[str, Any] = {}


class PushIn(Schema):
    actions: list[Action]


class Outcome(Schema):
    id: str
    status: str  # done, rejected (drop it), retry (send it again later, with what follows)
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None


class PushOut(Schema):
    results: list[Outcome]


@router.post("/sync/push", response=PushOut)
def push(request, data: PushIn):
    """The athlete's actions, in the order they happened. Push before pulling."""
    from . import push as pushing

    return {"results": pushing.push(athlete_of(request), [a.dict() for a in data.actions])}
