"""What the coach dashboard shows, read-only: the roster rows (compliance, readiness, the
athlete's unread alerts), sort orders, the KPIs, today's sessions and recent sessions.
"Today" and "this week" use the gym's time zone and week start. The view (and later the
API) shows what these return; colours and icons are the page's business.
"""

import datetime
import zoneinfo

from django.utils import timezone

from apps.accounts import coaching
from apps.workouts.models import SessionLog

from . import alerts

SORTS = [
    ("attention", "Needs attention first"),
    ("name", "Name A–Z"),
    ("compliance", "Compliance low→high"),
    ("competition", "Next competition"),
]
GOOD_COMPLIANCE, OK_COMPLIANCE = 85, 70
RECENT_DAYS, RECENT_LIMIT = 7, 8
DAY = datetime.timedelta(days=1)


def active_athletes(coach):
    return list(coaching.athletes_for(coach))


def pct(done, scheduled):
    return round(done / scheduled * 100) if scheduled else None


def compliance_band(value):
    """good (85%+ or nothing scheduled), ok (70%+) or low."""
    if value is None or value >= GOOD_COMPLIANCE:
        return "good"
    return "ok" if value >= OK_COMPLIANCE else "low"


def load(athletes, gym=None):
    """Everything below reads from one batch.Loaded: a fixed number of queries for any
    number of athletes (audit H4, M17)."""
    from .batch import Loaded

    athletes = list(athletes)
    return Loaded(athletes, gym or (athletes[0].gym if athletes else None))


def readiness(log):
    """The first 1-10 answer of a session's check-in, or None."""
    if log is None:
        return None
    scale = next((x for x in log.answers.all() if x.type == "scale"), None)
    return scale.value if scale else None


def roster_rows(athletes, feed_rows, loaded=None):
    """One row per athlete: this week, compliance (the last 7 days) and its band, last
    session and readiness, and the athlete's unread feed rows."""
    loaded = loaded or load(athletes)
    by_athlete = {}
    for row in feed_rows:
        if row.read_at is None:
            by_athlete.setdefault(row.athlete_id, []).append(row)
    rows = []
    for a in loaded.athletes:
        today = loaded.today[a.pk]
        value = pct(*loaded.compliance(a, today - 6 * DAY, today))
        last = loaded.last_log(a)
        rows.append(
            {
                "athlete": a,
                "week": loaded.current_week(a),
                "compliance": value,
                "band": compliance_band(value),
                "last": last,
                "readiness": readiness(last),
                "alert_rows": by_athlete.get(a.pk, []),
                "missing_metrics": len(loaded.missing_metrics(a)),
            }
        )
    return rows


def sort_rows(rows, sort):
    if sort == "name":
        return sorted(rows, key=lambda r: (r["athlete"].user.name or r["athlete"].user.email).lower())
    if sort == "compliance":
        return sorted(rows, key=lambda r: (r["compliance"] is None, r["compliance"] or 0))
    if sort == "competition":
        far = datetime.date.max
        return sorted(rows, key=lambda r: r["athlete"].competition_date or far)
    return sorted(rows, key=lambda r: (-len(r["alert_rows"]), (r["athlete"].user.name or "").lower()))


def needs_programming(athlete, loaded=None):
    """No program, nothing published in it, or it runs out within PROGRAM_WARNING_DAYS."""
    if loaded is None:
        program, last = alerts.program_end_date(athlete)
        today = athlete.today()
    else:
        program, last = loaded.program_end(athlete)
        today = loaded.today[athlete.pk]
    return program is None or last is None or (last - today).days < alerts.PROGRAM_WARNING_DAYS


def kpis(coach, athletes, loaded=None):
    """The four KPI cards: active athletes (and how many joined this month), compliance
    against last week, sessions so far this week against the same point last week, and how
    many athletes need programming."""
    loaded = loaded or load(athletes, coach.gym)
    athletes = loaded.athletes
    gym = coach.gym
    today = gym.today()
    month_start = today.replace(day=1)
    zone = zoneinfo.ZoneInfo(gym.timezone)
    joined = sum(1 for a in athletes if timezone.localdate(a.joined_at, zone) >= month_start)
    done = scheduled = prev_done = prev_scheduled = 0
    for a in athletes:
        own = loaded.today[a.pk]
        d, s = loaded.compliance(a, own - 6 * DAY, own)
        pd, ps = loaded.compliance(a, own - 13 * DAY, own - 7 * DAY)
        done, scheduled, prev_done, prev_scheduled = (
            done + d,
            scheduled + s,
            prev_done + pd,
            prev_scheduled + ps,
        )
    week_start = gym.week_start_for(today)
    days_in = (today - week_start).days
    logs = SessionLog.objects.finished().filter(athlete__in=athletes)
    this_week = logs.filter(date__gte=week_start, date__lte=today).count()
    last_week = logs.filter(
        date__gte=week_start - 7 * DAY,
        date__lte=week_start - datetime.timedelta(days=7 - days_in),
    ).count()
    now, prev = pct(done, scheduled), pct(prev_done, prev_scheduled)
    compliance_delta = now - prev if now is not None and prev is not None else 0
    sessions_delta = this_week - last_week
    return {
        "active": len(athletes),
        "joined": joined,
        "compliance": now,
        "compliance_change": abs(compliance_delta),
        "compliance_dir": "up" if compliance_delta > 0 else "down",
        "sessions": this_week,
        "sessions_change": abs(sessions_delta),
        "sessions_dir": "up" if sessions_delta > 0 else "down",
        "need_programming": sum(1 for a in athletes if needs_programming(a, loaded)),
    }


def today_list(athletes, today, loaded=None):
    """Each athlete's planned session today (published weeks of the active program): how many
    exercises (warm-up drills aside) and whether it's done."""
    loaded = loaded or load(athletes)
    items = []
    for a in loaded.athletes:
        count, done = loaded.today_sessions(a)
        items.append({"athlete": a, "count": count, "done": done})
    return items


def recent_sessions(athletes, today):
    return (
        SessionLog.objects.finished()
        .filter(athlete__in=athletes, date__gte=today - datetime.timedelta(days=RECENT_DAYS))
        .select_related("athlete__user")
        .prefetch_related("issues")
        .order_by("-date", "-finished_at")[:RECENT_LIMIT]
    )
