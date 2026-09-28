"""POST /api/v1/ops/cron: the hourly jobs (jobs.py) for hosts with no cron service, called
by .github/workflows/cron.yml with CRON_TOKEN. Anything else gets the same 404 as a URL that
doesn't exist, so the endpoint doesn't reveal that it's there."""

import hmac
import io

from django.conf import settings
from ninja import Router, Schema, Status

from apps.core import errors

from . import jobs

router = Router(tags=["Operations"])


class HourlyOut(Schema):
    expired: int
    abandoned: int
    digests: int
    failed: list[str]


def _allowed(request):
    expected = settings.CRON_TOKEN
    scheme, _, given = request.headers.get("Authorization", "").partition(" ")
    # An empty setting must never match an empty token.
    # Bytes, because compare_digest raises on non-ASCII strings, and anyone can send a header.
    return (
        bool(expected)
        and scheme.lower() == "bearer"
        and hmac.compare_digest(given.encode(), expected.encode())
    )


@router.post("/ops/cron", auth=None, response={200: HourlyOut, 500: HourlyOut}, include_in_schema=False)
def cron(request):
    if not _allowed(request):
        raise errors.NotFound()
    result = jobs.run_hourly(io.StringIO())
    body = {
        "expired": result.expired,
        "abandoned": result.abandoned,
        "digests": result.sent,
        "failed": result.failures,
    }
    return Status(500 if result.failures else 200, body)
