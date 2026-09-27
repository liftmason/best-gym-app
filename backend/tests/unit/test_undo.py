"""Undo after weeks move and across weeks (audit H2, H3)."""

import pytest

from apps.programs import services, undo
from apps.programs.models import EditHistory, Prescription, WeekType

from ..conftest import ex

pytestmark = pytest.mark.django_db


@pytest.fixture
def program(athlete, coach):
    week_type = WeekType.objects.get(gym=coach.gym, name="Accumulation")
    return services.start_program(athlete, "Block", athlete.today(), 3, week_type, by=coach.user)


def weeks(program):
    return list(program.weeks.order_by("order"))


def names(week):
    return sorted(
        Prescription.objects.filter(session__day__week=week).values_list("exercise__name", flat=True)
    )


def test_undo_after_the_week_moved_later(program, athlete, coach, gym):
    # H2: duplicating week 1 moves week 2 a week later; undo in week 2 deleted its sessions.
    first, second, _ = weeks(program)
    day = second.days.order_by("date").first()
    services.add_prescription(day, ex(gym, "sn"), athlete)
    services.add_prescription(day, ex(gym, "cj"), athlete, by=coach.user)
    services.duplicate_week(first)
    second.refresh_from_db()
    assert undo.undo(second) == "Add Clean & Jerk"
    assert names(second) == ["Snatch"]


def test_undo_after_the_week_moved_earlier(program, athlete, coach, gym):
    first, _, third = weeks(program)
    day = third.days.order_by("date").last()
    services.add_prescription(day, ex(gym, "sn"), athlete)
    services.add_prescription(day, ex(gym, "cj"), athlete, by=coach.user)
    services.delete_week(first)
    third.refresh_from_db()
    undo.undo(third)
    assert names(third) == ["Snatch"]


def test_undoing_a_move_to_another_week_brings_the_exercise_back(program, athlete, coach, gym):
    # H3: the moved exercise wasn't found in its old week, so undo made a copy.
    first, second, _ = weeks(program)
    services.add_prescription(first.days.order_by("date").first(), ex(gym, "sn"), athlete)
    services.add_prescription(second.days.order_by("date").first(), ex(gym, "bsq"), athlete)
    rx = Prescription.objects.get(exercise__name="Snatch")
    target = second.days.order_by("date").first().sessions.get()
    services.move_prescription(rx, target, 0, by=coach.user)
    assert names(first) == [] and names(second) == ["Back Squat", "Snatch"]

    undo.undo(first)
    assert names(first) == ["Snatch"] and names(second) == ["Back Squat"]
    assert Prescription.objects.get(exercise__name="Snatch").pk == rx.pk


def test_a_snapshot_in_an_older_format_is_dropped_not_half_restored(program, athlete, coach, gym):
    first = weeks(program)[0]
    services.add_prescription(first.days.first(), ex(gym, "sn"), athlete, by=coach.user)
    EditHistory.objects.update(snapshot={"week_type": None, "focus_note": "", "sessions": []})
    assert undo.undo(first) is None
    assert names(first) == ["Snatch"] and not EditHistory.objects.exists()
