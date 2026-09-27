"""Editing check-in questions (apps/workouts/questions.py), for a gym's defaults and for one
athlete's copy, tested directly."""

import pytest

from apps.workouts import questions
from apps.workouts.models import CheckinQuestion, QuestionType, install_default_questions

from ..factories import AthleteFactory

pytestmark = pytest.mark.django_db


@pytest.fixture(params=["gym", "athlete"])
def owner(request, gym, athlete):
    return gym if request.param == "gym" else athlete


def test_new_questions_go_at_the_end_with_starter_wording(owner):
    scale = questions.add(owner, QuestionType.SCALE)
    choice = questions.add(owner, QuestionType.CHOICE)
    text = questions.add(owner, QuestionType.TEXT)
    assert list(questions.active(owner)) == [scale, choice, text]
    assert (scale.low_label, scale.high_label) == ("low", "high")
    assert choice.options == ["Option A", "Option B"]
    with pytest.raises(questions.InvalidQuestion):
        questions.add(owner, "essay")


def test_wording_is_tidied_and_required(owner):
    q = questions.add(owner, QuestionType.SCALE)
    changed = questions.update(q, text="  How   sore? ", low_label=" none ", detail_label="Where?")
    assert set(changed) == {"text", "low_label", "detail_label"}
    assert (q.text, q.low_label, q.detail_label) == ("How sore?", "none", "Where?")
    assert questions.update(q, text="How sore?") == []
    with pytest.raises(questions.InvalidQuestion):
        questions.update(q, text="   ")


def test_labels_only_belong_to_scales(owner):
    q = questions.add(owner, QuestionType.TEXT)
    assert questions.update(q, low_label="ignored", detail_label="ignored") == []


def test_options(owner):
    q = questions.add(owner, QuestionType.CHOICE)
    questions.add_option(q, "  Poor   sleep ")
    assert q.options[-1] == "Poor sleep"
    for bad in ("", "Poor sleep"):
        with pytest.raises(questions.InvalidQuestion):
            questions.add_option(q, bad)
    for i in range(9):
        questions.add_option(q, f"Option {i}")
    assert len(q.options) == questions.MAX_OPTIONS
    with pytest.raises(questions.InvalidQuestion):
        questions.add_option(q, "one too many")
    while len(q.options) > questions.MIN_OPTIONS:
        questions.remove_option(q, 0)
    with pytest.raises(questions.InvalidQuestion):
        questions.remove_option(q, 0)
    with pytest.raises(questions.InvalidQuestion):
        questions.add_option(questions.add(owner, QuestionType.SCALE), "not a choice")


def test_moving_and_archiving(owner):
    a, b, c = (questions.add(owner, QuestionType.TEXT) for _ in range(3))
    questions.move(owner, c.pk, "up")
    assert list(questions.active(owner)) == [a, c, b]
    questions.move(owner, a.pk, "up")  # already first: nothing moves
    assert list(questions.active(owner)) == [a, c, b]
    questions.archive(c)
    assert list(questions.active(owner)) == [a, b]
    with pytest.raises(CheckinQuestion.DoesNotExist):
        questions.get(owner, c.pk)


def test_one_owners_questions_are_not_anothers(gym, athlete, coach):
    q = questions.add(athlete, QuestionType.TEXT)
    with pytest.raises(CheckinQuestion.DoesNotExist):
        questions.get(gym, q.pk)
    with pytest.raises(CheckinQuestion.DoesNotExist):  # someone else's: not found
        questions.move(AthleteFactory(coach=coach), q.pk, "up")


def test_reset_and_push_defaults(gym, athlete, coach):
    install_default_questions(gym)
    questions.add(athlete, QuestionType.TEXT)
    other = AthleteFactory(coach=coach)
    assert questions.push_defaults(coach) == 2
    for a in (athlete, other):
        assert [q.text for q in questions.active(a)] == [q.text for q in questions.active(gym)]
    questions.add(athlete, QuestionType.TEXT)
    questions.reset_to_defaults(athlete)
    assert questions.active(athlete).count() == 2
    assert CheckinQuestion.objects.for_athlete(athlete).filter(archived=True).exists()  # history kept
