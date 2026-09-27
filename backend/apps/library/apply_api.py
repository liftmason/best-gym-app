"""Applying a template or saved week to an athlete (/api/v1/athletes/{id}/apply). The preview
is stateless: the app sends its choices each time and gets back exactly what confirming
would write (`apply.plan` is the same dry run for both). The rules are in apply.py."""

import datetime
import uuid

from ninja import Router, Schema, Status

from apps.accounts import coaching
from apps.api.main import programmer_of
from apps.api.schemas import WeekTypeRef, week_type_ref
from apps.programs import prescriptions

from . import apply

router = Router(tags=["Apply a template"])


class Source(Schema):
    id: uuid.UUID
    kind: str  # program, week
    name: str


class Choices(Schema):
    template_id: uuid.UUID
    days: list[int] | None = None  # training days, 0-6 from the week start; default: the template's
    mode: str = apply.RECENT  # "recent": tag slots become the athlete's latest lift; "default"
    start: str = ""  # a placement's value; default: the first on offer
    publish: bool = False


class Placement(Schema):
    value: str
    label: str


class PlannedExercise(Schema):
    exercise: str
    tag_slot: bool
    summary: str


class PlannedDay(Schema):
    offset: int
    date: datetime.date
    session: str
    exercises: list[PlannedExercise]


class PlannedWeek(Schema):
    label: str
    start: datetime.date
    week_type: WeekTypeRef | None
    days: list[PlannedDay]


class Summary(Schema):
    weeks: int
    sessions: int
    tag_slots: int
    habits: int
    replaced: int
    moved: int
    new_program: bool


class Preview(Schema):
    choices: Choices  # with the defaults filled in
    placements: list[Placement]
    weeks: list[PlannedWeek]
    summary: Summary


class Applied(Schema):
    program_id: uuid.UUID
    first_week_id: uuid.UUID
    habits_added: int


def _athlete(request, athlete_id):
    coach = programmer_of(request)
    return coach, coaching.athlete_for(coach, athlete_id)


def _source(coach, template_id):
    return apply.sources(coach.gym).get(pk=template_id)


@router.get("/athletes/{athlete_id}/apply/sources", response=list[Source])
def sources(request, athlete_id: uuid.UUID):
    """What can be applied: the gym's templates and saved weeks."""
    coach, _athlete_ = _athlete(request, athlete_id)
    return [{"id": t.pk, "kind": t.kind, "name": t.display_name} for t in apply.sources(coach.gym)]


@router.post("/athletes/{athlete_id}/apply/preview", response=Preview)
def preview(request, athlete_id: uuid.UUID, data: Choices):
    """What applying would add, week by week, and where it could go. Writes nothing."""
    coach, athlete = _athlete(request, athlete_id)
    template = _source(coach, data.template_id)
    draft = apply.new_draft(template, athlete)
    draft = apply.update_draft(
        draft, athlete, days=data.days, mode=data.mode, start=data.start, publish=data.publish
    )
    shown = apply.preview(template, athlete, draft)
    unit = coach.gym.units
    weeks = []
    for ghost in shown["ghosts"]:
        planned = ghost["planned"]
        days = []
        for offset, session in sorted(planned.days.items()):
            days.append(
                {
                    "offset": offset,
                    "date": ghost["start"] + datetime.timedelta(days=offset),
                    "session": session.source.name,
                    "exercises": [
                        {
                            "exercise": exercise.name,
                            "tag_slot": slot.is_tag,
                            "summary": prescriptions.summary(slot, unit, list(slot.set_overrides.all())),
                        }
                        for slot, exercise in session.exercises
                    ],
                }
            )
        weeks.append(
            {
                "label": ghost["label"],
                "start": ghost["start"],
                "week_type": week_type_ref(planned.week_type),
                "days": days,
            }
        )
    return {
        "choices": {
            "template_id": template.pk,
            "days": draft["days"],
            "mode": draft["mode"],
            "start": shown["placement"].value,
            "publish": draft["publish"],
        },
        "placements": [{"value": p.value, "label": p.label} for p in apply.placements(athlete)],
        "weeks": weeks,
        "summary": shown["summary"],
    }


@router.post("/athletes/{athlete_id}/apply", response={201: Applied})
def confirm(request, athlete_id: uuid.UUID, data: Choices):
    """Write the planned weeks. 409 if the chosen start isn't on offer any more (preview
    again) or the weeks it would move have logged sessions."""
    coach, athlete = _athlete(request, athlete_id)
    template = _source(coach, data.template_id)
    days = data.days if data.days is not None else apply.default_days(template)
    start = data.start or apply.placements(athlete)[0].value
    program, first, added = apply.confirm(
        athlete, template, days, data.mode, start, data.publish, request.user
    )
    return Status(201, {"program_id": program.pk, "first_week_id": first.pk, "habits_added": added})
