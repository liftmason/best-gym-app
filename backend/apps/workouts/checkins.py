"""The pre-session check-in: the athlete's questions and their answers to them. Views and
(from sub-project 2) the API call these; they hold the rules."""

from django.db import transaction

from apps.core import errors

from .models import OTHER_OPTION, CheckinAnswer, CheckinQuestion, QuestionType
from .sessions import SessionClosed  # noqa: F401 - part of this module's interface

SCALE_VALUES = {str(i) for i in range(1, 11)}
MAX_DETAIL = 300  # a scale's follow-up words, or a choice's "Other" details
MAX_TEXT = 200  # a short answer


class InvalidAnswer(errors.Invalid):
    """Not an answer this question accepts."""


def questions(athlete):
    """The athlete's active questions, in order."""
    return list(CheckinQuestion.objects.for_athlete(athlete).active())


def clean_answer(question, value, other=""):
    """(value, other_text) to store, or InvalidAnswer. A scale takes 1-10 plus optional
    follow-up words if the question asks for them; a choice takes one of its options or
    "Other" with details; a short answer takes any text, including none."""
    value, other = str(value or "").strip(), str(other or "").strip()
    if question.type == QuestionType.SCALE:
        if value not in SCALE_VALUES:
            raise InvalidAnswer("Pick a number from 1 to 10.")
        return value, other[:MAX_DETAIL] if question.detail_label else ""
    if question.type == QuestionType.TEXT:
        return " ".join(value.split())[:MAX_TEXT], ""
    if value not in [*question.options, OTHER_OPTION]:
        raise InvalidAnswer("Pick one of the options.")
    return value, other[:MAX_DETAIL] if value == OTHER_OPTION else ""


def answer(log, question, value, other="", answer_id=None):
    """Save (or change) the answer to one of the log's athlete's active questions
    (`answer_id`: the id a phone chose for a new one)."""
    if log.finished:
        raise SessionClosed()
    active = questions(log.athlete)
    if question not in active:
        raise InvalidAnswer("That isn't one of this athlete's questions.")
    value, other = clean_answer(question, value, other)
    fields = {
        "order": active.index(question),
        "question_text": question.text,
        "type": question.type,
        "value": value,
        "other_text": other,
    }
    answer_row, _ = CheckinAnswer.objects.update_or_create(
        session_log=log,
        question=question,
        create_defaults={"id": answer_id, **fields} if answer_id else None,
        defaults=fields,
    )
    return answer_row


@transaction.atomic
def finish(log, *, skip):
    """End the check-in: kept as answered, or skipped (which clears any answers)."""
    if log.finished:
        raise SessionClosed()
    if skip:
        log.answers.all().delete()
    log.checkin_skipped = skip
    log.save(update_fields=["checkin_skipped"])
    return log
