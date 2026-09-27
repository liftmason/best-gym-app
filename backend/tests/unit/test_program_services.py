"""Program editor services beyond the board edits (apps/programs/services.py, rail.py), tested
directly: scoped lookups, which week the board opens on, starting a program, adding weeks,
the program note, and the exercise rail."""

import datetime

import pytest

from apps.exercises.models import Exercise
from apps.programs import rail, services
from apps.programs.models import ProgramDay, ProgramWeek, WeekType
from apps.workouts import sessions

from ..conftest import ex
from ..factories import AthleteFactory

pytestmark = pytest.mark.django_db
DAY = datetime.timedelta(days=1)


def wt(gym, name="Accumulation"):
    return WeekType.objects.get(gym=gym, name=name)


@pytest.fixture
def program(athlete, coach, gym):
    return services.start_new_program(athlete, "Block", athlete.today() - 7 * DAY, 3, wt(gym), by=coach.user)


def test_lookups_only_find_the_athletes_active_program(program, athlete, coach, gym):
    week = program.weeks.first()
    assert services.athlete_week(athlete, week.pk) == week
    other = AthleteFactory(coach=coach)
    with pytest.raises(ProgramWeek.DoesNotExist):
        services.athlete_week(other, week.pk)
    day = week.days.first()
    services.start_new_program(
        athlete, "Next", athlete.today(), 1, wt(gym), by=coach.user
    )  # ends the old one
    with pytest.raises(ProgramDay.DoesNotExist):
        services.athlete_day(athlete, day.pk)


def test_the_week_the_board_opens_on(program, athlete):
    weeks, week = services.board_week(program, athlete.today())
    assert week == weeks[1]  # contains today
    assert services.board_week(program, athlete.today(), weeks[2].pk)[1] == weeks[2]
    assert services.board_week(program, athlete.today() + 60 * DAY)[1] == weeks[-1]
    assert services.board_week(program, athlete.today() - 60 * DAY)[1] == weeks[0]


@pytest.mark.parametrize("name, weeks", [("", 4), ("x" * 81, 4), ("Block", 0), ("Block", 53)])
def test_starting_a_program_is_checked(athlete, coach, gym, name, weeks):
    with pytest.raises(services.InvalidProgram):
        services.start_new_program(athlete, name, athlete.today(), weeks, wt(gym), by=coach.user)


def test_starting_needs_one_of_the_gyms_live_week_types(athlete, coach, gym):
    deload = wt(gym, "Deload")
    deload.archived = True
    deload.save()
    with pytest.raises(services.InvalidProgram):
        services.start_new_program(athlete, "Block", athlete.today(), 4, deload, by=coach.user)


def test_starting_snaps_to_the_week_start_and_keeps_the_old_program(program, athlete, coach, gym):
    new = services.start_new_program(athlete, "  Peak   block ", athlete.today(), 2, wt(gym), by=coach.user)
    assert new.name == "Peak block" and new.start_date == gym.week_start_for(athlete.today())
    program.refresh_from_db()
    assert not program.active and program.ended_at


def test_adding_a_week_copies_the_last_weeks_type(program, gym):
    last = program.weeks.last()
    last.week_type = wt(gym, "Deload")
    last.save()
    week = services.add_week_at_end(program)
    assert week.order == 3 and week.week_type == wt(gym, "Deload")
    assert week.start_date == last.start_date + 7 * DAY


def test_program_note(program):
    services.set_program_note(program, "  Rest as needed. " + "x" * 3000)
    assert program.note.startswith("Rest as needed.") and len(program.note) == services.MAX_NOTE


def test_rail_search_and_recent_first(program, athlete, gym):
    day = program.weeks.get(days__date=athlete.today() - DAY).days.get(date=athlete.today() - DAY)
    services.add_prescription(day, ex(gym, "fsq"), athlete)
    log = sessions.start(athlete, day.sessions.get())
    sessions.log_set(log.exercises.get(), 1, load="100", reps="3", done=True)
    sessions.finish(log, 7)
    exercises, sort = rail.search(gym, athlete=athlete)
    assert (
        sort == "recent" and exercises[0] == ex(gym, "fsq") and exercises[0].hist["line"].startswith("100 kg")
    )
    az, sort = rail.search(gym, athlete=athlete, sort="az")
    db_order = list(Exercise.objects.filter(gym=gym, archived=False).order_by("name"))
    assert sort == "az" and az == db_order  # the database's A–Z (its collation, not Python's)
    assert rail.search(gym)[1] == "az"  # the template editor has no athlete, so always A–Z
    squats, _ = rail.search(gym, "squat")
    assert squats and all(
        "squat" in e.name.lower()
        or e.category.name == "Squat"
        or any("squat" in t.name for t in e.tags.all())
        for e in squats
    )
