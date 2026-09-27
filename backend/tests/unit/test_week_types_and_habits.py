"""Week types (apps/programs/week_types.py) and prescribing habits (habits.prescribe),
tested directly."""

import pytest

from apps.programs import habits, week_types
from apps.programs import services as program_services
from apps.programs.models import WeekType

pytestmark = pytest.mark.django_db


def test_adding_week_types(gym):
    wt = week_types.add(gym, "  Peak  ", "#ab12cd")
    assert (wt.name, wt.colour) == ("Peak", "#AB12CD") and list(WeekType.objects.filter(gym=gym))[-1] == wt
    assert week_types.add(gym, "Taper", "blue").colour == week_types.DEFAULT_COLOUR
    with pytest.raises(week_types.InvalidWeekType):
        week_types.add(gym, "peak")
    with pytest.raises(week_types.InvalidWeekType):
        week_types.add(gym, " ")


def test_updating_needs_a_real_colour_and_a_short_description(gym):
    wt = WeekType.objects.get(gym=gym, name="Deload")
    week_types.update(wt, name="Deload", colour_value="#123456", description="  easy   week ")
    assert (wt.colour, wt.description) == ("#123456", "easy week")
    with pytest.raises(week_types.InvalidWeekType, match="colour"):
        week_types.update(wt, name="Deload", colour_value="red", description="")
    with pytest.raises(week_types.InvalidWeekType, match="descriptions"):
        week_types.update(wt, name="Deload", colour_value="#123456", description="x" * 200)


def test_removing_archives_week_types_in_use(gym, athlete, coach):
    used = WeekType.objects.get(gym=gym, name="Accumulation")
    program_services.start_program(athlete, "P", athlete.today(), 2, used, by=coach.user)
    assert week_types.remove(used) == 2
    used.refresh_from_db()
    assert used.archived
    week_types.restore(used)
    assert not used.archived and list(WeekType.objects.filter(gym=gym, archived=False))[-1] == used
    unused = WeekType.objects.get(gym=gym, name="Cutting")
    assert week_types.remove(unused) == 0 and not WeekType.objects.filter(pk=unused.pk).exists()


def test_moving_and_pending_edits(gym):
    first, second = list(WeekType.objects.filter(gym=gym, archived=False))[:2]
    week_types.move(gym, second.pk, "up")
    assert list(WeekType.objects.filter(gym=gym, archived=False))[0] == second
    week_types.save_pending_edits(
        gym, {f"colour_{first.pk}": "#000000", f"description_{first.pk}": " quiet "}
    )
    first.refresh_from_db()
    assert (first.colour, first.description) == ("#000000", "quiet")


def test_prescribing_habits(athlete):
    habit = habits.prescribe(athlete, "  Sleep   8 hours ", "", "daily", " Every night ")
    assert (habit.name, habit.emoji, habit.note) == ("Sleep 8 hours", habits.EMOJI[0], "Every night")
    assert habits.prescribe(athlete, "sleep 8 HOURS", "😴", "daily") is None  # already has it
    for name, cadence in (("", "daily"), ("x" * 81, "daily"), ("Walk", "hourly")):
        with pytest.raises(habits.InvalidHabit):
            habits.prescribe(athlete, name, "🚶", cadence)
