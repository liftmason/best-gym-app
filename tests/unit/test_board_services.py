"""Board edits in apps/programs/services.py, tested directly: each records an undo step when a
coach makes it (`by=`), and the rules that used to live in the board's views."""

import pytest

from apps.exercises.models import Exercise
from apps.programs import services, undo
from apps.programs.dose import validate
from apps.programs.models import EditHistory, WeekType
from apps.workouts import sessions

from ..conftest import ex
from ..factories import AthleteFactory, GymFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def week(athlete, coach, gym):
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program = services.start_program(athlete, "P", athlete.today(), 1, week_type, by=coach.user)
    return program.weeks.get()


@pytest.fixture
def day(week, athlete):
    return week.days.get(date=athlete.today())


def labels(week):
    return [e.label for e in EditHistory.objects.filter(program_week=week).order_by("created_at", "id")]


def test_each_board_edit_records_an_undo_step(week, day, athlete, coach, gym):
    by = coach.user
    rx = services.add_prescription(day, ex(gym, "sn"), athlete, by=by)
    services.edit_prescription(
        rx, validate({"sets": 5, "rep_scheme": "2", "load_basis": "none"}, "kg"), by=by
    )
    services.swap_exercise(rx, ex(gym, "psn"), by=by)
    services.move_prescription(
        rx, week.days.last().sessions.first() or services.session_for(week.days.last()), 0, by=by
    )
    services.remove_prescription(rx, by=by)
    services.add_day_session(day, by=by)
    services.rename_session(day.sessions.first(), "AM", by=by)
    services.delete_session(day.sessions.last(), by=by)
    services.set_week_type(week, WeekType.objects.get(gym=gym, name="Deload"), by=by)
    services.set_focus_note(week, "Easy week", by=by)
    services.clear_week(week, by=by)
    assert labels(week) == [
        "Add Snatch",
        "Edit Snatch",
        "Swap Snatch for Power Snatch",
        "Move Power Snatch",
        "Remove Power Snatch",
        f"Add a session on {day.date:%a}",
        "Rename a session",
        f"Remove a session on {day.date:%a}",
        "Week type → Deload",
        "Edit focus note",
        "Clear Wk 1",
    ]


def test_without_a_coach_nothing_is_recorded(week, day, athlete, gym):
    rx = services.add_prescription(day, ex(gym, "sn"), athlete)
    services.remove_prescription(rx)
    services.set_focus_note(week, "note")
    assert not EditHistory.objects.exists()


def test_undo_reverses_a_recorded_edit(week, day, athlete, coach, gym):
    services.add_prescription(day, ex(gym, "sn"), athlete, by=coach.user)
    assert undo.undo(week) == "Add Snatch"
    assert not day.sessions.exists() or not day.sessions.first().prescriptions.exists()


def test_a_day_holds_three_sessions_named_in_order(day, coach):
    services.add_day_session(day, by=coach.user)
    services.add_day_session(day, by=coach.user)
    assert list(day.sessions.values_list("name", flat=True)) == ["Session 1", "Session 2", "Session 3"]
    with pytest.raises(services.TooManySessions):
        services.add_day_session(day, by=coach.user)


def test_an_unnamed_first_session_gets_named_when_a_second_arrives(day, athlete, gym):
    services.add_prescription(day, ex(gym, "sn"), athlete)  # makes an unnamed session
    services.add_day_session(day)
    assert list(day.sessions.values_list("name", flat=True)) == ["Session 1", "Session 2"]


def test_logged_sessions_stay(day, athlete, gym):
    services.add_prescription(day, ex(gym, "sn"), athlete)
    session = day.sessions.get()
    sessions.start(athlete, session)
    with pytest.raises(services.HasLoggedSessions):
        services.delete_session(session)


def test_only_the_gyms_live_exercises_can_be_added(day, athlete, gym):
    elsewhere = Exercise.objects.filter(gym=GymFactory(pack="weightlifting")).first()
    archived = ex(gym, "sn")
    archived.archived = True
    archived.save()
    for exercise in (elsewhere, archived):
        with pytest.raises(services.NotAllowed):
            services.add_prescription(day, exercise, athlete)


def test_week_types_must_be_the_gyms_and_not_newly_archived(week, gym):
    other = WeekType.objects.filter(gym=GymFactory(pack="weightlifting")).first()
    with pytest.raises(services.NotAllowed):
        services.set_week_type(week, other)
    deload = WeekType.objects.get(gym=gym, name="Deload")
    deload.archived = True
    deload.save()
    with pytest.raises(services.NotAllowed):
        services.set_week_type(week, deload)
    services.set_week_type(week, week.week_type)  # keeping an archived current type is fine


def test_exercises_move_only_within_the_program(day, athlete, coach, gym):
    rx = services.add_prescription(day, ex(gym, "sn"), athlete)
    other_athlete = AthleteFactory(coach=coach)
    other = services.start_program(other_athlete, "Q", athlete.today(), 1, day.week.week_type, by=coach.user)
    target = services.session_for(other.weeks.get().days.first())
    with pytest.raises(services.NotAllowed):
        services.move_prescription(rx, target, 0)


def test_a_coachs_swap_must_be_a_candidate(day, athlete, coach, gym):
    rx = services.add_prescription(day, ex(gym, "sn"), athlete)
    candidates = list(services.swap_candidates(rx))
    assert ex(gym, "psn") in candidates and ex(gym, "sn") not in candidates
    with pytest.raises(services.NotAllowed):
        services.swap_exercise(rx, ex(gym, "abw"), by=coach.user)  # ab wheel for a snatch


def test_names_and_notes_are_tidied(week, day):
    services.set_focus_note(week, "  " + "x" * 1200)
    assert len(week.focus_note) == 1000
    session = services.add_day_session(day)
    services.rename_session(session, "  Evening    lift  ")
    assert session.name == "Evening lift"
