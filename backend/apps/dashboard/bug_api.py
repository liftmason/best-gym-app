"""The "Report a bug" button in both apps (/api/v1/bug-reports); read in the Django admin."""

from ninja import Router, Schema, Status

from apps.api.main import limit

from . import bugs

router = Router(tags=["Bug reports"])


class BugIn(Schema):
    description: str
    page: str = ""  # the screen it happened on
    screen: str = ""  # e.g. "390x844"
    side: str | None = None  # coach, athlete; default: from the person's profile


@router.post("/bug-reports", response={201: None})
def report(request, data: BugIn):
    limit(request, "bugs", 20, 3600, key=request.user.pk)
    bugs.report(
        request.user,
        description=data.description,
        side=data.side,
        page=data.page,
        screen=data.screen,
        user_agent=request.headers.get("User-Agent", ""),
    )
    return Status(201, None)
