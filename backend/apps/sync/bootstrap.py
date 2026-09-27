"""Bootstrap: a new device's first copy of its scope, and the cursor to pull from after."""

from apps.programs.habits import LOOKBACK as HABIT_LOOKBACK

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
# Tables whose rules look back further than HISTORY_DAYS: a habit streak counts 400 days.
LONGER = {"programs.HabitLog": HABIT_LOOKBACK.days}


def baselines(athlete, before):
    """Each exercise's best before the phone's history starts, so the PRs it works out from
    its 12 months still count everything: {exercise id: {name, heaviest_kg, heaviest_reps,
    heaviest_date, e1rm, e1rm_date}} (history.lifetime_prs, before `before`)."""
    from apps.workouts import history

    out = {}
    for pr in history.lifetime_prs(athlete, before=before, with_ids=True):
        top = pr["heaviest"]
        out[str(pr["exercise_id"])] = {
            "name": pr["name"],
            "heaviest_kg": format(top.load_kg, "f"),
            "heaviest_reps": top.reps,
            "heaviest_date": pr["heaviest_date"].isoformat(),
            "e1rm": format(pr["e1rm"], "f") if pr["e1rm"] else None,
            "e1rm_date": pr["e1rm_date"].isoformat() if pr["e1rm_date"] else None,
        }
    return out


def snapshot(athlete):
    """{tables: {table: [row, …]}, cursor, history_from, baselines}: the athlete's whole scope
    as of one moment, and the cursor to pull from after it.

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
                since = athlete.today() - datetime.timedelta(days=LONGER.get(label, HISTORY_DAYS))
                rows = rows.filter(**{f"{HISTORY[label]}__gte": since})
            tables[scope.table_of(label)] = [scope.serialize(label, obj) for obj in rows]
        best_before = baselines(athlete, history_from)
    cursor = {"lo": lo, "hi": None, "after": 0, "gym": str(gym.pk) if gym else None}
    return {
        "tables": tables,
        "cursor": encode(cursor),
        "history_from": history_from,
        "baselines": best_before,
    }


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
