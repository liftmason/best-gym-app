"""The actions a phone pushes (docs/EXPO_MIGRATION.md, "Push"). Each checks its payload and
calls the same service as the API, with the ids the phone chose, and returns what the phone
needs to know (usually the ids the server kept). Everything is looked up through the athlete,
so another athlete's id is "not found".

To add one: a Schema for its payload and a function (athlete, data, day) -> dict, in ACTIONS.
`day` is the athlete's date when they did it (from the action's time), for rules about
"today".
"""

import datetime
import uuid

from ninja import Schema

from apps import ratelimit
from apps.accounts import metrics
from apps.accounts.models import MeasurementSource
from apps.core import errors
from apps.messaging import services as messaging
from apps.programs import habits
from apps.workouts import checkins, form_videos, issues, sessions
from apps.workouts.models import CheckinQuestion, FormVideo, SessionExercise, SessionLog


def _log(athlete, log_id):
    return SessionLog.objects.get(pk=log_id, athlete=athlete)


def _exercise(athlete, se_id):
    return SessionExercise.objects.select_related("session_log").get(pk=se_id, session_log__athlete=athlete)


class StartExercise(Schema):
    id: uuid.UUID
    prescription_id: uuid.UUID


class SessionStart(Schema):
    session_log_id: uuid.UUID
    program_session_id: uuid.UUID
    exercises: list[StartExercise] = []


def session_start(athlete, data, day):
    ids = {str(e.prescription_id): e.id for e in data.exercises}
    log = sessions.start_planned(athlete, data.program_session_id, data.session_log_id, ids)
    # Started on another device first: these are the ids the server kept.
    return {
        "session_log_id": str(log.pk),
        "exercises": {
            str(se.prescription_id): str(se.pk) for se in log.exercises.all() if se.prescription_id
        },
    }


class SetSave(Schema):
    set_id: uuid.UUID
    session_exercise_id: uuid.UUID
    set_number: int
    load_kg: str | None = None
    reps: int | None = None
    duration_seconds: int | None = None
    rir: int | None = None
    done: bool = False


def set_save(athlete, data, day):
    se = _exercise(athlete, data.session_exercise_id)
    row = sessions.log_set(
        se,
        data.set_number,
        load=data.load_kg,
        reps=data.reps,
        time=data.duration_seconds,
        time_unit="s",
        rir=data.rir,
        done=data.done,
        unit="kg",
        set_id=data.set_id,
    )
    return {"set_id": str(row.pk)}


class WarmupTick(Schema):
    session_exercise_id: uuid.UUID
    checked: bool


def warmup_tick(athlete, data, day):
    sessions.check_warmup(_exercise(athlete, data.session_exercise_id), data.checked)
    return {}


class CheckinAnswer(Schema):
    answer_id: uuid.UUID
    session_log_id: uuid.UUID
    question_id: uuid.UUID
    value: str = ""
    other: str = ""


def checkin_answer(athlete, data, day):
    question = CheckinQuestion.objects.get(pk=data.question_id, athlete=athlete)
    row = checkins.answer(
        _log(athlete, data.session_log_id), question, data.value, data.other, data.answer_id
    )
    return {"answer_id": str(row.pk)}


class CheckinFinish(Schema):
    session_log_id: uuid.UUID
    skip: bool = False


def checkin_finish(athlete, data, day):
    checkins.finish(_log(athlete, data.session_log_id), skip=data.skip)
    return {}


class SessionFinish(Schema):
    session_log_id: uuid.UUID
    rpe: int
    comment: str = ""


def session_finish(athlete, data, day):
    sessions.finish(_log(athlete, data.session_log_id), data.rpe, data.comment)
    return {}


class HabitSet(Schema):
    habit_id: uuid.UUID
    date: datetime.date
    done: bool


def habit_set(athlete, data, day):
    habit = habits.active(athlete).get(pk=data.habit_id)
    habits.set_done(habit, data.date, data.done, today=day)
    return {}


class IssueReport(Schema):
    issue_id: uuid.UUID
    session_log_id: uuid.UUID
    kind: str
    text: str = ""


ISSUE_LIMIT = (10, 60 * 60)  # per athlete: each report alerts the coach (audit M23)


def issue_report(athlete, data, day):
    log = _log(athlete, data.session_log_id)
    if not ratelimit.hit("issues", athlete.pk, *ISSUE_LIMIT):
        raise errors.TooMany("That's a lot of reports at once. Message your coach instead.")
    return {"issue_id": str(issues.report(log, data.kind, data.text, data.issue_id).pk)}


class MessageSend(Schema):
    message_id: uuid.UUID
    body: str


def message_send(athlete, data, day):
    if not ratelimit.hit("messages", athlete.user_id, 30, 60):
        raise errors.TooMany()
    thread = messaging.thread_for(athlete)
    return {"message_id": str(messaging.send(thread, athlete.user, data.body, data.message_id).pk)}


class MetricsUpdate(Schema):
    values: dict[str, str]  # metric key -> value, weights in the athlete's unit
    date: datetime.date | None = None


def metrics_update(athlete, data, day):
    """The athlete's own numbers: weights as new dated entries (the last one wins), height
    and years replaced."""
    cleaned = metrics.validate(athlete.gym, data.values)
    date = data.date or day
    if date > day:
        raise errors.Invalid({"date": "That date is in the future."})
    metrics.save_metrics(athlete, cleaned, source=MeasurementSource.ATHLETE, date=date)
    return {"saved": sorted(k for k, v in cleaned.items() if v not in (None, ""))}


class VideoAttach(Schema):
    video_id: uuid.UUID


def video_attach(athlete, data, day):
    """The phone finished uploading a video (started online with POST .../videos)."""
    form_videos.confirm(FormVideo.objects.get(pk=data.video_id, session_log__athlete=athlete))
    return {}


def started_ids(payload, result):
    """{phone's id: server's id} when a session was already started on another device: the
    log, and each exercise by its prescription."""
    ids = {str(payload.get("session_log_id")): result["session_log_id"]}
    kept = result.get("exercises") or {}
    for e in payload.get("exercises") or []:
        server = kept.get(str(e.get("prescription_id")))
        if server:
            ids[str(e.get("id"))] = server
    return {phone: server for phone, server in ids.items() if phone != server}


# Actions whose result can name different ids than the phone chose; later actions in the
# same batch are rewritten to use them (push.py), as the phone does with its outbox.
ALIASES = {"session.start": started_ids}

ACTIONS = {
    "session.start": (SessionStart, session_start),
    "set.save": (SetSave, set_save),
    "warmup.tick": (WarmupTick, warmup_tick),
    "checkin.answer": (CheckinAnswer, checkin_answer),
    "checkin.finish": (CheckinFinish, checkin_finish),
    "session.finish": (SessionFinish, session_finish),
    "habit.set": (HabitSet, habit_set),
    "issue.report": (IssueReport, issue_report),
    "message.send": (MessageSend, message_send),
    "metrics.update": (MetricsUpdate, metrics_update),
    "video.attach": (VideoAttach, video_attach),
}
