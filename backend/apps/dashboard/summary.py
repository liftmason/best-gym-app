"""What the coach dashboard shows, read-only: the roster rows (compliance, readiness, the
athlete's unread alerts), sort orders, the KPIs, today's sessions and recent sessions.
"Today" and "this week" use the gym's time zone and week start. The view (and later the
API) shows what these return; colours and icons are the page's business.
"""

import datetime
import zoneinfo

from django.utils import timezone

from apps.accounts import coaching
from apps.accounts.metrics import missing_metrics
from apps.workouts import history
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


def active_athletes(coach):
    return list(coaching.athletes_for(coach))


def pct(done, scheduled):
    return round(done / scheduled * 100) if scheduled else None


def compliance_band(value):
    """good (85%+ or nothing scheduled), ok (70%+) or low."""
    if value is None or value >= GOOD_COMPLIANCE:
        return "good"
    return "ok" if value >= OK_COMPLIANCE else "low"


def current_week(athlete, today):
    program = athlete.programs.active().first()
    if program is None:
        return None
    return (
        program.weeks.filter(start_date__lte=today, start_date__gt=today - datetime.timedelta(days=7))
        .select_related("week_type")
        .first()
    )


def readiness(log):
    """The first 1-10 answer of a session's check-in, or None."""
    if log is None:
        return None
    scale = next((x for x in log.answers.all() if x.type == "scale"), None)
    return scale.value if scale else None


def roster_rows(athletes, feed_rows):
    """One row per athlete: this week, compliance and its band, last session and readiness,
    and the athlete's unread feed rows."""
    by_athlete = {}
    for row in feed_rows:
        if row.read_at is None:
            by_athlete.setdefault(row.athlete_id, []).append(row)
    rows = []
    for a in athletes:
        today = a.today()
        done, scheduled = history.compliance(a, today)
        last = a.session_logs.finished().prefetch_related("answers").order_by("-date", "-finished_at").first()
        value = pct(done, scheduled)
        rows.append(
            {
                "athlete": a,
                "week": current_week(a, today),
                "compliance": value,
                "band": compliance_band(value),
                "last": last,
                "readiness": readiness(last),
                "alert_rows": by_athlete.get(a.pk, []),
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


def needs_programming(athlete):
    """No program, no sessions in it, or it runs out within PROGRAM_WARNING_DAYS."""
    program, last = alerts.program_end_date(athlete)
    return program is None or last is None or (last - athlete.today()).days < alerts.PROGRAM_WARNING_DAYS


def kpis(coach, athletes):
    """The four KPI cards: active athletes (and how many joined this month), compliance
    against last week, sessions so far this week against the same point last week, and how
    many athletes need programming."""
    gym = coach.gym
    today = gym.today()
    month_start = today.replace(day=1)
    zone = zoneinfo.ZoneInfo(gym.timezone)
    joined = sum(1 for a in athletes if timezone.localdate(a.joined_at, zone) >= month_start)
    done = scheduled = prev_done = prev_scheduled = 0
    for a in athletes:
        d, s = history.compliance(a, a.today())
        pd, ps = history.compliance(a, a.today(), end=a.today() - datetime.timedelta(days=7))
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
        date__gte=week_start - datetime.timedelta(days=7),
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
        "need_programming": sum(1 for a in athletes if needs_programming(a)),
    }


def today_list(athletes, today):
    """Each athlete's planned session today (published weeks of the active program): how many
    exercises (warm-up drills aside) and whether it's done."""
    from apps.programs.models import ProgramDay

    done_ids = set(
        SessionLog.objects.finished()
        .filter(athlete__in=athletes, program_session__isnull=False)
        .values_list("program_session_id", flat=True)
    )
    days = {
        d.week.program.athlete_id: d
        for d in ProgramDay.objects.filter(
            week__program__athlete__in=athletes, week__program__active=True, week__published=True, date=today
        )
        .select_related("week__program")
        .prefetch_related("sessions__prescriptions")
    }
    items = []
    for a in athletes:
        day = days.get(a.pk)
        day_sessions = list(day.sessions.all()) if day else []
        count = sum(1 for s in day_sessions for rx in s.prescriptions.all() if not rx.warmup)
        items.append({"athlete": a, "count": count, "done": any(s.pk in done_ids for s in day_sessions)})
    return items


def recent_sessions(athletes, today):
    return (
        SessionLog.objects.finished()
        .filter(athlete__in=athletes, date__gte=today - datetime.timedelta(days=RECENT_DAYS))
        .select_related("athlete__user")
        .prefetch_related("issues")
        .order_by("-date", "-finished_at")[:RECENT_LIMIT]
    )


def missing_metrics_count(athletes):
    return sum(1 for a in athletes if missing_metrics(a))
