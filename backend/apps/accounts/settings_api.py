"""A coach's settings (/api/v1/settings, /week-types, /tracked-lifts, /default-questions):
their own title and digest choice, and what their gym shares. Gym-wide rows are looked up
within the coach's gym. The rules are in the services named below."""

import uuid

from ninja import Router, Schema, Status

from apps.api.main import coach_of
from apps.exercises import services as library
from apps.exercises.models import TrackedLift
from apps.programs import week_types
from apps.programs.models import WeekType
from apps.workouts import questions
from apps.workouts.questions_api import Direction, NewQuestion, OptionIn, QuestionOut, Wording, question_out

from . import services

router = Router(tags=["Settings"])


class SettingsOut(Schema):
    gym_name: str
    timezone: str
    units: str
    week_start: int  # 0 Monday … 6 Sunday
    coach_title: str
    digest: bool  # the morning email


@router.get("/settings", response=SettingsOut)
def settings(request):
    coach = coach_of(request)
    gym = coach.gym
    return {
        "gym_name": gym.name,
        "timezone": gym.timezone,
        "units": gym.units,
        "week_start": gym.week_start,
        "coach_title": coach.title,
        "digest": coach.digest,
    }


@router.put("/settings", response=SettingsOut)
def update_settings(request, data: SettingsOut):
    coach = coach_of(request)
    services.update_gym_settings(
        coach,
        gym_name=data.gym_name,
        coach_title=data.coach_title,
        digest=data.digest,
        timezone=data.timezone,
        units=data.units,
        week_start=data.week_start,
    )
    return settings(request)


# ---------------------------------------------------------------- week types


class WeekTypeOut(Schema):
    id: uuid.UUID
    name: str
    colour: str
    description: str
    archived: bool
    uses: int


class NewWeekType(Schema):
    name: str
    colour: str | None = None


class WeekTypeIn(Schema):
    name: str
    colour: str
    description: str = ""


class Removed(Schema):
    archived: bool  # true: something uses it, so it was archived rather than deleted
    uses: int


def _week_types(gym):
    return [
        {
            "id": w.pk,
            "name": w.name,
            "colour": w.colour,
            "description": w.description,
            "archived": w.archived,
            "uses": week_types.usage_count(w),
        }
        for w in WeekType.objects.filter(gym=gym).order_by("archived", "order", "id")
    ]


def _week_type(request, week_type_id):
    coach = coach_of(request)
    return coach, WeekType.objects.get(pk=week_type_id, gym=coach.gym)


@router.get("/week-types", response=list[WeekTypeOut])
def list_week_types(request):
    """The gym's week types, active ones first in order, archived ones after."""
    return _week_types(coach_of(request).gym)


@router.post("/week-types", response={201: list[WeekTypeOut]})
def add_week_type(request, data: NewWeekType):
    coach = coach_of(request)
    week_types.add(coach.gym, data.name, data.colour)
    return Status(201, _week_types(coach.gym))


@router.put("/week-types/{week_type_id}", response=list[WeekTypeOut])
def update_week_type(request, week_type_id: uuid.UUID, data: WeekTypeIn):
    coach, week_type = _week_type(request, week_type_id)
    week_types.update(week_type, name=data.name, colour_value=data.colour, description=data.description)
    return _week_types(coach.gym)


@router.post("/week-types/{week_type_id}/move", response=list[WeekTypeOut])
def move_week_type(request, week_type_id: uuid.UUID, data: Direction):
    coach, week_type = _week_type(request, week_type_id)
    week_types.move(coach.gym, week_type.pk, data.direction)
    return _week_types(coach.gym)


@router.post("/week-types/{week_type_id}/remove", response=Removed)
def remove_week_type(request, week_type_id: uuid.UUID):
    """Delete it, or archive it if weeks or templates use it (they keep it)."""
    _coach, week_type = _week_type(request, week_type_id)
    uses = week_types.remove(week_type)
    return {"archived": bool(uses), "uses": uses}


@router.post("/week-types/{week_type_id}/restore", response=list[WeekTypeOut])
def restore_week_type(request, week_type_id: uuid.UUID):
    coach, week_type = _week_type(request, week_type_id)
    week_types.restore(week_type)
    return _week_types(coach.gym)


# ---------------------------------------------------------------- tracked lifts


class Lift(Schema):
    id: uuid.UUID
    name: str


class TrackedOut(Schema):
    id: uuid.UUID
    exercise: Lift


class Track(Schema):
    exercise_id: uuid.UUID


def _tracked(gym):
    return [
        {"id": t.pk, "exercise": {"id": t.exercise_id, "name": t.exercise.name}}
        for t in TrackedLift.objects.filter(gym=gym).select_related("exercise")
    ]


@router.get("/tracked-lifts", response=list[TrackedOut])
def tracked_lifts(request):
    """The lifts the gym records maxes for, in order (up to six)."""
    return _tracked(coach_of(request).gym)


@router.get("/trackable-lifts", response=list[Lift])
def trackable_lifts(request):
    """Lifts that could be added: active, measured in reps, not tracked yet."""
    return [{"id": e.pk, "name": e.name} for e in library.trackable(coach_of(request).gym)]


@router.post("/tracked-lifts", response={201: list[TrackedOut]})
def track(request, data: Track):
    coach = coach_of(request)
    library.track(coach.gym, data.exercise_id)
    return Status(201, _tracked(coach.gym))


@router.delete("/tracked-lifts/{tracked_id}", response=list[TrackedOut])
def untrack(request, tracked_id: uuid.UUID):
    coach = coach_of(request)
    library.untrack(TrackedLift.objects.get(pk=tracked_id, gym=coach.gym))
    return _tracked(coach.gym)


@router.post("/tracked-lifts/{tracked_id}/move", response=list[TrackedOut])
def move_tracked(request, tracked_id: uuid.UUID, data: Direction):
    coach = coach_of(request)
    library.move_tracked(coach.gym, TrackedLift.objects.get(pk=tracked_id, gym=coach.gym).pk, data.direction)
    return _tracked(coach.gym)


# ---------------------------------------------------------------- the gym's default check-in questions


def _defaults(request):
    return coach_of(request).gym


@router.get("/default-questions", response=list[QuestionOut])
def default_questions(request):
    """The check-in questions new athletes get (each athlete has their own copy)."""
    return [question_out(q) for q in questions.active(_defaults(request))]


@router.post("/default-questions", response={201: QuestionOut})
def add_default_question(request, data: NewQuestion):
    return Status(201, question_out(questions.add(_defaults(request), data.type)))


@router.patch("/default-questions/{default_question_id}", response=QuestionOut)
def reword_default_question(request, default_question_id: uuid.UUID, data: Wording):
    from apps.workouts.questions_api import reword

    return reword(_defaults(request), default_question_id, data)


@router.post("/default-questions/{default_question_id}/archive", response={204: None})
def archive_default_question(request, default_question_id: uuid.UUID):
    gym = _defaults(request)
    questions.archive(questions.get(gym, default_question_id))
    return Status(204, None)


@router.post("/default-questions/{default_question_id}/move", response=list[QuestionOut])
def move_default_question(request, default_question_id: uuid.UUID, data: Direction):
    gym = _defaults(request)
    questions.move(gym, default_question_id, data.direction)
    return [question_out(q) for q in questions.active(gym)]


@router.post("/default-questions/{default_question_id}/options", response=QuestionOut)
def add_default_option(request, default_question_id: uuid.UUID, data: OptionIn):
    from apps.workouts.questions_api import add_option

    return add_option(_defaults(request), default_question_id, data)


@router.delete("/default-questions/{default_question_id}/options/{index}", response=QuestionOut)
def remove_default_option(request, default_question_id: uuid.UUID, index: int):
    from apps.workouts.questions_api import remove_option

    return remove_option(_defaults(request), default_question_id, index)


class Pushed(Schema):
    athletes: int


@router.post("/push-default-questions", response=Pushed)
def push_defaults(request):
    """Give every one of the coach's athletes fresh copies of the defaults (their old ones
    are archived, so past answers keep their questions)."""
    return {"athletes": questions.push_defaults(coach_of(request))}
