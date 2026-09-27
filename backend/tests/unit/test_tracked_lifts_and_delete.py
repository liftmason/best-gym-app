from decimal import Decimal

import pytest

from apps.accounts.metrics import save_metrics
from apps.accounts.models import Gym, MaxEntry
from apps.exercises.models import Exercise, TrackedLift, tracked_exercises
from apps.exercises.starter import install_pack

from ..conftest import ex, lift_field

pytestmark = pytest.mark.django_db
HX = {"HTTP_HX_REQUEST": "true"}


def names(gym):
    return [e.name for e in tracked_exercises(gym)]


# ---------------------------------------------------------------- tracked lifts in Settings


def test_new_gyms_track_the_three_default_lifts(gym):
    assert names(gym) == ["Snatch", "Clean & Jerk", "Back Squat"]
    install_pack(gym, "weightlifting")  # idempotent: never overwrites an existing list
    assert TrackedLift.objects.filter(gym=gym).count() == 3


# ---------------------------------------------------------------- everything follows the gym's list


@pytest.fixture
def general_gym(gym):
    """A gym that stopped tracking the snatch and tracks the front squat instead."""
    TrackedLift.objects.filter(gym=gym, exercise__key="sn").delete()
    TrackedLift.objects.create(gym=gym, exercise=ex(gym, "fsq"), order=9)
    return gym


def test_save_metrics_ignores_lifts_the_gym_does_not_track(athlete, general_gym):
    other = Gym.objects.create(name="Elsewhere")
    install_pack(other, "weightlifting")
    save_metrics(
        athlete,
        {
            lift_field(general_gym, "sn"): Decimal("80"),
            lift_field(other, "sn"): Decimal("90"),
            lift_field(general_gym, "fsq"): Decimal("100"),
        },
        source="coach",
    )
    assert list(MaxEntry.objects.values_list("exercise__key", flat=True)) == ["fsq"]


# ---------------------------------------------------------------- archive untracks; delete for good


def archive(gym, key):
    e = ex(gym, key)
    e.archived = True
    e.save()
    return e


def test_deletion_handles_every_model_that_points_at_an_exercise():
    """Guard for later phases: a new ForeignKey to Exercise must be counted in
    deletion_impact() and cleared in delete_exercise() (apps/exercises/deletion.py),
    then added here."""
    handled = {
        ("accounts", "maxentry", "exercise"),
        ("exercises", "exercise", "percent_of"),
        ("exercises", "trackedlift", "exercise"),
        ("exercises", "exercisetag", "exercise"),  # tag links go with the exercise automatically
        ("programs", "prescription", "exercise"),
        ("workouts", "sessionexercise", "exercise"),  # link cleared; the name and sets stay
        ("library", "templateslot", "exercise"),  # fixed slots removed; tag slots re-defaulted
    }
    pointing = {
        (f.related_model._meta.app_label, f.related_model._meta.model_name, f.field.name)
        for f in Exercise._meta.get_fields(include_hidden=True)  # hidden: related_name="+" links too
        if f.auto_created and not f.concrete and (f.one_to_many or f.one_to_one)
    }
    assert pointing == handled, f"Update apps/exercises/deletion.py for: {pointing - handled}"
