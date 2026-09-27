"""Check-in answers (apps/workouts/checkins.py), tested directly."""

import pytest

from apps.programs import services as program_services
from apps.programs.models import WeekType
from apps.workouts import checkins, sessions
from apps.workouts.models import OTHER_OPTION, CheckinQuestion, QuestionType

from ..conftest import ex
from ..factories import AthleteFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def log(athlete, coach, gym):
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program = program_services.start_program(athlete, "P", athlete.today(), 1, week_type, by=coach.user)
    day = program.weeks.get().days.get(date=athlete.today())
    program_services.add_prescription(day, ex(gym, "sn"), athlete)
    return sessions.start(athlete, day.sessions.get())


@pytest.fixture
def qs(athlete):
    make = CheckinQuestion.objects.create
    return {
        "scale": make(athlete=athlete, order=0, type=QuestionType.SCALE, text="Sore?", detail_label="Where?"),
        "plain": make(athlete=athlete, order=1, type=QuestionType.SCALE, text="Recovered?"),
        "choice": make(
            athlete=athlete, order=2, type=QuestionType.CHOICE, text="Sleep?", options=["Good", "Bad"]
        ),
        "text": make(athlete=athlete, order=3, type=QuestionType.TEXT, text="Notes"),
    }


def test_scale_answers(log, qs):
    a = checkins.answer(log, qs["scale"], " 8 ", "thighs")
    assert (a.value, a.other_text, a.order, a.question_text) == ("8", "thighs", 0, "Sore?")
    assert checkins.answer(log, qs["plain"], "5", "ignored").other_text == ""  # no follow-up asked
    for bad in ("0", "11", "", "7.5"):
        with pytest.raises(checkins.InvalidAnswer):
            checkins.answer(log, qs["plain"], bad)


def test_choice_answers(log, qs):
    assert checkins.answer(log, qs["choice"], "Good", "ignored").other_text == ""
    other = checkins.answer(log, qs["choice"], OTHER_OPTION, "x" * 400)
    assert other.value == OTHER_OPTION and len(other.other_text) == checkins.MAX_DETAIL
    with pytest.raises(checkins.InvalidAnswer):
        checkins.answer(log, qs["choice"], "Great")


def test_short_answers_may_be_empty(log, qs):
    assert checkins.answer(log, qs["text"], "  slept   badly ").value == "slept badly"
    assert checkins.answer(log, qs["text"], "").display == "—"


def test_changing_an_answer_keeps_one_row(log, qs):
    checkins.answer(log, qs["plain"], "4")
    checkins.answer(log, qs["plain"], "6")
    assert [a.value for a in log.answers.all()] == ["6"]


def test_only_the_athletes_active_questions(log, qs, coach):
    archived = qs["text"]
    archived.archived = True
    archived.save()
    with pytest.raises(checkins.InvalidAnswer):
        checkins.answer(log, archived, "hello")
    someone_else = AthleteFactory(coach=coach)
    theirs = CheckinQuestion.objects.create(athlete=someone_else, type=QuestionType.SCALE, text="Theirs")
    with pytest.raises(checkins.InvalidAnswer):
        checkins.answer(log, theirs, "5")


def test_skipping_clears_answers_and_finished_sessions_are_closed(log, qs):
    checkins.answer(log, qs["plain"], "4")
    checkins.finish(log, skip=True)
    assert log.checkin_skipped and not log.answers.exists()
    checkins.finish(log, skip=False)
    assert not log.checkin_skipped
    sessions.finish(log, 7, "")
    with pytest.raises(checkins.SessionClosed):
        checkins.answer(log, qs["plain"], "4")
    with pytest.raises(checkins.SessionClosed):
        checkins.finish(log, skip=True)


def test_questions_are_in_order(athlete, qs):
    assert checkins.questions(athlete) == [qs["scale"], qs["plain"], qs["choice"], qs["text"]]
