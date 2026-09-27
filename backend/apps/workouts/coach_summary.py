"""What the coach's Sessions and Overview tabs show for one athlete, read-only: each logged
session's asked-for-versus-done summary, recent check-ins, this week at a glance, and PRs.
The views (and later the API) show what these return."""

import datetime

from django.db.models import Q

from apps.programs.prescriptions import summary

from . import charts, history, sessions
from .models import QuestionType

RANGES = [("4", "Last 4 weeks", 28), ("8", "Last 8 weeks", 56), ("all", "All time", None)]


def asked_text(se, unit):
    p = sessions.prescribed(se)
    if p is None:
        return "not on the program"
    text = summary(p, unit, p.overrides)
    kg = sessions.target_kg(p, p.load_value)
    if kg and not p.overrides and p.load_basis == "percent":
        text += f" (≈ {sessions.plate_round(kg, unit)} {unit})"
    return text


def exercise_line(se, unit, pr_ids):
    done = [s for s in se.sets.all() if s.done]
    entry = history.Entry(
        se.session_log.date, se.session_log_id, se.pk, se.exercise_id, se.exercise_name, sets=done
    )
    e1rm = entry.best_e1rm
    return {
        "name": se.exercise_name,
        "deleted": se.exercise_id is None,
        "asked": asked_text(se, unit),
        "did": history.sets_text(done, unit),
        "e1rm": history.e1rm_text(e1rm, unit) if e1rm else "",
        "pr": se.pk in pr_ids,
        "planned": sessions.planned_sets(se),
        "done_count": len(done),
    }


def session_item(log, unit, pr_ids):
    logged = list(log.exercises.all())
    exercises = [exercise_line(se, unit, pr_ids) for se in logged if not se.warmup]
    drills = [se for se in logged if se.warmup]
    answers = list(log.answers.all())
    scale = next((a for a in answers if a.type == QuestionType.SCALE), None)
    issues = list(log.issues.all())
    form_videos = [v for v in log.videos.all() if v.uploaded_at]
    rpe = log.session_rpe
    return {
        "log": log,
        "exercises": exercises,
        "warmup": {"done": sum(1 for se in drills if se.checked_at), "total": len(drills)}
        if drills
        else None,
        "answers": answers,
        "readiness": scale.value if scale else None,
        "issues": issues,
        "videos": form_videos,
        "pr_day": any(e["pr"] for e in exercises),
        "rpe_class": "" if rpe is None else "hi" if rpe >= 9 else "mid" if rpe >= 7 else "lo",
        "status": "partial" if issues or not log.finished else "done",
    }


RANGE_DAYS = {key: days for key, _label, days in RANGES}
OPEN_DAYS = 3  # sessions from the last three days start expanded


def session_list(athlete, unit, q="", range_key="8"):
    """(items, range_key): the athlete's sessions in the range ("4", "8" weeks or "all"),
    newest first, optionally only those with an exercise matching `q`."""
    range_key = range_key if range_key in RANGE_DAYS else "8"
    days = RANGE_DAYS[range_key]
    logs = athlete.session_logs.select_related("week_type", "athlete__user").prefetch_related(
        "answers", "issues", "videos", "exercises__sets", "exercises__session_log"
    )
    if days:
        logs = logs.filter(date__gte=athlete.today() - datetime.timedelta(days=days))
    if q:
        logs = logs.filter(exercises__exercise_name__icontains=q).distinct()
    pr_ids = history.pr_session_exercises(athlete)
    today = athlete.today()
    items = [session_item(log, unit, pr_ids) for log in logs.order_by("-date", "-started_at")]
    for item in items:
        item["open"] = (today - item["log"].date).days < OPEN_DAYS
    return items, range_key


def chart_lift(athlete, lift_id):
    """(lifts, chosen): the lifts the e1RM chart offers and the one shown."""
    lifts = charts.chart_lifts(athlete)
    chosen = next((e for e in lifts if str(e.pk) == str(lift_id)), lifts[0] if lifts else None)
    return lifts, chosen


def recent_checkins(athlete, limit=5):
    """The last finished sessions with a check-in or an RPE: each with its first 1-10 answer
    and its multiple-choice answer."""
    logs = (
        athlete.session_logs.finished()
        .prefetch_related("answers")
        .filter(Q(answers__isnull=False) | Q(session_rpe__isnull=False))
        .distinct()
        .order_by("-date", "-finished_at")[:limit]
    )
    result = []
    for log in logs:
        answers = list(log.answers.all())
        result.append(
            {
                "log": log,
                "scale": next((a for a in answers if a.type == QuestionType.SCALE), None),
                "choice": next((a for a in answers if a.type == QuestionType.CHOICE), None),
            }
        )
    return result


def week_glance(athlete):
    """This training week, day by day: "rest", "✓ done" or "N ex" (warm-up drills aren't
    counted as exercises)."""
    from apps.programs.models import ProgramDay

    today = athlete.today()
    week_start = athlete.gym.week_start_for(today)
    done_ids = history.finished_session_ids(athlete)
    days = {
        d.date: d
        for d in ProgramDay.objects.filter(
            week__program__athlete=athlete,
            week__program__active=True,
            date__gte=week_start,
            date__lte=week_start + datetime.timedelta(days=6),
        ).prefetch_related("sessions__prescriptions")
    }
    glance = []
    for i in range(7):
        date = week_start + datetime.timedelta(days=i)
        day = days.get(date)
        day_sessions = list(day.sessions.all()) if day else []
        count = sum(1 for s in day_sessions for rx in s.prescriptions.all() if not rx.warmup)
        done = any(s.pk in done_ids for s in day_sessions)
        label = "rest" if not count else "✓ done" if done else f"{count} ex"
        glance.append({"date": date, "label": label, "today": date == today})
    return glance


def top_prs(athlete, unit, limit=6):
    """Lifetime PRs, the gym's tracked lifts first, then the most recent."""
    from apps.exercises.models import tracked_exercises

    today = athlete.today()
    tracked = {e.name: i for i, e in enumerate(tracked_exercises(athlete.gym))}
    ordered = sorted(history.lifetime_prs(athlete), key=lambda pr: tracked.get(pr["name"], len(tracked)))
    return [
        {
            "name": pr["name"],
            "heaviest": history.set_text(pr["heaviest"], unit),
            "ago": history.ago(pr["heaviest_date"], today),
        }
        for pr in ordered[:limit]
    ]
