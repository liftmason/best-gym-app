"""The gym's library of templates, saved weeks and saved sessions (/api/v1/templates), and
saving an athlete's board into it. Templates are shared by the gym's coaches, so they're
looked up within the coach's gym. The rules are in services.py; loads in the gym's unit."""

import datetime
import uuid

from ninja import Router, Schema, Status

from apps.accounts import coaching
from apps.api.main import programmer_of
from apps.api.schemas import WeekTypeRef, week_type_ref
from apps.core import errors
from apps.exercises.models import Exercise, Tag
from apps.programs import dose, prescriptions
from apps.programs import services as program_services
from apps.programs.board_api import Dose
from apps.programs.models import WeekType

from . import services
from .models import SlotKind, TemplateKind

router = Router(tags=["Templates"])


class Ref(Schema):
    id: uuid.UUID
    name: str


class Stats(Schema):
    weeks: int
    sessions: int
    slots: int
    tag_slots: int
    habits: int
    calendar_weeks: int


class Card(Schema):
    id: uuid.UUID
    kind: str  # program, week, session
    name: str
    description: str
    sessions_per_week: int
    stats: Stats
    exercises: list[str]  # a saved session's exercises ("[tag]" for a tag slot)
    used: int  # times applied
    updated_at: datetime.datetime


class Slot(Schema):
    id: uuid.UUID
    kind: str  # exercise, tag
    exercise: Ref  # the fixed exercise, or a tag slot's default
    tags: list[Ref]
    summary: str
    heading: str
    heading_note: str
    label: str
    warmup: bool


class TemplateSession(Schema):
    id: uuid.UUID
    name: str
    slots: list[Slot]


class TemplateWeek(Schema):
    id: uuid.UUID
    label: str
    week_type: WeekTypeRef
    focus_note: str
    sessions: list[TemplateSession]


class Habit(Schema):
    id: uuid.UUID
    name: str
    emoji: str
    cadence: str
    note: str


class Editor(Schema):
    id: uuid.UUID
    kind: str
    name: str
    description: str
    program_note: str
    sessions_per_week: int
    stats: Stats
    weeks: list[TemplateWeek]
    habits: list[Habit]


def _ref(obj):
    return {"id": obj.pk, "name": obj.name}


def _templates(gym):
    return services.Template.objects.filter(gym=gym).prefetch_related(
        "weeks__sessions__slots__tags", "weeks__sessions__slots__exercise", "habits", "applications"
    )


def _card(t):
    return {
        "id": t.pk,
        "kind": t.kind,
        "name": t.display_name,
        "description": t.description,
        "sessions_per_week": t.sessions_per_week,
        "stats": services.stats(t),
        "exercises": services.card_names(t) if t.kind == TemplateKind.SESSION else [],
        "used": len(t.applications.all()),
        "updated_at": t.updated_at,
    }


def _editor(template, unit):
    template = (
        _templates(template.gym).prefetch_related("weeks__sessions__slots__set_overrides").get(pk=template.pk)
    )
    weeks = []
    for w in template.weeks.all():
        sessions = []
        for s in w.sessions.all():
            items = prescriptions.board_items(
                s.slots.all(),
                lambda sl: {
                    "id": sl.pk,
                    "kind": sl.kind,
                    "exercise": _ref(sl.exercise),
                    "tags": [_ref(t) for t in sl.tags.all()],
                    "summary": prescriptions.summary(sl, unit, list(sl.set_overrides.all())),
                },
            )
            sessions.append({"id": s.pk, "name": s.name, "slots": items})
        weeks.append(
            {
                "id": w.pk,
                "label": f"Week {w.order + 1}",
                "week_type": week_type_ref(w.week_type),
                "focus_note": w.focus_note,
                "sessions": sessions,
            }
        )
    return {
        "id": template.pk,
        "kind": template.kind,
        "name": template.name,
        "description": template.description,
        "program_note": template.program_note,
        "sessions_per_week": template.sessions_per_week,
        "stats": services.stats(template),
        "weeks": weeks,
        "habits": [
            {"id": h.pk, "name": h.name, "emoji": h.emoji, "cadence": h.cadence, "note": h.note}
            for h in template.habits.all()
        ],
    }


def _template(request, template_id):
    coach = programmer_of(request)
    return coach, services.gym_template(coach.gym, template_id)


# ---------------------------------------------------------------- the library and templates


@router.get("/templates", response=list[Card])
def library(request, kind: str = ""):
    """The gym's templates, saved weeks and saved sessions (or one kind of them)."""
    templates = _templates(programmer_of(request).gym)
    if kind:
        templates = templates.filter(kind=kind)
    return [_card(t) for t in templates]


class NewTemplate(Schema):
    kind: str = "program"


@router.post("/templates", response={201: Editor})
def new_template(request, data: NewTemplate):
    coach = programmer_of(request)
    if data.kind not in TemplateKind.values:
        raise errors.Invalid({"kind": "A template, a saved week or a saved session."})
    return Status(201, _editor(services.new_template(coach.gym, data.kind, request.user), coach.gym.units))


@router.get("/templates/{template_id}", response=Editor)
def editor(request, template_id: uuid.UUID):
    coach, template = _template(request, template_id)
    return _editor(template, coach.gym.units)


class Meta(Schema):
    name: str | None = None
    description: str | None = None
    program_note: str | None = None
    sessions_per_week: int | None = None


@router.patch("/templates/{template_id}", response=Editor)
def update_meta(request, template_id: uuid.UUID, data: Meta):
    coach, template = _template(request, template_id)
    services.update_meta(template, **data.dict())
    return _editor(template, coach.gym.units)


@router.delete("/templates/{template_id}", response={204: None})
def delete_template(request, template_id: uuid.UUID):
    _coach, template = _template(request, template_id)
    services.delete_template(template)
    return Status(204, None)


# ---------------------------------------------------------------- weeks and sessions


class NewWeek(Schema):
    points: str = ""  # bump percentages in the copy, e.g. "2.5"


@router.post("/templates/{template_id}/weeks", response={201: Editor})
def add_week(request, template_id: uuid.UUID, data: NewWeek):
    """A new last week: a copy of the previous one, percentages bumped by `points`."""
    coach, template = _template(request, template_id)
    services.add_week(template, services.check_points(data.points))
    return Status(201, _editor(template, coach.gym.units))


@router.post("/templates/{template_id}/weeks/{template_week_id}/duplicate", response={201: Editor})
def duplicate_week(request, template_id: uuid.UUID, template_week_id: uuid.UUID):
    coach, template = _template(request, template_id)
    services.duplicate_week(services.template_week(template, template_week_id))
    return Status(201, _editor(template, coach.gym.units))


@router.delete("/templates/{template_id}/weeks/{template_week_id}", response=Editor)
def remove_week(request, template_id: uuid.UUID, template_week_id: uuid.UUID):
    coach, template = _template(request, template_id)
    services.remove_week(services.template_week(template, template_week_id))
    return _editor(template, coach.gym.units)


class WeekSettings(Schema):
    week_type_id: uuid.UUID | None = None
    focus_note: str | None = None


@router.patch("/templates/{template_id}/weeks/{template_week_id}", response=Editor)
def week_settings(request, template_id: uuid.UUID, template_week_id: uuid.UUID, data: WeekSettings):
    coach, template = _template(request, template_id)
    week = services.template_week(template, template_week_id)
    if data.week_type_id is not None:
        week_type = WeekType.objects.filter(gym=coach.gym, pk=data.week_type_id).first()
        if week_type is None:
            raise errors.Invalid({"week_type_id": "Pick one of your week types."})
        services.set_week_type(week, week_type)
    if data.focus_note is not None:
        services.set_focus_note(week, data.focus_note)
    return _editor(template, coach.gym.units)


class NewSession(Schema):
    name: str | None = None


@router.post("/templates/{template_id}/weeks/{template_week_id}/sessions", response={201: Editor})
def add_session(request, template_id: uuid.UUID, template_week_id: uuid.UUID, data: NewSession):
    coach, template = _template(request, template_id)
    services.add_session(services.template_week(template, template_week_id), data.name)
    return Status(201, _editor(template, coach.gym.units))


class SessionName(Schema):
    name: str


@router.patch("/templates/{template_id}/template-sessions/{template_session_id}", response=Editor)
def rename_session(request, template_id: uuid.UUID, template_session_id: uuid.UUID, data: SessionName):
    coach, template = _template(request, template_id)
    services.rename_session(services.template_session(template, template_session_id), data.name)
    return _editor(template, coach.gym.units)


@router.delete("/templates/{template_id}/template-sessions/{template_session_id}", response=Editor)
def remove_session(request, template_id: uuid.UUID, template_session_id: uuid.UUID):
    coach, template = _template(request, template_id)
    services.remove_session(services.template_session(template, template_session_id))
    return _editor(template, coach.gym.units)


# ---------------------------------------------------------------- slots


class NewSlot(Schema):
    exercise_id: uuid.UUID | None = None  # a fixed slot
    tag_ids: list[uuid.UUID] = []  # a tag slot: its default is the first exercise with them all
    index: int | None = None


def _gym_exercise(gym, exercise_id, field="exercise_id"):
    exercise = (
        Exercise.objects.filter(gym=gym, pk=exercise_id, archived=False).first() if exercise_id else None
    )
    if exercise is None:
        raise errors.Invalid({field: "Pick one of your exercises."})
    return exercise


def _gym_tags(gym, tag_ids):
    tags = list(Tag.objects.filter(gym=gym, pk__in=tag_ids))
    if len(tags) != len(set(tag_ids)):
        raise errors.Invalid({"tag_ids": "Pick from your own tags."})
    return tags


@router.post("/templates/{template_id}/template-sessions/{template_session_id}/slots", response={201: Editor})
def add_slot(request, template_id: uuid.UUID, template_session_id: uuid.UUID, data: NewSlot):
    coach, template = _template(request, template_id)
    session = services.template_session(template, template_session_id)
    if data.tag_ids:
        services.add_tag_slot(session, _gym_tags(coach.gym, data.tag_ids))
    else:
        services.add_slot(session, _gym_exercise(coach.gym, data.exercise_id), data.index)
    return Status(201, _editor(template, coach.gym.units))


class SlotOut(Schema):
    id: uuid.UUID
    kind: str
    exercise: Ref
    tags: list[Ref]
    dose: Dose
    summary: str


class SlotIn(Schema):
    kind: str  # exercise, tag
    exercise_id: uuid.UUID | None = None  # for a fixed slot
    default_id: uuid.UUID | None = None  # for a tag slot: an exercise with every tag
    tag_ids: list[uuid.UUID] = []
    dose: Dose | None = None


def _slot(slot, unit):
    return {
        "id": slot.pk,
        "kind": slot.kind,
        "exercise": _ref(slot.exercise),
        "tags": [_ref(t) for t in slot.tags.all()],
        "dose": dose.values(slot, unit),
        "summary": prescriptions.summary(slot, unit, list(slot.set_overrides.all())),
    }


@router.get("/templates/{template_id}/slots/{slot_id}", response=SlotOut)
def slot(request, template_id: uuid.UUID, slot_id: uuid.UUID):
    coach, template = _template(request, template_id)
    return _slot(services.template_slot(template, slot_id), coach.gym.units)


@router.put("/templates/{template_id}/slots/{slot_id}", response=SlotOut)
def edit_slot(request, template_id: uuid.UUID, slot_id: uuid.UUID, data: SlotIn):
    """Change what the slot is (a fixed exercise, or tags with a default) and its dose."""
    coach, template = _template(request, template_id)
    gym, unit = coach.gym, coach.gym.units
    slot = services.template_slot(template, slot_id)
    services.edit_slot(
        slot,
        kind=data.kind,
        exercise=_gym_exercise(gym, data.exercise_id) if data.kind == SlotKind.EXERCISE else None,
        default=_gym_exercise(gym, data.default_id, "default_id") if data.kind == SlotKind.TAG else None,
        tags=_gym_tags(gym, data.tag_ids),
        dose=dose.validate(data.dose.dict(), unit) if data.dose else None,
    )
    return _slot(services.template_slot(template, slot_id), unit)


@router.delete("/templates/{template_id}/slots/{slot_id}", response=Editor)
def remove_slot(request, template_id: uuid.UUID, slot_id: uuid.UUID):
    coach, template = _template(request, template_id)
    services.remove_slot(services.template_slot(template, slot_id))
    return _editor(template, coach.gym.units)


class Move(Schema):
    session_id: uuid.UUID
    index: int


@router.post("/templates/{template_id}/slots/{slot_id}/move", response=Editor)
def move_slot(request, template_id: uuid.UUID, slot_id: uuid.UUID, data: Move):
    coach, template = _template(request, template_id)
    slot = services.template_slot(template, slot_id)
    services.move_slot(slot, services.template_session(template, data.session_id), data.index)
    return _editor(template, coach.gym.units)


# ---------------------------------------------------------------- habits and saved parts


class HabitIn(Schema):
    name: str
    emoji: str = "🍎"
    cadence: str = "daily"
    note: str = ""


@router.post("/templates/{template_id}/habits", response={201: Editor})
def add_habit(request, template_id: uuid.UUID, data: HabitIn):
    coach, template = _template(request, template_id)
    services.add_habit(template, data.name, data.emoji, data.cadence, data.note)
    return Status(201, _editor(template, coach.gym.units))


@router.delete("/templates/{template_id}/habits/{template_habit_id}", response=Editor)
def remove_habit(request, template_id: uuid.UUID, template_habit_id: uuid.UUID):
    coach, template = _template(request, template_id)
    services.remove_habit(template, template_habit_id)
    return _editor(template, coach.gym.units)


@router.get("/templates/{template_id}/saved", response=list[Card])
def saved(request, template_id: uuid.UUID, kind: str = "week"):
    """Saved weeks (kind "week") or saved sessions to drop into this template."""
    coach, template = _template(request, template_id)
    ids = services.saved_sources(coach.gym, kind, exclude=template).values_list("pk", flat=True)
    return [_card(t) for t in _templates(coach.gym).filter(pk__in=ids)]


class UseSaved(Schema):
    kind: str  # week, session
    source_id: uuid.UUID
    template_week_id: uuid.UUID | None = None  # where a saved session goes


@router.post("/templates/{template_id}/use-saved", response={201: Editor})
def use_saved(request, template_id: uuid.UUID, data: UseSaved):
    """Copy a saved week in as the last week, or a saved session into `template_week_id`."""
    coach, template = _template(request, template_id)
    week = services.template_week(template, data.template_week_id) if data.template_week_id else None
    services.use_saved(template, data.kind, data.source_id, week)
    return Status(201, _editor(template, coach.gym.units))


# ---------------------------------------------------------------- saving into the library


class SaveIn(Schema):
    name: str = ""  # blank: the suggested name
    description: str = ""


@router.post("/templates/{template_id}/weeks/{template_week_id}/save", response={201: Card})
def save_template_week(request, template_id: uuid.UUID, template_week_id: uuid.UUID, data: SaveIn):
    """A copy of this week as a saved week."""
    coach, template = _template(request, template_id)
    week = services.template_week(template, template_week_id)
    name = data.name or services.suggested_name(template, "week", week)
    return Status(
        201, _card(services.save_template_week(coach.gym, request.user, week, name, data.description))
    )


@router.post("/templates/{template_id}/template-sessions/{template_session_id}/save", response={201: Card})
def save_template_session(request, template_id: uuid.UUID, template_session_id: uuid.UUID, data: SaveIn):
    coach, template = _template(request, template_id)
    session = services.template_session(template, template_session_id)
    name = data.name or services.suggested_name(template, "session", session)
    return Status(201, _card(services.save_session(coach.gym, request.user, session, name, data.description)))


def _athlete(request, athlete_id):
    coach = programmer_of(request)
    return coach, coaching.athlete_for(coach, athlete_id)


@router.post("/athletes/{athlete_id}/weeks/{week_id}/save", response={201: Card})
def save_board_week(request, athlete_id: uuid.UUID, week_id: uuid.UUID, data: SaveIn):
    """A week of an athlete's program as a saved week."""
    coach, athlete = _athlete(request, athlete_id)
    week = program_services.athlete_week(athlete, week_id)
    name = data.name or services.suggested_week_name(week)
    return Status(201, _card(services.save_week(coach.gym, request.user, week, name, data.description)))


@router.post("/athletes/{athlete_id}/planned-sessions/{session_id}/save", response={201: Card})
def save_board_session(request, athlete_id: uuid.UUID, session_id: uuid.UUID, data: SaveIn):
    coach, athlete = _athlete(request, athlete_id)
    session = program_services.athlete_session(athlete, session_id)
    name = data.name or session.name or session.day.date.strftime("%A")
    return Status(201, _card(services.save_session(coach.gym, request.user, session, name, data.description)))


@router.post("/athletes/{athlete_id}/program/save", response={201: Card})
def save_board_program(request, athlete_id: uuid.UUID, data: SaveIn):
    """The athlete's whole program as a template."""
    coach, athlete = _athlete(request, athlete_id)
    program = program_services.active_program(athlete)
    if program is None:
        raise errors.NotFound()
    name, description = services.suggested_program_names(program)
    return Status(
        201,
        _card(
            services.save_program(
                coach.gym, request.user, program, data.name or name, data.description or description
            )
        ),
    )
