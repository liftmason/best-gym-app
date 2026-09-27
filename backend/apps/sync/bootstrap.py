"""Bootstrap: a new device's first copy of its scope, and the cursor to pull from after."""

from . import scope


def library_rows(gym):
    """Every library row of the gym, as pull sends them (the phone replaces its library)."""
    if gym is None:
        return []
    out = []
    for label in scope.LIBRARY:
        for obj in scope.visible(label, None, gym):
            out.append(
                {
                    "table": scope.table_of(label),
                    "id": str(obj.pk),
                    "op": "upsert",
                    "row": scope.serialize(label, obj),
                }
            )
    return out


HISTORY_DAYS = 365
# Where each dated table's date is; rows older than HISTORY_DAYS stay off a new phone
# (GET /me/history pages through them online). Maxes and bodyweights all come: they're few,
# and the current max may be older than a year.
HISTORY = {
    "workouts.SessionLog": "date",
    "workouts.SessionExercise": "session_log__date",
    "workouts.SetLog": "session_exercise__session_log__date",
    "workouts.CheckinAnswer": "session_log__date",
    "workouts.FormVideo": "session_log__date",
    "workouts.IssueReport": "created_at__date",
    "programs.HabitLog": "date",
    "messaging.Message": "sent_at__date",
}


def snapshot(athlete):
    """{tables: {table: [row, …]}, cursor, history_from}: the athlete's whole scope as of one
    moment, and the cursor to pull from after it.

    Read in one REPEATABLE READ transaction, so every table is from the same snapshot. The
    cursor starts at that snapshot's oldest running transaction: anything not in the copy is
    in a transaction at or after it, so the first pull brings it (and may resend a few rows
    that were already in the copy, which the phone simply overwrites)."""
    import datetime

    from django.db import connection, transaction

    from .pull import encode

    gym = athlete.gym
    history_from = athlete.today() - datetime.timedelta(days=HISTORY_DAYS)
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            cursor.execute("SELECT pg_snapshot_xmin(pg_current_snapshot())::text::bigint")
            lo = cursor.fetchone()[0]
        tables = {}
        for label in [*scope.ATHLETE, *scope.LIBRARY]:
            rows = scope.visible(label, athlete, gym)
            if label in HISTORY:
                rows = rows.filter(**{f"{HISTORY[label]}__gte": history_from})
            tables[scope.table_of(label)] = [scope.serialize(label, obj) for obj in rows]
    cursor = {"lo": lo, "hi": None, "after": 0, "gym": str(gym.pk) if gym else None}
    return {"tables": tables, "cursor": encode(cursor), "history_from": history_from}


def older_sessions(athlete, before="", limit=20):
    """(tables, next cursor): sessions from before the phone's 12 months, newest first, with
    everything under them, as pull and bootstrap send rows."""
    import datetime

    from apps.api.pagination import page
    from apps.workouts.models import CheckinAnswer, FormVideo, SessionExercise, SessionLog, SetLog

    cutoff = athlete.today() - datetime.timedelta(days=HISTORY_DAYS)
    logs, cursor = page(
        SessionLog.objects.filter(athlete=athlete, date__lt=cutoff), before, limit, field="started_at"
    )
    ids = [log.pk for log in logs]
    parts = {
        "workouts.SessionLog": logs,
        "workouts.SessionExercise": SessionExercise.objects.filter(session_log__in=ids),
        "workouts.SetLog": SetLog.objects.filter(session_exercise__session_log__in=ids),
        "workouts.CheckinAnswer": CheckinAnswer.objects.filter(session_log__in=ids),
        "workouts.FormVideo": FormVideo.objects.filter(session_log__in=ids),
    }
    return {
        scope.table_of(label): [scope.serialize(label, obj) for obj in rows] for label, rows in parts.items()
    }, cursor
