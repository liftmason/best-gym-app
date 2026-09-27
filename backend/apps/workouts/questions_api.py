"""Check-in question builders: an athlete's own questions (here), and the gym's defaults
new athletes get (the settings endpoints use the same helpers). The rules are in
questions.py; every call looks the question up through its owner."""

import uuid

from ninja import Router, Schema, Status

from apps.accounts import coaching
from apps.api.main import coach_of

from . import questions

router = Router(tags=["Check-in questions"])


class QuestionOut(Schema):
    id: uuid.UUID
    type: str
    text: str
    low_label: str
    high_label: str
    detail_label: str
    options: list[str]


class NewQuestion(Schema):
    type: str


class Wording(Schema):
    text: str | None = None
    low_label: str | None = None
    high_label: str | None = None
    detail_label: str | None = None


class Direction(Schema):
    direction: str  # up, down


class OptionIn(Schema):
    option: str


def listed(owner):
    return [question_out(q) for q in questions.active(owner)]


def question_out(q):
    return {
        "id": q.pk,
        "type": q.type,
        "text": q.text,
        "low_label": q.low_label,
        "high_label": q.high_label,
        "detail_label": q.detail_label,
        "options": list(q.options),
    }


def reword(owner, question_id, data):
    question = questions.get(owner, question_id)
    questions.update(question, **data.dict())
    return question_out(question)


def add_option(owner, question_id, data):
    question = questions.get(owner, question_id)
    questions.add_option(question, data.option)
    return question_out(question)


def remove_option(owner, question_id, index):
    question = questions.get(owner, question_id)
    questions.remove_option(question, index)
    return question_out(question)


def _athlete(request, athlete_id):
    return coaching.athlete_for(coach_of(request), athlete_id)


@router.get("/athletes/{athlete_id}/questions", response=list[QuestionOut])
def athlete_questions(request, athlete_id: uuid.UUID):
    return listed(_athlete(request, athlete_id))


@router.post("/athletes/{athlete_id}/questions", response={201: QuestionOut})
def add(request, athlete_id: uuid.UUID, data: NewQuestion):
    return Status(201, question_out(questions.add(_athlete(request, athlete_id), data.type)))


@router.patch("/athletes/{athlete_id}/questions/{question_id}", response=QuestionOut)
def update(request, athlete_id: uuid.UUID, question_id: uuid.UUID, data: Wording):
    return reword(_athlete(request, athlete_id), question_id, data)


@router.post("/athletes/{athlete_id}/questions/{question_id}/archive", response={204: None})
def archive(request, athlete_id: uuid.UUID, question_id: uuid.UUID):
    questions.archive(questions.get(_athlete(request, athlete_id), question_id))
    return Status(204, None)


@router.post("/athletes/{athlete_id}/questions/{question_id}/move", response=list[QuestionOut])
def move(request, athlete_id: uuid.UUID, question_id: uuid.UUID, data: Direction):
    athlete = _athlete(request, athlete_id)
    questions.move(athlete, question_id, data.direction)
    return listed(athlete)


@router.post("/athletes/{athlete_id}/questions/{question_id}/options", response=QuestionOut)
def option_add(request, athlete_id: uuid.UUID, question_id: uuid.UUID, data: OptionIn):
    return add_option(_athlete(request, athlete_id), question_id, data)


@router.delete("/athletes/{athlete_id}/questions/{question_id}/options/{index}", response=QuestionOut)
def option_remove(request, athlete_id: uuid.UUID, question_id: uuid.UUID, index: int):
    return remove_option(_athlete(request, athlete_id), question_id, index)


@router.post("/athletes/{athlete_id}/reset-questions", response=list[QuestionOut])
def reset(request, athlete_id: uuid.UUID):
    """Replace the athlete's questions with fresh copies of the gym's defaults."""
    athlete = _athlete(request, athlete_id)
    questions.reset_to_defaults(athlete)
    return listed(athlete)
