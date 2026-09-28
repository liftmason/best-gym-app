"""The program board for one of a coach's athletes (/api/v1/athletes/{id}/program, weeks,
days, planned sessions, prescriptions, and the exercise rail). The rules, including undo
recording (`by=`), are in services.py; everything is looked up through the athlete's active
program, so anyone else's is a 404. Loads are in the gym's unit."""

import datetime
import uuid

from ninja import Query, Router, Schema, Status

from apps.accounts import coaching
from apps.api.main import programmer_of
from apps.api.schemas import WeekTypeRef, week_type_ref
from apps.core import errors
from apps.exercises.models import Exercise

from . import dose, prescriptions, rail, services, undo
from .models import WeekType

router = Router(tags=["Program board"])


def _athlete(request, athlete_id):
    coach = programmer_of(request)
    return coach, coaching.athlete_for(coach, athlete_id)


# ---------------------------------------------------------------- reading the board


class ExerciseRef(Schema):
    id: uuid.UUID
    name: str


class BoardItem(Schema):
    id: uuid.UUID
    exercise: ExerciseRef
    summary: str  # "3×5 @ 80% · RIR 1–2", in the gym's unit
    heading: str  # "Warm-up" or a section, drawn above the card
    heading_note: str
    label: str  # "A1" in a superset
    warmup: bool
    tag_slot: bool  # applied from a template's tag slot: swappable within its tags


class PlannedSession(Schema):
    id: uuid.UUID
    name: str
    items: list[BoardItem]


class Day(Schema):
    id: uuid.UUID
    date: datetime.date
    done: bool
    sessions: list[PlannedSession]


class WeekSummary(Schema):
    id: uuid.UUID
    label: str
    start_date: datetime.date
    week_type: WeekTypeRef | None
    published: bool


class Week(WeekSummary):
    focus_note: str
    days: list[Day]
    undo: str | None  # the label of the edit undo would reverse


class ProgramOut(Schema):
    id: uuid.UUID
    name: str
    note: str
    start_date: datetime.date


class BoardOut(Schema):
    program: ProgramOut | None
    weeks: list[WeekSummary]
    week: Week | None
    week_types: list[WeekTypeRef]  # what the week may be set to


def _week_summary(w):
    return {
        "id": w.pk,
        "label": w.label,
        "start_date": w.start_date,
        "week_type": week_type_ref(w.week_type),
        "published": w.published,
    }


def _week(week, unit):
    last = undo.latest(week)
    return _week_summary(week) | {
        "focus_note": week.focus_note,
        "undo": last.label if last else None,
        "days": [
            {
                "id": d["day"].pk,
                "date": d["day"].date,
                "done": d["done"],
                "sessions": [
                    {
                        "id": s["session"].pk,
                        "name": s["session"].name,
                        "items": [
                            {
                                "id": i["rx"].pk,
                                "exercise": {"id": i["rx"].exercise_id, "name": i["rx"].exercise.name},
                                "summary": i["summary"],
                                "heading": i["heading"],
                                "heading_note": i["heading_note"],
                                "label": i["label"],
                                "warmup": i["warmup"],
                                "tag_slot": bool(i["rx"].tag_slot_tags.all()),
                            }
                            for i in s["items"]
                        ],
                    }
                    for s in d["sessions"]
                ],
            }
            for d in services.board_days(week, unit)
        ],
    }


def _board(coach, athlete, week_id=None):
    program = services.active_program(athlete)
    if program is None:
        types = WeekType.objects.active().filter(gym=coach.gym)
        return {"program": None, "weeks": [], "week": None, "week_types": [week_type_ref(t) for t in types]}
    weeks, week = services.board_week(program, athlete.today(), week_id)
    return {
        "program": {
            "id": program.pk,
            "name": program.name,
            "note": program.note,
            "start_date": program.start_date,
        },
        "weeks": [_week_summary(w) for w in weeks],
        "week": _week(week, coach.gym.units) if week else None,
        "week_types": [week_type_ref(t) for t in (services.week_type_choices(week) if week else [])],
    }


@router.get("/athletes/{athlete_id}/program", response=BoardOut)
def board(request, athlete_id: uuid.UUID, week_id: uuid.UUID | None = None):
    """The athlete's active program and one week of it: `week_id`, else this week."""
    coach, athlete = _athlete(request, athlete_id)
    return _board(coach, athlete, week_id)


class NewProgram(Schema):
    name: str
    first_day: datetime.date
    weeks: int
    week_type_id: uuid.UUID


@router.post("/athletes/{athlete_id}/program", response={201: BoardOut})
def start_program(request, athlete_id: uuid.UUID, data: NewProgram):
    """Start a new block (the current one ends and is kept)."""
    coach, athlete = _athlete(request, athlete_id)
    week_type = WeekType.objects.filter(gym=coach.gym, pk=data.week_type_id).first()
    if week_type is None:
        raise errors.Invalid({"week_type_id": "Pick one of your week types."})
    services.start_new_program(athlete, data.name, data.first_day, data.weeks, week_type, by=request.user)
    return Status(201, _board(coach, athlete))


class Note(Schema):
    note: str


@router.put("/athletes/{athlete_id}/program/note", response={204: None})
def program_note(request, athlete_id: uuid.UUID, data: Note):
    _coach, athlete = _athlete(request, athlete_id)
    program = services.active_program(athlete)
    if program is None:
        raise errors.NotFound()
    services.set_program_note(program, data.note)
    return Status(204, None)


@router.post("/athletes/{athlete_id}/program/weeks", response={201: WeekSummary})
def add_week(request, athlete_id: uuid.UUID):
    """Another week at the end, of the same type as the last."""
    _coach, athlete = _athlete(request, athlete_id)
    program = services.active_program(athlete)
    if program is None:
        raise errors.NotFound()
    return Status(201, _week_summary(services.add_week_at_end(program)))


# ---------------------------------------------------------------- weeks


def _athlete_week(request, athlete_id, week_id):
    coach, athlete = _athlete(request, athlete_id)
    return coach, athlete, services.athlete_week(athlete, week_id)


@router.post("/athletes/{athlete_id}/weeks/{week_id}/duplicate", response={201: WeekSummary})
def duplicate_week(request, athlete_id: uuid.UUID, week_id: uuid.UUID):
    """A copy right after the week (unpublished); later weeks move a week later."""
    _coach, _athlete_, week = _athlete_week(request, athlete_id, week_id)
    return Status(201, _week_summary(services.duplicate_week(week)))


@router.delete("/athletes/{athlete_id}/weeks/{week_id}", response={204: None})
def delete_week(request, athlete_id: uuid.UUID, week_id: uuid.UUID):
    _coach, _athlete_, week = _athlete_week(request, athlete_id, week_id)
    services.delete_week(week)
    return Status(204, None)


class WeekCleared(Week):
    kept: int  # days kept because a session there is done


@router.post("/athletes/{athlete_id}/weeks/{week_id}/clear", response=WeekCleared)
def clear_week(request, athlete_id: uuid.UUID, week_id: uuid.UUID):
    """Remove every session except logged days."""
    coach, _athlete_, week = _athlete_week(request, athlete_id, week_id)
    kept = services.clear_week(week, by=request.user)
    return {**_week(week, coach.gym.units), "kept": kept}


class WeekSettings(Schema):
    week_type_id: uuid.UUID | None = None
    focus_note: str | None = None
    published: bool | None = None


@router.patch("/athletes/{athlete_id}/weeks/{week_id}", response=Week)
def week_settings(request, athlete_id: uuid.UUID, week_id: uuid.UUID, data: WeekSettings):
    """Change the week's type, focus note or whether the athlete sees it (published)."""
    coach, _athlete_, week = _athlete_week(request, athlete_id, week_id)
    if data.week_type_id is not None:
        week_type = next((t for t in services.week_type_choices(week) if t.pk == data.week_type_id), None)
        if week_type is None:
            raise errors.Invalid({"week_type_id": "Pick one of your week types."})
        services.set_week_type(week, week_type, by=request.user)
    if data.focus_note is not None:
        services.set_focus_note(week, data.focus_note, by=request.user)
    if data.published is not None:
        services.set_published(week, data.published)
    return _week(week, coach.gym.units)


class Undone(Schema):
    undone: str | None  # what was undone; null when there was nothing to undo


@router.post("/athletes/{athlete_id}/weeks/{week_id}/undo", response=Undone)
def undo_week(request, athlete_id: uuid.UUID, week_id: uuid.UUID):
    _coach, _athlete_, week = _athlete_week(request, athlete_id, week_id)
    return {"undone": undo.undo(week)}


# ---------------------------------------------------------------- days and planned sessions


@router.post("/athletes/{athlete_id}/days/{day_id}/sessions", response={201: PlannedSession})
def add_session(request, athlete_id: uuid.UUID, day_id: uuid.UUID):
    """Another session on the day (up to three)."""
    _coach, athlete = _athlete(request, athlete_id)
    session = services.add_day_session(services.athlete_day(athlete, day_id), by=request.user)
    return Status(201, {"id": session.pk, "name": session.name, "items": []})


class SessionName(Schema):
    name: str


@router.patch("/athletes/{athlete_id}/planned-sessions/{session_id}", response={204: None})
def rename_session(request, athlete_id: uuid.UUID, session_id: uuid.UUID, data: SessionName):
    _coach, athlete = _athlete(request, athlete_id)
    services.rename_session(services.athlete_session(athlete, session_id), data.name, by=request.user)
    return Status(204, None)


@router.delete("/athletes/{athlete_id}/planned-sessions/{session_id}", response={204: None})
def delete_session(request, athlete_id: uuid.UUID, session_id: uuid.UUID):
    _coach, athlete = _athlete(request, athlete_id)
    services.delete_session(services.athlete_session(athlete, session_id), by=request.user)
    return Status(204, None)


# ---------------------------------------------------------------- prescriptions


class NewPrescription(Schema):
    exercise_id: uuid.UUID
    session_id: uuid.UUID | None = None  # default: the day's first session
    index: int | None = None  # default: at the end


class SetRow(Schema):
    reps: str = ""
    load: str = ""


class CustomField(Schema):
    key: str
    value: str = ""


class Dose(Schema):
    """A dose as the coach edits it (dose.validate): loads in the gym's unit."""

    sets: int
    rep_scheme: str = ""
    load_basis: str = "none"
    load_value: str = ""
    rir: str = ""  # "2" or "1-2"
    note: str = ""
    warmup: bool = False
    section: str = ""
    section_note: str = ""
    superset: bool = False
    custom_fields: list[CustomField] = []
    vary: bool = False  # per-set rows below instead of one dose for every set
    set_rows: list[SetRow] = []


class PrescriptionOut(Schema):
    id: uuid.UUID
    exercise: ExerciseRef
    dose: Dose
    summary: str
    suggested: str | None  # "≈ 63 kg of Snatch max 82 kg" for a percentage
    swaps: list[ExerciseRef]


def _prescription(rx, athlete, unit):
    return {
        "id": rx.pk,
        "exercise": {"id": rx.exercise_id, "name": rx.exercise.name},
        "dose": dose.values(rx, unit),
        "summary": prescriptions.summary(rx, unit, list(rx.set_overrides.all())),
        "suggested": prescriptions.suggested_weight(rx, athlete, unit),
        "swaps": [{"id": e.pk, "name": e.name} for e in services.swap_candidates(rx)],
    }


@router.post("/athletes/{athlete_id}/days/{day_id}/prescriptions", response={201: PrescriptionOut})
def add_prescription(request, athlete_id: uuid.UUID, day_id: uuid.UUID, data: NewPrescription):
    """Add an exercise to the day, with the dose the athlete last had for it."""
    coach, athlete = _athlete(request, athlete_id)
    day = services.athlete_day(athlete, day_id)
    exercise = Exercise.objects.filter(pk=data.exercise_id, gym=coach.gym, archived=False).first()
    if exercise is None:
        raise errors.Invalid({"exercise_id": "Pick one of your exercises."})
    rx = services.add_prescription(day, exercise, athlete, data.session_id, data.index, by=request.user)
    return Status(201, _prescription(rx, athlete, coach.gym.units))


@router.get("/athletes/{athlete_id}/prescriptions/{rx_id}", response=PrescriptionOut)
def prescription(request, athlete_id: uuid.UUID, rx_id: uuid.UUID):
    coach, athlete = _athlete(request, athlete_id)
    return _prescription(services.athlete_prescription(athlete, rx_id), athlete, coach.gym.units)


@router.put("/athletes/{athlete_id}/prescriptions/{rx_id}", response=PrescriptionOut)
def edit_prescription(request, athlete_id: uuid.UUID, rx_id: uuid.UUID, data: Dose):
    coach, athlete = _athlete(request, athlete_id)
    rx = services.athlete_prescription(athlete, rx_id)
    services.edit_prescription(rx, dose.validate(data.dict(), coach.gym.units), by=request.user)
    return _prescription(services.athlete_prescription(athlete, rx_id), athlete, coach.gym.units)


@router.delete("/athletes/{athlete_id}/prescriptions/{rx_id}", response={204: None})
def remove_prescription(request, athlete_id: uuid.UUID, rx_id: uuid.UUID):
    _coach, athlete = _athlete(request, athlete_id)
    services.remove_prescription(services.athlete_prescription(athlete, rx_id), by=request.user)
    return Status(204, None)


class Move(Schema):
    session_id: uuid.UUID
    index: int


@router.post("/athletes/{athlete_id}/prescriptions/{rx_id}/move", response={204: None})
def move_prescription(request, athlete_id: uuid.UUID, rx_id: uuid.UUID, data: Move):
    """Put the exercise at `index` in a session (any day of the same program)."""
    _coach, athlete = _athlete(request, athlete_id)
    rx = services.athlete_prescription(athlete, rx_id)
    target = services.athlete_session(athlete, data.session_id)
    services.move_prescription(rx, target, data.index, by=request.user)
    return Status(204, None)


class Swap(Schema):
    exercise_id: uuid.UUID


@router.post("/athletes/{athlete_id}/prescriptions/{rx_id}/swap", response=PrescriptionOut)
def swap(request, athlete_id: uuid.UUID, rx_id: uuid.UUID, data: Swap):
    """Change the exercise, keeping the dose: one of the prescription's `swaps`."""
    coach, athlete = _athlete(request, athlete_id)
    rx = services.athlete_prescription(athlete, rx_id)
    exercise = services.swap_candidates(rx).filter(pk=data.exercise_id).first()
    if exercise is None:
        raise errors.Invalid({"exercise_id": "Pick one of the swaps offered."})
    services.swap_exercise(rx, exercise, by=request.user)
    return _prescription(services.athlete_prescription(athlete, rx_id), athlete, coach.gym.units)


# ---------------------------------------------------------------- the exercise rail


class RailLog(Schema):
    date: datetime.date
    top: str  # "78 kg ×1"


class RailHistory(Schema):
    line: str  # "78 kg ×1 · 2 days ago"
    trend: str | None
    series: list[float]
    log: list[RailLog]  # newest first, for "{exercise} — {name}'s log"


class RailExercise(Schema):
    id: uuid.UUID
    name: str
    category: str
    tags: list[str]
    warmup: bool
    history: RailHistory | None


@router.get("/athletes/{athlete_id}/rail", response=list[RailExercise], tags=["Program board"])
def exercise_rail(
    request, athlete_id: uuid.UUID, q: str = "", tags: list[uuid.UUID] = Query([]), sort: str = "recent"
):
    """The gym's exercises to add, with this athlete's history: search by name, tag or
    category, filter by every tag in `tags`; "recent" puts the last done first."""
    coach, athlete = _athlete(request, athlete_id)
    since = coaching.visible_from(coach, athlete)
    exercises, _sort = rail.search(coach.gym, q, tags, athlete=athlete, sort=sort, since=since)
    return [
        {
            "id": e.pk,
            "name": e.name,
            "category": e.category.name,
            "tags": [t.name for t in e.tags.all()],
            "warmup": e.warmup,
            "history": {
                "line": e.hist["line"],
                "trend": e.hist["trend"],
                "series": [float(v) for v in e.hist["series"]],
                "log": [{"date": d, "top": top} for d, top in e.hist["log"]],
            }
            if e.hist
            else None,
        }
        for e in exercises
    ]
