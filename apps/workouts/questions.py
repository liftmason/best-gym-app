"""Editing check-in questions. The same rules serve a gym's defaults (what new athletes get)
and one athlete's own copy: pass `owner`, a Gym or an Athlete. Removing a question archives
it, so past answers keep their question."""

from django.db import transaction
from django.db.models import Max

from .models import CheckinQuestion, QuestionType, copy_defaults_to

MAX_OPTIONS = 12
MIN_OPTIONS = 2
MAX_TEXT = 200
MAX_LABEL = 60
MAX_OPTION = 80
NEW_QUESTION = {
    QuestionType.SCALE: {"text": "New 1–10 question", "low_label": "low", "high_label": "high"},
    QuestionType.CHOICE: {"text": "New multiple-choice question", "options": ["Option A", "Option B"]},
    QuestionType.TEXT: {"text": "New short-answer question"},
}


class InvalidQuestion(Exception):
    pass


def _owner_kwargs(owner):
    from apps.accounts.models import Athlete

    return {"athlete": owner} if isinstance(owner, Athlete) else {"gym": owner}


def owned(owner):
    """All the owner's questions, archived ones included."""
    kwargs = _owner_kwargs(owner)
    if "athlete" in kwargs:
        return CheckinQuestion.objects.for_athlete(owner)
    return CheckinQuestion.objects.gym_defaults(owner)


def active(owner):
    return owned(owner).active()


def get(owner, question_id):
    """One of the owner's active questions (CheckinQuestion.DoesNotExist otherwise)."""
    return owned(owner).filter(archived=False).get(pk=question_id)


def add(owner, qtype):
    if qtype not in QuestionType.values:
        raise InvalidQuestion(f"Unknown question type: {qtype!r}")
    order = (owned(owner).filter(archived=False).aggregate(m=Max("order"))["m"] or 0) + 1
    return CheckinQuestion.objects.create(
        type=qtype, order=order, **NEW_QUESTION[qtype], **_owner_kwargs(owner)
    )


def update(question, *, text=None, low_label=None, high_label=None, detail_label=None):
    """Change the wording. Text is required (spacing tidied, up to 200 characters); a scale's
    labels and follow-up box are up to 60 and ignored for other types. Returns the fields
    that changed."""
    changed = []
    if text is not None:
        text = " ".join(text.split())[:MAX_TEXT]
        if not text:
            raise InvalidQuestion("A question needs some wording")
        if text != question.text:
            question.text = text
            changed.append("text")
    if question.type == QuestionType.SCALE:
        for name, value in (
            ("low_label", low_label),
            ("high_label", high_label),
            ("detail_label", detail_label),
        ):
            if value is not None:
                value = value.strip()[:MAX_LABEL]
                if value != getattr(question, name):
                    setattr(question, name, value)
                    changed.append(name)
    if changed:
        question.save(update_fields=changed)
    return changed


def archive(question):
    question.archived = True
    question.save(update_fields=["archived"])


@transaction.atomic
def move(owner, question_id, direction):
    """Swap a question with its neighbour ("up" or "down"); renumbers the list."""
    questions = list(active(owner).select_for_update())
    ids = [q.pk for q in questions]
    i = ids.index(question_id)  # ValueError if it isn't the owner's
    j = i - 1 if direction == "up" else i + 1
    if 0 <= j < len(questions):
        questions[i], questions[j] = questions[j], questions[i]
        for order, q in enumerate(questions):
            if q.order != order:
                q.order = order
                q.save(update_fields=["order"])


def add_option(question, option):
    option = " ".join((option or "").split())[:MAX_OPTION]
    if question.type != QuestionType.CHOICE:
        raise InvalidQuestion("Only multiple-choice questions have options")
    if not option:
        raise InvalidQuestion("Type the option first")
    if option in question.options:
        raise InvalidQuestion("That option is already there")
    if len(question.options) >= MAX_OPTIONS:
        raise InvalidQuestion(f"Keep it to {MAX_OPTIONS} options")
    question.options = [*question.options, option]
    question.save(update_fields=["options"])


def remove_option(question, index):
    if question.type != QuestionType.CHOICE or not 0 <= index < len(question.options):
        raise InvalidQuestion("No such option")
    if len(question.options) <= MIN_OPTIONS:
        raise InvalidQuestion("A multiple-choice question needs at least two options")
    question.options = [o for i, o in enumerate(question.options) if i != index]
    question.save(update_fields=["options"])


def reset_to_defaults(athlete):
    """The athlete's questions become copies of the gym's defaults (old ones archived)."""
    copy_defaults_to(athlete)


@transaction.atomic
def push_defaults(coach):
    """Every one of the coach's active athletes gets fresh copies of the defaults. Returns
    how many athletes were updated."""
    athletes = list(coach.athletes.filter(archived_at__isnull=True))
    for athlete in athletes:
        copy_defaults_to(athlete)
    return len(athletes)
