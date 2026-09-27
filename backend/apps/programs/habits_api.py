"""An athlete's habits, as their coach sees and sets them (/api/v1/athletes/{id}/habits).
Athletes tick them off on their phone through sync (sub-project 3)."""

import datetime
import uuid

from ninja import Router, Schema, Status

from apps.accounts import coaching
from apps.api.main import coach_of
from apps.core import errors

from . import habits

router = Router(tags=["Habits"])


class DayDone(Schema):
    date: datetime.date
    done: bool


class HabitOut(Schema):
    id: uuid.UUID
    name: str
    emoji: str
    cadence: str
    note: str
    streak: int
    last_seven: list[DayDone]


class HabitIn(Schema):
    name: str
    emoji: str = habits.EMOJI[0]
    cadence: str = "daily"
    note: str = ""


def _athlete(request, athlete_id):
    return coaching.athlete_for(coach_of(request), athlete_id)


def _habit(h, today):
    return {
        "id": h.pk,
        "name": h.name,
        "emoji": h.emoji,
        "cadence": h.cadence,
        "note": h.note,
        "streak": habits.streak(h, today),
        "last_seven": [{"date": d, "done": done} for d, done in habits.last_seven(h, today)],
    }


@router.get("/athletes/{athlete_id}/habits", response=list[HabitOut])
def athlete_habits(request, athlete_id: uuid.UUID):
    athlete = _athlete(request, athlete_id)
    return [_habit(h, athlete.today()) for h in habits.active(athlete)]


@router.post("/athletes/{athlete_id}/habits", response={201: HabitOut})
def prescribe(request, athlete_id: uuid.UUID, data: HabitIn):
    athlete = _athlete(request, athlete_id)
    habit = habits.prescribe(athlete, data.name, data.emoji, data.cadence, data.note)
    if habit is None:
        raise errors.Conflict("They already have a habit with that name.")
    return Status(201, _habit(habit, athlete.today()))


@router.post("/athletes/{athlete_id}/habits/{habit_id}/archive", response={204: None})
def archive(request, athlete_id: uuid.UUID, habit_id: uuid.UUID):
    athlete = _athlete(request, athlete_id)
    habits.archive(habits.active(athlete).get(pk=habit_id))
    return Status(204, None)
