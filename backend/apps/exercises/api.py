"""The gym's exercise library, categories and tags (/api/v1/exercises, /categories, /tags),
shared by the gym's coaches. Everything is looked up within the coach's gym, so another
gym's is a 404. The rules are in services.py and deletion.py."""

import uuid

from ninja import Query, Router, Schema, Status

from apps.api.main import coach_of
from apps.core import errors

from . import deletion, services
from .models import Category, Exercise, Tag, TrackedLift

router = Router(tags=["Exercise library"])


class Ref(Schema):
    id: uuid.UUID
    name: str


class ExerciseOut(Schema):
    id: uuid.UUID
    name: str
    category: Ref
    measure: str  # reps, time, distance
    tags: list[Ref]
    percent_of: Ref | None  # the lift percentages are worked from; null: its own max
    youtube_url: str
    cue: str
    warmup: bool
    archived: bool
    tracked: bool


class ExerciseIn(Schema):
    name: str
    category_id: uuid.UUID
    measure: str = "reps"
    percent_of_id: uuid.UUID | None = None
    tag_ids: list[uuid.UUID] = []
    youtube_url: str = ""
    cue: str = ""
    warmup: bool = False


def _ref(obj):
    return {"id": obj.pk, "name": obj.name} if obj else None


def _exercise(e, tracked):
    return {
        "id": e.pk,
        "name": e.name,
        "category": _ref(e.category),
        "measure": e.measure,
        "tags": [_ref(t) for t in e.tags.all()],
        "percent_of": _ref(e.percent_of),
        "youtube_url": e.youtube_url,
        "cue": e.cue,
        "warmup": e.warmup,
        "archived": e.archived,
        "tracked": e.pk in tracked,
    }


def _tracked(gym):
    return set(TrackedLift.objects.filter(gym=gym).values_list("exercise_id", flat=True))


def _gym_exercise(gym, exercise_id):
    return Exercise.objects.select_related("category", "percent_of").get(pk=exercise_id, gym=gym)


def _fields(gym, data):
    """The service's arguments from the body, looked up in the gym (unknown ids refused)."""
    category = Category.objects.filter(gym=gym, pk=data.category_id).first()
    percent_of = None
    if data.percent_of_id:
        percent_of = Exercise.objects.filter(gym=gym, pk=data.percent_of_id).first()
        if percent_of is None:
            raise errors.Invalid({"percent_of_id": "Pick one of your lifts."})
    tags = list(Tag.objects.filter(gym=gym, pk__in=data.tag_ids))
    if len(tags) != len(set(data.tag_ids)):
        raise errors.Invalid({"tag_ids": "Pick from your own tags."})
    return {
        "name": data.name,
        "category": category,
        "measure": data.measure,
        "percent_of": percent_of,
        "tags": tags,
        "youtube_url": data.youtube_url,
        "cue": data.cue,
        "warmup": data.warmup,
    }


@router.get("/exercises", response=list[ExerciseOut])
def exercises(request, q: str = "", tags: list[uuid.UUID] = Query([]), archived: bool = False):
    """The library, by category then name: search by name, tag, cue or category, and filter
    by every tag given. `archived` lists the archived ones instead."""
    gym = coach_of(request).gym
    found, _tags = services.search(gym, q, tags, archived)
    tracked = _tracked(gym)
    return [_exercise(e, tracked) for e in found]


@router.get("/exercises/{exercise_id}", response=ExerciseOut)
def exercise(request, exercise_id: uuid.UUID):
    gym = coach_of(request).gym
    return _exercise(_gym_exercise(gym, exercise_id), _tracked(gym))


@router.post("/exercises", response={201: ExerciseOut})
def create(request, data: ExerciseIn):
    gym = coach_of(request).gym
    return Status(201, _exercise(services.save_exercise(gym, **_fields(gym, data)), _tracked(gym)))


@router.put("/exercises/{exercise_id}", response=ExerciseOut)
def update(request, exercise_id: uuid.UUID, data: ExerciseIn):
    gym = coach_of(request).gym
    exercise = _gym_exercise(gym, exercise_id)
    return _exercise(services.save_exercise(gym, exercise=exercise, **_fields(gym, data)), _tracked(gym))


@router.get("/exercises/{exercise_id}/percent-of", response=list[Ref])
def percent_of_choices(request, exercise_id: uuid.UUID):
    """The lifts this exercise's percentages could be worked from."""
    gym = coach_of(request).gym
    return [_ref(e) for e in services.percent_of_choices(gym, _gym_exercise(gym, exercise_id))]


class Archived(Schema):
    was_tracked: bool
    percent_users: int  # active exercises still working percentages from it


@router.post("/exercises/{exercise_id}/archive", response=Archived)
def archive(request, exercise_id: uuid.UUID):
    was_tracked, users = services.archive(_gym_exercise(coach_of(request).gym, exercise_id))
    return {"was_tracked": was_tracked, "percent_users": users}


@router.post("/exercises/{exercise_id}/restore", response={204: None})
def restore(request, exercise_id: uuid.UUID):
    services.restore(_gym_exercise(coach_of(request).gym, exercise_id))
    return Status(204, None)


class Impact(Schema):
    slots_removed: int
    slots_redefaulted: int
    templates: list[str]
    logged: int
    logged_by: list[str]
    max_entries: int
    athletes: list[str]
    prescriptions: int
    programmed_for: list[str]
    dependents: list[str]


@router.get("/exercises/{exercise_id}/deletion", response=Impact)
def deletion_impact(request, exercise_id: uuid.UUID):
    """What deleting it would remove or change, for the warning (archived exercises only)."""
    exercise = _gym_exercise(coach_of(request).gym, exercise_id)
    deletion.check_deletable(exercise)
    return deletion.deletion_impact(exercise)


@router.delete("/exercises/{exercise_id}", response=Impact)
def delete(request, exercise_id: uuid.UUID):
    """Delete an archived exercise; logged sessions keep its name and sets."""
    return deletion.delete_exercise(_gym_exercise(coach_of(request).gym, exercise_id))


# ---------------------------------------------------------------- categories and tags


class Name(Schema):
    name: str


class Direction(Schema):
    direction: str  # up, down


class CategoryOut(Schema):
    id: uuid.UUID
    name: str
    exercises: int


class DeleteCategory(Schema):
    move_to_id: uuid.UUID | None = None  # where its exercises go; needed if it has any


def _categories(gym):
    from django.db.models import Count

    return [
        {"id": c.pk, "name": c.name, "exercises": c.n}
        # Explicit order: a model's default ordering is ignored on a GROUP BY query.
        for c in Category.objects.filter(gym=gym).annotate(n=Count("exercises")).order_by("order", "id")
    ]


@router.get("/categories", response=list[CategoryOut])
def categories(request):
    return _categories(coach_of(request).gym)


@router.post("/categories", response={201: list[CategoryOut]})
def add_category(request, data: Name):
    gym = coach_of(request).gym
    services.add_category(gym, data.name)
    return Status(201, _categories(gym))


@router.patch("/categories/{category_id}", response=list[CategoryOut])
def rename_category(request, category_id: uuid.UUID, data: Name):
    gym = coach_of(request).gym
    services.rename_category(Category.objects.get(pk=category_id, gym=gym), data.name)
    return _categories(gym)


@router.post("/categories/{category_id}/move", response=list[CategoryOut])
def move_category(request, category_id: uuid.UUID, data: Direction):
    gym = coach_of(request).gym
    services.move_category(gym, Category.objects.get(pk=category_id, gym=gym).pk, data.direction)
    return _categories(gym)


@router.post("/categories/{category_id}/delete", response=list[CategoryOut])
def delete_category(request, category_id: uuid.UUID, data: DeleteCategory):
    """Delete a category; its exercises move to `move_to_id` first (409 if it has some and
    there's nowhere to go)."""
    gym = coach_of(request).gym
    category = Category.objects.get(pk=category_id, gym=gym)
    move_to = Category.objects.filter(pk=data.move_to_id, gym=gym).first() if data.move_to_id else None
    services.delete_category(category, move_to)
    return _categories(gym)


class TagOut(Schema):
    id: uuid.UUID
    name: str


@router.get("/tags", response=list[TagOut])
def tags(request):
    return [_ref(t) for t in services.tags_for(coach_of(request).gym)]


@router.post("/tags", response={201: TagOut})
def add_tag(request, data: Name):
    return Status(201, _ref(services.add_tag(coach_of(request).gym, data.name)))


@router.patch("/tags/{tag_id}", response=TagOut)
def rename_tag(request, tag_id: uuid.UUID, data: Name):
    gym = coach_of(request).gym
    return _ref(services.rename_tag(Tag.objects.get(pk=tag_id, gym=gym), data.name))


@router.delete("/tags/{tag_id}", response={204: None})
def delete_tag(request, tag_id: uuid.UUID):
    services.delete_tag(Tag.objects.get(pk=tag_id, gym=coach_of(request).gym))
    return Status(204, None)
