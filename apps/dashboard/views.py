"""The coach dashboard: KPIs, the roster table, the "Needs your attention" feed,
sessions today and recent sessions. The feed polls every 20 seconds; loading the
dashboard (and the nightly job) first brings the condition-based alerts up to date.

"Today" and "this week" on the dashboard use the gym's time zone and week start.
"""

from django.http import Http404
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.views.decorators.http import require_POST

from apps import hx
from apps.accounts.access import coach_required

from . import alerts, summary
from .models import Notification, NotificationKind

FEED_ICONS = {
    NotificationKind.ISSUE: "alert",
    NotificationKind.MESSAGE: "msg",
    NotificationKind.PR: "trophy",
    NotificationKind.PROGRAM_ENDING: "cal",
    NotificationKind.METRICS_MISSING: "user",
    NotificationKind.MISSED: "cal",
    NotificationKind.VIDEO: "video",
}
FEED_CLASS = {
    NotificationKind.ISSUE: "issue",
    NotificationKind.MESSAGE: "msg",
    NotificationKind.PROGRAM_ENDING: "prog",
    NotificationKind.PR: "pr",
    NotificationKind.METRICS_MISSING: "metrics",
    NotificationKind.MISSED: "missed",
    NotificationKind.VIDEO: "video",
}


RING = {"good": "var(--good)", "ok": "var(--warn)", "low": "var(--bad)"}


def _decorate(row):
    row.icon, row.cls = FEED_ICONS.get(row.kind, "bell"), FEED_CLASS.get(row.kind, "prog")
    return row


def _roster_rows(athletes, feed_rows):
    rows = summary.roster_rows(athletes, feed_rows)
    for r in rows:
        r["ring"] = RING[r["band"]]
        r["alerts"] = [{"row": x, "icon": _decorate(x).icon, "cls": x.cls} for x in r["alert_rows"]]
    return rows


def feed_context(request):
    rows = list(alerts.feed(request.coach))
    for r in rows:
        _decorate(r).href = alerts.link_for(r)
    return {
        "feed": rows,
        "unread": sum(1 for r in rows if r.read_at is None),
        "has_read": any(r.read_at for r in rows),
    }


@coach_required
def dashboard(request):
    coach = request.coach
    alerts.sync_coach(coach)
    athletes = summary.active_athletes(coach)
    sort = request.GET.get("sort", "attention")
    feed = feed_context(request)
    rows = summary.sort_rows(_roster_rows(athletes, feed["feed"]), sort)
    context = {"panel": "dashboard", "title": "Dashboard", "rows": rows, "sort": sort, "sorts": summary.SORTS}
    if request.htmx and request.htmx.target == "rosterBody":
        return TemplateResponse(request, "coach/_roster_rows.html", context)
    today = coach.gym.today()
    context.update(
        {
            **feed,
            "kpis": summary.kpis(coach, athletes),
            "today": today,
            "today_list": summary.today_list(athletes, today),
            "recent": summary.recent_sessions(athletes, today),
            "missing_count": summary.missing_metrics_count(athletes),
        }
    )
    return TemplateResponse(request, "coach/dashboard.html", context)


def _feed_response(request, message=None):
    response = TemplateResponse(request, "coach/_feed.html", feed_context(request))
    return hx.toast(response, message) if message else response


@coach_required
def feed(request):
    """Polled every 20 seconds; also redraws the sidebar count out of band."""
    return _feed_response(request)


@coach_required
@require_POST
def dismiss(request, pk):
    try:
        alerts.dismiss(request.user, pk)
    except Notification.DoesNotExist as err:
        raise Http404 from err
    return _feed_response(request)


@coach_required
@require_POST
def clear_read(request):
    n = alerts.clear_read(request.coach)
    return _feed_response(
        request, f"Cleared {n} read item{'s' if n != 1 else ''}" if n else "Nothing read to clear"
    )


@coach_required
@require_POST
def resolve_issue(request, pk, issue_id):
    from apps.accounts.coach_views import coach_athlete
    from apps.workouts.models import IssueReport

    athlete = coach_athlete(request, pk)
    issue = get_object_or_404(IssueReport, pk=issue_id, athlete=athlete)
    from apps.workouts import issues

    issues.resolve(issue)
    response = TemplateResponse(
        request, "coach/athlete/_issue_note.html", {"issue": issue, "athlete": athlete}
    )
    return hx.toast(response, "Issue marked resolved", "good")
