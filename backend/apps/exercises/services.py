"""A gym's exercise library, categories, tags and tracked lifts: the rules for changing
them. Views and (from sub-project 2) the API call these.

Names are tidied (trimmed, single-spaced) and unique within the gym regardless of case.
Exercises are archived rather than deleted (deletion of archived ones is in deletion.py).
"""

from django.db import transaction
from django.db.models import Max, Q
from django.db.models.functions import Lower

from apps.core import errors, ids

from .models import MAX_TRACKED_LIFTS, TAG_MAX_LENGTH, Category, Exercise, Measure, Tag, TrackedLift

CATEGORY_NAME_LENGTH = Category._meta.get_field("name").max_length
TAG_NAME_LENGTH = TAG_MAX_LENGTH
EXERCISE_NAME_LENGTH = Exercise._meta.get_field("name").max_length


class InvalidName(errors.Invalid):
    """With the message to show."""


class InvalidExercise(errors.Invalid):
    """With the field it's about (`field`) and the message to show."""

    def __init__(self, field, message):
        super().__init__(message)
        self.field = field


class NeedsTarget(errors.Invalid):
    """A category with exercises can only be deleted once they have somewhere to go."""


class TrackingRefused(errors.Invalid):
    """With the message to show."""


# ---------------------------------------------------------------- names


def clean_label(value, max_length, what):
    """Trimmed, single-spaced, not empty, not too long."""
    value = " ".join((value or "").split())
    if not value:
        raise InvalidName(f"Give the {what} a name.")
    if len(value) > max_length:
        raise InvalidName(f"Keep {what} names to {max_length} characters.")
    return value


def check_name(model, gym, name, max_length, what, instance=None):
    """A tidied name no other `model` row of the gym has (ignoring case)."""
    name = clean_label(name, max_length, what)
    clash = model.objects.filter(gym=gym, name__iexact=name)
    if instance is not None:
        clash = clash.exclude(pk=instance.pk)
    if clash.exists():
        raise InvalidName(f"You already have a {what} called “{name}”.")
    return name


def save_pending_names(model, gym, post, max_length):
    """Editors send every row's on-screen name as name_<id> with each request. Save valid,
    changed ones before acting, so an edit followed quickly by a click (move, delete, add) is
    never lost, whatever order the requests arrive in. Invalid names are skipped here; the
    row's own save reports them."""
    rows = {obj.pk: obj for obj in model.objects.filter(gym=gym)}
    for key, raw in post.items():
        pk = ids.parse(key[5:]) if key.startswith("name_") else None
        if pk not in rows:
            continue
        obj = rows[pk]
        name = " ".join(raw.split())
        if not name or len(name) > max_length or name == obj.name:
            continue
        if model.objects.filter(gym=gym, name__iexact=name).exclude(pk=obj.pk).exists():
            continue
        obj.name = name
        obj.save(update_fields=["name"])


def move_in_order(rows, pk, direction):
    """Swap one row of an ordered list with its neighbour and renumber. ValueError if the row
    isn't in the list or the direction isn't up/down."""
    if direction not in ("up", "down"):
        raise errors.Invalid(f"Move up or down, not {direction!r}.")
    ids = [r.pk for r in rows]
    i = ids.index(pk)
    j = i - 1 if direction == "up" else i + 1
    if 0 <= j < len(rows):
        rows[i], rows[j] = rows[j], rows[i]
        for order, row in enumerate(rows):
            if row.order != order:
                row.order = order
                row.save(update_fields=["order"])


# ---------------------------------------------------------------- exercises


def search(gym, q="", tag_ids=(), archived=False):
    """(exercises, tags): the library filtered by text (name, tag, cue, category) and by
    every tag given, archived ones only if asked; in category order, then by name."""
    tags = list(Tag.objects.filter(gym=gym, pk__in=[pk for t in tag_ids if (pk := ids.parse(t))]))
    exercises = (
        Exercise.objects.filter(gym=gym, archived=archived)
        .select_related("percent_of", "category")
        .prefetch_related("tags")
    )
    q = (q or "").strip()
    if q:
        exercises = exercises.filter(
            Q(name__icontains=q)
            | Q(tags__name__icontains=q)
            | Q(cue__icontains=q)
            | Q(category__name__icontains=q)
        ).distinct()
    for tag in tags:
        exercises = exercises.filter(tags=tag)
    return exercises.order_by("category__order", "name"), tags


def percent_of_choices(gym, exercise=None):
    """Lifts a percentage can be worked from: the gym's active "base" lifts (ones with their
    own max), not the exercise itself."""
    base = Exercise.objects.filter(gym=gym, archived=False, percent_of__isnull=True)
    if exercise is not None and exercise.pk:
        base = base.exclude(pk=exercise.pk)
    return base.order_by("name")


def check_exercise_name(gym, name, exercise=None):
    name = " ".join((name or "").split())
    if not name:
        raise InvalidExercise("name", "Give the exercise a name.")
    if len(name) > EXERCISE_NAME_LENGTH:
        raise InvalidExercise("name", f"Keep exercise names to {EXERCISE_NAME_LENGTH} characters.")
    clash = Exercise.objects.filter(gym=gym, name__iexact=name)
    if exercise is not None and exercise.pk:
        clash = clash.exclude(pk=exercise.pk)
    if clash.exists():
        raise InvalidExercise(
            "name",
            "An archived exercise already has this name. Restore it instead."
            if clash.first().archived
            else "Your library already has an exercise with this name.",
        )
    return name


def check_percent_of(gym, exercise, target):
    """`target` must be one of the gym's base lifts; an exercise others take percentages from
    must keep its own max."""
    if target is None:
        return None
    if not percent_of_choices(gym, exercise).filter(pk=target.pk).exists():
        raise InvalidExercise("percent_of", "Pick one of your library's lifts with its own max.")
    if exercise is not None and exercise.pk and Exercise.objects.filter(percent_of=exercise).exists():
        raise InvalidExercise(
            "percent_of", "Other exercises take their percentages from this one, so it must keep its own max."
        )
    return target


def check_link(url):
    """A demo link: http(s) only (never javascript: and the like); "youtube.com/…" gets
    https:// in front. Blank is fine."""
    from django.core.exceptions import ValidationError
    from django.core.validators import URLValidator

    url = (url or "").strip()
    if not url:
        return ""
    if "://" not in url:
        url = "https://" + url
    try:
        URLValidator(schemes=["http", "https"])(url)
    except ValidationError:
        raise InvalidExercise("youtube_url", "Enter a full link, like https://youtube.com/…") from None
    return url


@transaction.atomic
def save_exercise(
    gym,
    *,
    exercise=None,
    name,
    category,
    measure=Measure.REPS,
    percent_of=None,
    tags=(),
    youtube_url="",
    cue="",
    warmup=False,
):
    """Create (no `exercise`) or update one of the gym's exercises."""
    name = check_exercise_name(gym, name, exercise)
    if category is None or category.gym_id != gym.pk:
        raise InvalidExercise("category", "Pick one of your categories.")
    if measure not in Measure.values:
        raise InvalidExercise("measure", "Pick how it's measured.")
    percent_of = check_percent_of(gym, exercise, percent_of)
    youtube_url = check_link(youtube_url)
    tags = list(tags)
    if any(t.gym_id != gym.pk for t in tags):
        raise InvalidExercise("tags", "Pick from your own tags.")
    exercise = exercise or Exercise(gym=gym)
    exercise.gym = gym
    exercise.name, exercise.category, exercise.measure = name, category, measure
    exercise.percent_of, exercise.youtube_url = percent_of, youtube_url or ""
    exercise.cue, exercise.warmup = (cue or "").strip(), bool(warmup)
    exercise.save()
    exercise.tags.set(tags)
    return exercise


@transaction.atomic
def archive(exercise):
    """Archive an exercise; it stops being tracked. Returns (was_tracked, how many active
    exercises still take percentages from it)."""
    users = Exercise.objects.filter(percent_of=exercise, archived=False).count()
    was_tracked = TrackedLift.objects.filter(exercise=exercise).exists()
    exercise.archived = True
    exercise.save(update_fields=["archived"])
    TrackedLift.objects.filter(exercise=exercise).delete()
    return was_tracked, users


def restore(exercise):
    """Back in the library (it isn't tracked again automatically)."""
    exercise.archived = False
    exercise.save(update_fields=["archived"])
    return exercise


# ---------------------------------------------------------------- categories and tags


def add_category(gym, name):
    name = check_name(Category, gym, name, CATEGORY_NAME_LENGTH, "category")
    order = (Category.objects.filter(gym=gym).aggregate(m=Max("order"))["m"] or 0) + 1
    return Category.objects.create(gym=gym, name=name, order=order)


def rename_category(category, name):
    category.name = check_name(Category, category.gym, name, CATEGORY_NAME_LENGTH, "category", category)
    category.save(update_fields=["name"])
    return category


@transaction.atomic
def move_category(gym, pk, direction):
    move_in_order(list(Category.objects.select_for_update().filter(gym=gym)), pk, direction)


@transaction.atomic
def delete_category(category, move_to=None):
    """Delete a category. Its exercises (archived ones too) move to `move_to`, another of the
    gym's categories, first; NeedsTarget if it has exercises and there's nowhere to go.
    Returns how many exercises moved."""
    count = category.exercises.count()
    if count:
        if move_to is None or move_to.gym_id != category.gym_id or move_to.pk == category.pk:
            raise NeedsTarget()
        category.exercises.update(category=move_to)
    category.delete()
    return count


def add_tag(gym, name):
    return Tag.objects.create(gym=gym, name=check_name(Tag, gym, name, TAG_NAME_LENGTH, "tag"))


def rename_tag(tag, name):
    tag.name = check_name(Tag, tag.gym, name, TAG_NAME_LENGTH, "tag", tag)
    tag.save(update_fields=["name"])
    return tag


def delete_tag(tag):
    """Delete a tag (the exercises stay); returns how many exercises had it."""
    count = tag.exercises.count()
    tag.delete()
    return count


def tags_for(gym):
    return Tag.objects.filter(gym=gym).order_by(Lower("name"))


# ---------------------------------------------------------------- tracked lifts


def trackable(gym):
    """Exercises a gym could add: its own, active, rep-measured, not already tracked."""
    return (
        Exercise.objects.filter(gym=gym, archived=False, measure=Measure.REPS)
        .exclude(tracked_by__gym=gym)
        .order_by("name")
    )


@transaction.atomic
def track(gym, exercise_id):
    """Add a lift to the gym's tracked lifts (at most MAX_TRACKED_LIFTS), at the end."""
    current = TrackedLift.objects.select_for_update().filter(gym=gym)
    if current.count() >= MAX_TRACKED_LIFTS:
        raise TrackingRefused(f"Track up to {MAX_TRACKED_LIFTS} lifts")
    pk = ids.parse(exercise_id)
    exercise = trackable(gym).filter(pk=pk).first() if pk else None
    if exercise is None:
        raise TrackingRefused("Pick a lift to track")
    next_order = (current.aggregate(m=Max("order"))["m"] or 0) + 1
    return TrackedLift.objects.create(gym=gym, exercise=exercise, order=next_order)


def untrack(tracked):
    """Stop tracking; maxes already recorded stay in each athlete's history."""
    tracked.delete()


@transaction.atomic
def move_tracked(gym, pk, direction):
    move_in_order(list(TrackedLift.objects.select_for_update().filter(gym=gym)), pk, direction)
