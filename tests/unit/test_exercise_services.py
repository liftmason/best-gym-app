"""The library's rules (apps/exercises/services.py), tested directly: exercises, categories,
tags and tracked lifts."""

import pytest

from apps.exercises import services
from apps.exercises.models import Category, Exercise, Tag, TrackedLift

from ..conftest import cat, ex
from ..factories import GymFactory

pytestmark = pytest.mark.django_db


def new(gym, name="Tall Snatch", **fields):
    return services.save_exercise(
        gym, name=name, category=fields.pop("category", cat(gym, "snatch")), **fields
    )


# ---------------------------------------------------------------- exercises


def test_names_are_tidied_and_unique_ignoring_case(gym):
    exercise = new(gym, "  Tall   Snatch ")
    assert exercise.name == "Tall Snatch"
    with pytest.raises(services.InvalidExercise, match="already has an exercise"):
        new(gym, "tall snatch")
    services.archive(exercise)
    with pytest.raises(services.InvalidExercise, match="Restore it instead"):
        new(gym, "TALL SNATCH")
    assert new(GymFactory(pack="weightlifting"), "Tall Snatch")  # another gym's library is separate


def test_everything_must_be_the_gyms_own(gym):
    other = GymFactory(pack="weightlifting")
    with pytest.raises(services.InvalidExercise):
        new(gym, category=Category.objects.filter(gym=other).first())
    with pytest.raises(services.InvalidExercise):
        new(gym, tags=[Tag.objects.filter(gym=other).first()])
    with pytest.raises(services.InvalidExercise):
        new(gym, percent_of=ex(other, "sn"))


def test_percentages_come_from_base_lifts(gym):
    power = new(gym, "Power Snatch from Blocks", percent_of=ex(gym, "sn"))
    with pytest.raises(services.InvalidExercise):
        new(gym, "Hang Tall Snatch", percent_of=power)  # power itself takes its % from the snatch
    with pytest.raises(services.InvalidExercise, match="must keep its own max"):
        services.save_exercise(
            gym, exercise=ex(gym, "sn"), name="Snatch", category=cat(gym, "snatch"), percent_of=ex(gym, "cj")
        )
    assert ex(gym, "sn") not in services.percent_of_choices(gym, ex(gym, "sn"))


def test_saving_sets_every_field_and_tags(gym):
    tag = Tag.objects.filter(gym=gym).first()
    exercise = new(
        gym, measure="time", tags=[tag], youtube_url="https://youtu.be/x", cue=" Fast ", warmup=True
    )
    exercise.refresh_from_db()
    assert (exercise.measure, exercise.cue, exercise.warmup) == ("time", "Fast", True)
    assert list(exercise.tags.all()) == [tag]


def test_archiving_untracks_and_counts_dependants(gym):
    before = Exercise.objects.filter(percent_of=ex(gym, "sn"), archived=False).count()
    new(gym, "Snatch High Pull", percent_of=ex(gym, "sn"))
    was_tracked, users = services.archive(ex(gym, "sn"))
    assert was_tracked and users == before + 1
    assert not TrackedLift.objects.filter(exercise=ex(gym, "sn")).exists()
    services.restore(ex(gym, "sn"))
    assert not ex(gym, "sn").archived
    assert not TrackedLift.objects.filter(exercise=ex(gym, "sn")).exists()  # not re-tracked


def test_search(gym):
    tag = Tag.objects.get(gym=gym, name="overhead")
    tagged, tags = services.search(gym, tag_ids=[str(tag.pk), "junk"])
    assert tags == [tag] and tagged and all(tag in e.tags.all() for e in tagged)
    named, _ = services.search(gym, "pendlay")
    assert [e.key for e in named] == ["row"]
    services.archive(ex(gym, "sn"))
    assert ex(gym, "sn") in services.search(gym, archived=True)[0]
    assert ex(gym, "sn") not in services.search(gym)[0]


# ---------------------------------------------------------------- categories and tags


def test_categories(gym):
    olympic = services.add_category(gym, "  Olympic   extras ")
    assert olympic.name == "Olympic extras" and list(Category.objects.filter(gym=gym))[-1] == olympic
    with pytest.raises(services.InvalidName):
        services.add_category(gym, "olympic EXTRAS")
    with pytest.raises(services.InvalidName):
        services.add_category(gym, "   ")
    services.rename_category(olympic, "Extras")
    services.move_category(gym, olympic.pk, "up")
    assert list(Category.objects.filter(gym=gym))[-2] == olympic
    with pytest.raises(ValueError):
        services.move_category(gym, olympic.pk, "sideways")


def test_deleting_a_category_moves_its_exercises_first(gym):
    snatch, accessory = cat(gym, "snatch"), cat(gym, "accessory")
    count = snatch.exercises.count()
    with pytest.raises(services.NeedsTarget):
        services.delete_category(snatch)
    with pytest.raises(services.NeedsTarget):
        services.delete_category(snatch, snatch)
    assert services.delete_category(snatch, accessory) == count
    assert ex(gym, "sn").category == accessory
    empty = services.add_category(gym, "Empty")
    assert services.delete_category(empty) == 0


def test_tags(gym):
    tag = services.add_tag(gym, "explosive")
    with pytest.raises(services.InvalidName):
        services.add_tag(gym, "x" * 25)
    services.rename_tag(tag, "Explosive")
    ex(gym, "sn").tags.add(tag)
    assert services.delete_tag(tag) == 1
    assert Exercise.objects.filter(pk=ex(gym, "sn").pk).exists()


def test_pending_names_save_only_valid_changes(gym):
    a, b = services.add_category(gym, "Alpha"), services.add_category(gym, "Beta")
    services.save_pending_names(Category, gym, {f"name_{a.pk}": " Gamma ", f"name_{b.pk}": "gamma"}, 40)
    a.refresh_from_db()
    b.refresh_from_db()
    assert (a.name, b.name) == ("Gamma", "Beta")  # b's clash is skipped


# ---------------------------------------------------------------- tracked lifts


def test_tracking(gym):
    assert ex(gym, "sn") not in services.trackable(gym)  # already tracked in the weightlifting pack
    tracked = services.track(gym, ex(gym, "fsq").pk)
    assert list(TrackedLift.objects.filter(gym=gym))[-1] == tracked  # added last
    with pytest.raises(services.TrackingRefused, match="Pick a lift"):
        services.track(gym, ex(gym, "fsq").pk)  # already tracked
    with pytest.raises(services.TrackingRefused, match="Pick a lift"):
        services.track(gym, ex(gym, "bike").pk)  # measured by time
    for key in ("pp", "sp"):
        services.track(gym, ex(gym, key).pk)
    with pytest.raises(services.TrackingRefused, match="Track up to 6"):
        services.track(gym, ex(gym, "rdl").pk)
    services.move_tracked(gym, tracked.pk, "up")
    services.untrack(tracked)
    assert ex(gym, "fsq") in services.trackable(gym)
