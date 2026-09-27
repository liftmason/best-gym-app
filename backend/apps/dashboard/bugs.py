"""Bug reports from the "Report a bug" button in both apps; read in the Django admin."""

from apps.core import errors

from .models import BugReport

MAX_DESCRIPTION = 4000
MAX_PAGE = 500
MAX_SCREEN = 40
MAX_USER_AGENT = 400


class InvalidReport(errors.Invalid):
    pass


def side_for(user, asked=None):
    """The app the report came from: as the header said, else the person's profile."""
    if asked in BugReport.Side.values:
        return asked
    return BugReport.Side.COACH if user.coach_profile else BugReport.Side.ATHLETE


def report(user, *, description, side=None, page="", screen="", user_agent=""):
    """Save a report with where it came from (page, device, screen size, the person's gym)."""
    description = (description or "").strip()
    if not description:
        raise InvalidReport("Describe the problem first.")
    if len(description) > MAX_DESCRIPTION:
        raise InvalidReport(f"Keep it to {MAX_DESCRIPTION} characters.")
    profile = user.coach_profile or user.athlete_profile
    return BugReport.objects.create(
        user=user,
        gym=profile.gym if profile else None,
        side=side_for(user, side),
        description=description,
        page=(page or "")[:MAX_PAGE],
        screen=(screen or "")[:MAX_SCREEN],
        user_agent=(user_agent or "")[:MAX_USER_AGENT],
    )
