"""Double submits and two tabs, with real parallel database connections (audit H13, M7,
M11). Each test runs the same call in several threads at once and checks the outcome is
what one call (or the calls one after another) would give, with no error."""

import datetime
import threading

import pytest
from django.db import connection

from apps.accounts.models import Athlete, MaxEntry, MaxUpdates
from apps.programs import habits
from apps.programs import services as program_services
from apps.programs.models import Habit, Program, WeekType
from apps.workouts import sessions
from apps.workouts.models import SessionLog

from ..conftest import ex

pytestmark = pytest.mark.django_db(transaction=True)


def at_once(fn, times=4):
    """Run fn() in `times` threads started together; returns the exceptions raised."""
    start, errors = threading.Barrier(times), []

    def work():
        start.wait()
        try:
            fn()
        except Exception as error:  # noqa: BLE001 - collected for the assertion
            errors.append(error)
        finally:
            connection.close()

    threads = [threading.Thread(target=work) for _ in range(times)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return errors


def week_type(coach):
    return WeekType.objects.get(gym=coach.gym, name="Accumulation")


def test_finishing_twice_at_once_sets_the_max_once(athlete, coach, gym):
    athlete.max_updates = MaxUpdates.AUTO
    athlete.save()
    MaxEntry.objects.create(
        athlete=athlete,
        exercise=ex(gym, "sn"),
        date=athlete.today() - datetime.timedelta(days=30),
        kg=100,
        source="coach",
    )
    week = program_services.start_program(athlete, "P", athlete.today(), 1, week_type(coach), by=coach.user)
    week = week.weeks.get()
    program_services.set_published(week, True)
    day = week.days.get(date=athlete.today())
    program_services.add_prescription(day, ex(gym, "sn"), athlete)
    log = sessions.start_planned(athlete, day.sessions.get().pk)
    sessions.log_set(log.exercises.get(), 1, load="110", reps="1", done=True)

    assert at_once(lambda: sessions.finish(SessionLog.objects.get(pk=log.pk), 8)) == []
    assert MaxEntry.objects.filter(source="session").count() == 1


def test_starting_a_program_in_two_tabs(athlete, coach):
    def start():
        a = Athlete.objects.get(pk=athlete.pk)
        program_services.start_program(a, "P", a.today(), 2, week_type(coach), by=coach.user)

    assert at_once(start) == []
    assert Program.objects.filter(athlete=athlete, active=True).count() == 1


def test_adding_weeks_in_two_tabs(athlete, coach):
    program = program_services.start_program(
        athlete, "P", athlete.today(), 1, week_type(coach), by=coach.user
    )

    def add():
        program_services.add_week(Program.objects.get(pk=program.pk), week_type(coach))

    assert at_once(add) == []
    assert sorted(program.weeks.values_list("order", flat=True)) == [0, 1, 2, 3, 4]


def test_a_double_tap_on_a_habit_is_harmless(athlete):
    habit = habits.prescribe(athlete, "Sleep", "😴", "daily")
    today = athlete.today()
    assert at_once(lambda: habits.toggle(Habit.objects.get(pk=habit.pk), today), times=2) == []
    assert not habit.logs.exists()  # on, then off
