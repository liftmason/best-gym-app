"""Starter packs, per-gym categories and tags, and per-gym week types."""

import pytest

from apps.exercises.models import Exercise, tracked_exercises
from apps.exercises.starter import install_pack
from apps.programs import week_types

from ..conftest import PASSWORD, tag_ids

pytestmark = pytest.mark.django_db
HX = {"HTTP_HX_REQUEST": "true"}


# ---------------------------------------------------------------- starter packs


def signup(client, starter, email="s@example.com"):
    return client.post(
        "/accounts/signup/",
        {
            "name": "Sam",
            "email": email,
            "password": PASSWORD,
            "gym_name": f"{starter} gym",
            "units": "kg",
            "starter": starter,
            "browser_timezone": "UTC",
        },
    )


def test_packs_install_on_top_of_each_other_without_duplicates(gym):
    install_pack(gym, "general")  # the fixture gym already has weightlifting
    names = [c.name.lower() for c in gym.categories.all()]
    assert len(names) == len(set(names))  # "Squat", "Pull"... not duplicated
    assert Exercise.objects.filter(gym=gym, name="Back Squat").count() == 1  # same name: kept, not duplicated
    assert Exercise.objects.filter(gym=gym, name="Bench Press").exists()  # new ones added
    assert [e.name for e in tracked_exercises(gym)] == ["Snatch", "Clean & Jerk", "Back Squat"]  # list kept


# ---------------------------------------------------------------- categories


BASE = "/coach/programming/"


# ---------------------------------------------------------------- tags


# ---------------------------------------------------------------- week types


WT = "/coach/settings/week-types/"


def test_usage_count_sees_every_model_pointing_at_week_types(gym):
    """Guard for phase 3: usage_count() discovers users of WeekType itself, so new
    foreign keys (program weeks, template weeks, session logs) are counted without code changes."""
    assert week_types.usage_count(gym.week_types.first()) == 0


# ---------------------------------------------------------------- edit-then-click never loses the edit


def test_tag_ids_helper(gym):
    assert len(tag_ids(gym, "speed", "strength")) == 2
