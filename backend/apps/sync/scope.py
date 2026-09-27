"""What an athlete's phone holds, table by table, and how each row is sent. Every row the
phone gets passes through `visible()`: the same rules as the API, so a draft week never
syncs and another athlete's row never does.

- ATHLETE: the athlete's own data (their training, program, habits, questions, messages).
  Program rows only while their week is published in the active program.
- LIBRARY: their gym's shared library. Templates stay coach-only.
"""

import datetime
import decimal
import functools
import uuid

from django.apps import apps

_PUBLISHED = {"program__active": True, "published": True}


def _under(prefix):
    return {f"{prefix}__{k}": v for k, v in _PUBLISHED.items()}


ATHLETE = {
    "accounts.BodyweightEntry": {},
    "accounts.MaxEntry": {},
    "accounts.Coaching": {},
    "programs.Program": {"active": True},
    "programs.ProgramWeek": _PUBLISHED,
    "programs.ProgramDay": _under("week"),
    "programs.ProgramSession": _under("day__week"),
    "programs.Prescription": _under("session__day__week"),
    "programs.PrescribedSet": _under("prescription__session__day__week"),
    "programs.PrescriptionTag": _under("prescription__session__day__week"),
    "programs.Habit": {},
    "programs.HabitLog": {},
    "workouts.CheckinQuestion": {},
    "workouts.SessionLog": {},
    "workouts.SessionExercise": {},
    "workouts.SetLog": {},
    "workouts.CheckinAnswer": {},
    "workouts.IssueReport": {},
    "workouts.FormVideo": {},
    "messaging.Thread": {},
    "messaging.Message": {},
}

LIBRARY = {
    "exercises.Category": {},
    "exercises.Tag": {},
    "exercises.Exercise": {},
    "exercises.ExerciseTag": {},
    "exercises.TrackedLift": {},
    "programs.WeekType": {},
}

# Fields a phone never needs.
HIDDEN = {"workouts.FormVideo": {"key"}}


def model(label):
    return apps.get_model(label)


def table_of(label):
    return model(label)._meta.db_table


@functools.cache
def _labels():
    return {table_of(label): label for label in [*ATHLETE, *LIBRARY]}


def label_for(table):
    """The model label for a change-log table name; None for tables phones don't get."""
    return _labels().get(table)


def visible(label, athlete, gym):
    """The rows of `label` this athlete's phone may hold."""
    rows = model(label)._base_manager.all()
    if label in ATHLETE:
        return rows.filter(athlete=athlete, **ATHLETE[label])
    if label in LIBRARY:
        return rows.filter(gym=gym, **LIBRARY[label]) if gym else rows.none()
    return rows.none()


def _value(value):
    if isinstance(value, uuid.UUID | decimal.Decimal):
        return str(value)
    if isinstance(value, datetime.date | datetime.datetime):
        return value.isoformat()
    return value


def fields(label):
    """The columns a phone gets for `label`: every concrete field but the hidden ones. The
    phone's tables are generated from the same list (schema.py)."""
    hidden = HIDDEN.get(label, set())
    return [f for f in model(label)._meta.concrete_fields if f.name not in hidden and f.attname not in hidden]


def serialize(label, obj):
    """A row as the phone stores it: every column (foreign keys as `<name>_id`), ids and
    decimals as strings, dates and times in ISO 8601."""
    return {f.attname: _value(getattr(obj, f.attname)) for f in fields(label)}
