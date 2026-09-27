"""A coach's view of one athlete's training: the overview, the sessions they logged, PRs
waiting for a decision, form videos and issues. Weights are in the gym's unit. What the
coach sees starts at `coaching.visible_from` when the athlete hides earlier history."""

import datetime
import uuid

from ninja import Router, Schema, Status

from apps.accounts import coaching, units
from apps.api.main import coach_of
from apps.api.pagination import page
from apps.api.schemas import WeekTypeRef, week_type_ref

from . import charts, coach_summary, form_videos, history, issues, prs, videos
from .models import FormVideo, IssueReport

router = Router(tags=["Athletes"])


def _athlete(request, athlete_id):
    coach = coach_of(request)
    athlete = coaching.athlete_for(coach, athlete_id)
    return coach, athlete, coaching.visible_from(coach, athlete)


# ---------------------------------------------------------------- overview


class GlanceDay(Schema):
    date: datetime.date
    label: str  # "rest", "✓ done" or "N ex"
    today: bool


class Checkin(Schema):
    session_id: uuid.UUID
    date: datetime.date
    name: str
    readiness: str | None
    choice: str | None
    rpe: int | None


class TopPr(Schema):
    name: str
    heaviest: str
    ago: str


class Lift(Schema):
    id: uuid.UUID
    name: str


class Point(Schema):
    date: datetime.date
    e1rm: float  # in the gym's unit
    bodyweight: float | None
    week_type: WeekTypeRef | None


class Band(Schema):
    week_type: WeekTypeRef
    first: int
    last: int


class Change(Schema):
    change: float  # signed, in the gym's unit
    drop: float  # its size without the sign
    weeks: int


class Chart(Schema):
    lifts: list[Lift]
    lift: Lift | None
    points: list[Point]
    bands: list[Band]
    change: Change | None


class WeekRow(Schema):
    week_start: datetime.date
    volume: float  # in the gym's unit
    compliance: int | None


class OverviewOut(Schema):
    week: list[GlanceDay]
    checkins: list[Checkin]
    top_prs: list[TopPr]
    chart: Chart
    weekly: list[WeekRow]


def _in(unit, kg):
    return float(units.from_kg(kg, unit)) if kg is not None else None


@router.get("/athletes/{athlete_id}/overview", response=OverviewOut)
def overview(request, athlete_id: uuid.UUID, lift: str = ""):
    """This week at a glance, recent check-ins, lifetime PRs, the e1RM chart for `lift`
    (default: the first tracked lift), and weekly volume and compliance."""
    coach, athlete, since = _athlete(request, athlete_id)
    unit = coach.gym.units
    lifts, chosen = coach_summary.chart_lift(athlete, lift, since)
    points = charts.e1rm_points(athlete, chosen, since=since) if chosen else []
    change = charts.progress_change(athlete, chosen, unit, since) if chosen else None
    return {
        "week": coach_summary.week_glance(athlete),
        "checkins": [
            {
                "session_id": c["log"].pk,
                "date": c["log"].date,
                "name": c["log"].name,
                "readiness": c["scale"].value if c["scale"] else None,
                "choice": c["choice"].value if c["choice"] else None,
                "rpe": c["log"].session_rpe,
            }
            for c in coach_summary.recent_checkins(athlete, since=since)
        ],
        "top_prs": coach_summary.top_prs(athlete, unit, since=since),
        "chart": {
            "lifts": [{"id": e.pk, "name": e.name} for e in lifts],
            "lift": {"id": chosen.pk, "name": chosen.name} if chosen else None,
            "points": [
                {
                    "date": d,
                    "e1rm": _in(unit, kg),
                    "bodyweight": _in(unit, bw),
                    "week_type": week_type_ref(wt),
                }
                for d, kg, bw, wt in points
            ],
            "bands": [
                {"week_type": week_type_ref(wt), "first": first, "last": last}
                for wt, first, last in charts.phase_bands(points)
            ],
            "change": change,
        },
        "weekly": [
            {"week_start": start, "volume": _in(unit, kg), "compliance": pct}
            for start, kg, pct in charts.weekly(athlete, since=since)
        ],
    }


# ---------------------------------------------------------------- sessions


class ExerciseLine(Schema):
    name: str
    deleted: bool
    asked: str
    did: str
    e1rm: str
    pr: bool
    planned: int
    done_count: int


class Warmup(Schema):
    done: int
    total: int


class Answer(Schema):
    question: str
    type: str
    value: str
    other: str


class Issue(Schema):
    id: uuid.UUID
    kind: str
    text: str
    created_at: datetime.datetime
    resolved: bool


class Video(Schema):
    id: uuid.UUID
    exercise: str
    note: str
    created_at: datetime.datetime
    reviewed: bool
    feedback: str
    available: bool  # the file is kept for a while after upload, then deleted


class SessionOut(Schema):
    id: uuid.UUID
    date: datetime.date
    name: str
    week_type: WeekTypeRef | None
    finished: bool
    logged_late: bool
    rpe: int | None
    comment: str
    status: str  # done, partial
    readiness: str | None
    pr_day: bool
    warmup: Warmup | None
    exercises: list[ExerciseLine]
    answers: list[Answer]
    issues: list[Issue]
    videos: list[Video]


class SessionsOut(Schema):
    items: list[SessionOut]
    next: str | None


def _issue(i):
    return {
        "id": i.pk,
        "kind": i.kind,
        "text": i.text,
        "created_at": i.created_at,
        "resolved": bool(i.resolved_at),
    }


def _session(item):
    log = item["log"]
    return {
        "id": log.pk,
        "date": log.date,
        "name": log.name,
        "week_type": week_type_ref(log.week_type),
        "finished": log.finished,
        "logged_late": log.logged_late,
        "rpe": log.session_rpe,
        "comment": log.comment,
        "status": item["status"],
        "readiness": item["readiness"],
        "pr_day": item["pr_day"],
        "warmup": item["warmup"],
        "exercises": item["exercises"],
        "answers": [
            {"question": a.question_text, "type": a.type, "value": a.value, "other": a.other_text}
            for a in item["answers"]
        ],
        "issues": [_issue(i) for i in item["issues"]],
        "videos": [
            {
                "id": v.pk,
                "exercise": v.exercise_name,
                "note": v.note,
                "created_at": v.created_at,
                "reviewed": bool(v.reviewed_at),
                "feedback": v.feedback,
                "available": v.deleted_at is None,
            }
            for v in item["videos"]
        ],
    }


@router.get("/athletes/{athlete_id}/sessions", response=SessionsOut)
def sessions(
    request, athlete_id: uuid.UUID, range: str = "8", q: str = "", before: str = "", limit: int = 20
):
    """Logged sessions, newest first, a page at a time (audit H6): in the range ("4", "8"
    weeks or "all"), optionally only those with an exercise matching `q`."""
    coach, athlete, since = _athlete(request, athlete_id)
    logs, _range = coach_summary.session_logs(athlete, q, range, since)
    rows, cursor = page(logs, before, limit, field="started_at")
    pr_ids = history.pr_session_exercises(athlete, since)
    unit = coach.gym.units
    return {
        "items": [_session(coach_summary.session_item(log, unit, pr_ids)) for log in rows],
        "next": cursor,
    }


# ---------------------------------------------------------------- PRs, videos, issues


class PendingPr(Schema):
    set_id: uuid.UUID
    exercise: str
    lift: str  # the set, e.g. "105 kg ×1"
    date: datetime.date
    current_max: str


@router.get("/athletes/{athlete_id}/prs", response=list[PendingPr])
def pending_prs(request, athlete_id: uuid.UUID):
    """Session bests above a working max, waiting for the coach: use it, or keep the max."""
    coach, athlete, _since = _athlete(request, athlete_id)
    unit = coach.gym.units
    return [
        {
            "set_id": c.set_log.pk,
            "exercise": c.exercise.name,
            "lift": history.set_text(c.set_log, unit),
            "date": c.set_log.session_exercise.session_log.date,
            "current_max": units.display(c.current.kg, unit),
        }
        for c in prs.pending(athlete)
    ]


class Decision(Schema):
    use: bool


@router.post("/athletes/{athlete_id}/prs/{set_id}", response={204: None})
def decide_pr(request, athlete_id: uuid.UUID, set_id: uuid.UUID, data: Decision):
    _coach, athlete, _since = _athlete(request, athlete_id)
    prs.decide(athlete, set_id, data.use)
    return Status(204, None)


class VideoUrl(Schema):
    url: str
    expires_in: int


@router.get("/athletes/{athlete_id}/videos/{video_id}", response=VideoUrl)
def video_url(request, athlete_id: uuid.UUID, video_id: uuid.UUID):
    """A short-lived link to watch the video (the coach's desktop plays it in the page)."""
    _coach, athlete, _since = _athlete(request, athlete_id)
    video = FormVideo.objects.available().get(pk=video_id, session_log__athlete=athlete)
    return {"url": videos.view_url(video.key), "expires_in": videos.VIEW_SECONDS}


class Review(Schema):
    feedback: str = ""


@router.post("/athletes/{athlete_id}/videos/{video_id}/review", response={204: None})
def review_video(request, athlete_id: uuid.UUID, video_id: uuid.UUID, data: Review):
    """Mark reviewed; feedback goes to the athlete as a message."""
    _coach, athlete, _since = _athlete(request, athlete_id)
    video = FormVideo.objects.uploaded().get(pk=video_id, session_log__athlete=athlete)
    form_videos.review(video, request.user, data.feedback)
    return Status(204, None)


@router.get("/athletes/{athlete_id}/issues", response=list[Issue])
def open_issues(request, athlete_id: uuid.UUID):
    _coach, athlete, _since = _athlete(request, athlete_id)
    return [_issue(i) for i in IssueReport.objects.filter(athlete=athlete, resolved_at__isnull=True)]


@router.post("/athletes/{athlete_id}/issues/{issue_id}/resolve", response={204: None})
def resolve_issue(request, athlete_id: uuid.UUID, issue_id: uuid.UUID):
    _coach, athlete, _since = _athlete(request, athlete_id)
    issues.resolve(IssueReport.objects.get(pk=issue_id, athlete=athlete))
    return Status(204, None)
