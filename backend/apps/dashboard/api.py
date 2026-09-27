"""The coach dashboard (/api/v1/dashboard, /roster, /feed). Reads never write (audit M20):
alert conditions are synced by the hourly cron job, not when the dashboard opens (H4).
The feed is paginated and its rows say what they're about (kind, athlete, key), for the app
to route on, rather than links that cost a query each (H5)."""

import datetime
import uuid

from django.db.models import Q
from ninja import Router, Schema, Status

from apps.accounts import coaching
from apps.api.main import coach_of
from apps.api.pagination import page
from apps.api.schemas import AthleteRef, WeekTypeRef, athlete_ref, week_type_ref

from . import alerts, summary

router = Router(tags=["Dashboard"])


class Kpis(Schema):
    active: int
    joined: int
    compliance: int | None
    compliance_change: int
    compliance_dir: str
    sessions: int
    sessions_change: int
    sessions_dir: str
    need_programming: int


class TodayItem(Schema):
    athlete: AthleteRef
    count: int
    done: bool


class RecentSession(Schema):
    id: uuid.UUID
    athlete: AthleteRef
    date: datetime.date
    name: str
    rpe: int | None
    issues: int


class DashboardOut(Schema):
    kpis: Kpis
    today: list[TodayItem]
    recent: list[RecentSession]
    unread: int


@router.get("/dashboard", response=DashboardOut)
def dashboard(request):
    coach = coach_of(request)
    athletes = list(coaching.athletes_for(coach))
    loaded = summary.load(athletes, coach.gym)
    today = coach.gym.today()
    return {
        "kpis": summary.kpis(coach, athletes, loaded),
        "today": [
            {"athlete": athlete_ref(i["athlete"]), "count": i["count"], "done": i["done"]}
            for i in summary.today_list(athletes, today, loaded)
        ],
        "recent": [
            {
                "id": log.pk,
                "athlete": athlete_ref(log.athlete),
                "date": log.date,
                "name": log.name,
                "rpe": log.session_rpe,
                "issues": len(log.issues.all()),
            }
            for log in summary.recent_sessions(athletes, today)
        ],
        "unread": alerts.feed(coach).filter(read_at__isnull=True).count(),
    }


class WeekOut(Schema):
    id: uuid.UUID
    label: str
    week_type: WeekTypeRef | None


class LastSession(Schema):
    id: uuid.UUID
    date: datetime.date
    name: str


class RosterRow(Schema):
    athlete: AthleteRef
    email: str
    weight_class: str
    competition_name: str
    competition_date: datetime.date | None
    week: WeekOut | None
    compliance: int | None
    band: str
    last: LastSession | None
    readiness: str | None
    alerts: int
    top_alert: str | None
    missing_metrics: int


@router.get("/roster", response=list[RosterRow])
def roster(request, sort: str = "attention", q: str = ""):
    """The coach's athletes, sorted (attention, name, compliance, competition) and filtered
    by name or email."""
    coach = coach_of(request)
    athletes = coaching.athletes_for(coach)
    if q.strip():
        athletes = athletes.filter(Q(user__name__icontains=q.strip()) | Q(user__email__icontains=q.strip()))
    athletes = list(athletes)
    loaded = summary.load(athletes, coach.gym)
    feed_rows = list(alerts.feed(coach).filter(read_at__isnull=True).order_by("-created_at"))
    rows = summary.sort_rows(summary.roster_rows(athletes, feed_rows, loaded), sort)
    return [
        {
            "athlete": athlete_ref(r["athlete"]),
            "email": r["athlete"].user.email,
            "weight_class": r["athlete"].weight_class,
            "competition_name": r["athlete"].competition_name,
            "competition_date": r["athlete"].competition_date,
            "week": {
                "id": r["week"].pk,
                "label": r["week"].label,
                "week_type": week_type_ref(r["week"].week_type),
            }
            if r["week"]
            else None,
            "compliance": r["compliance"],
            "band": r["band"],
            "last": {"id": r["last"].pk, "date": r["last"].date, "name": r["last"].name}
            if r["last"]
            else None,
            "readiness": r["readiness"],
            "alerts": len(r["alert_rows"]),
            "top_alert": r["alert_rows"][0].text if r["alert_rows"] else None,
            "missing_metrics": r["missing_metrics"],
        }
        for r in rows
    ]


class FeedRow(Schema):
    id: uuid.UUID
    kind: str
    key: str
    athlete: AthleteRef | None
    text: str
    created_at: datetime.datetime
    read: bool


class FeedOut(Schema):
    items: list[FeedRow]
    next: str | None


@router.get("/feed", response=FeedOut)
def feed(request, before: str = "", limit: int = 50):
    """The attention feed, newest first. `next` is the cursor for the page after."""
    coach = coach_of(request)
    rows, cursor = page(alerts.feed(coach), before, limit)
    return {
        "items": [
            {
                "id": r.pk,
                "kind": r.kind,
                "key": r.dedupe_key,
                "athlete": athlete_ref(r.athlete) if r.athlete else None,
                "text": r.text,
                "created_at": r.created_at,
                "read": r.read_at is not None,
            }
            for r in rows
        ],
        "next": cursor,
    }


@router.post("/feed/{notification_id}/read", response={204: None})
def feed_read(request, notification_id: uuid.UUID):
    coach_of(request)
    alerts.dismiss(request.user, notification_id)
    return Status(204, None)


class Cleared(Schema):
    cleared: int


@router.post("/feed/clear-read", response=Cleared)
def feed_clear_read(request):
    return {"cleared": alerts.clear_read(coach_of(request))}
