"""Sync for an athlete's phone (/api/v1/sync/...): pull, bootstrap and push. Coaches don't
sync; their screens use the API online. The rules are in pull.py, bootstrap.py and push.py."""

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
