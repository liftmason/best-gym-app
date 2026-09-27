"""Issue reports: an athlete tells their coach about pain, missing equipment, a prescription
that looks wrong, or something else; the coach resolves it. Each report alerts the coach."""

from django.utils import timezone

from apps.dashboard import alerts

from .models import IssueKind, IssueReport

MAX_TEXT = 2000


class InvalidIssue(Exception):
    pass


def report(log, kind, text=""):
    """A report about one of the athlete's sessions."""
    if kind not in IssueKind.values:
        raise InvalidIssue("Pick what kind of issue it is.")
    text = (text or "").strip()
    if len(text) > MAX_TEXT:
        raise InvalidIssue(f"Keep it to {MAX_TEXT} characters.")
    issue = IssueReport.objects.create(athlete=log.athlete, session_log=log, kind=kind, text=text)
    alerts.issue_reported(issue)
    return issue


def resolve(issue):
    """Mark resolved (once) and clear the coach's feed item."""
    if issue.resolved_at is None:
        issue.resolved_at = timezone.now()
        issue.save(update_fields=["resolved_at"])
        alerts.issue_resolved(issue)
    return issue
