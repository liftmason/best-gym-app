import uuid

from django.db import models


def fill_scope(objs):
    """Set each row's owner column (`athlete` or `gym`) from its parent row, or check it
    matches. Rows are synced to phones by owner (sub-project 3's change log), so a row
    whose owner disagrees with its parent's would reach the wrong person: that raises.
    One query per parent table for parents that aren't loaded."""
    objs = [o for o in objs if o.scope]
    if not objs:
        return
    field, parent = objs[0].scope
    parent_field = objs[0]._meta.get_field(parent)
    missing = {
        getattr(o, parent_field.attname)
        for o in objs
        if not parent_field.is_cached(o) and getattr(o, parent_field.attname) is not None
    }
    owners = dict(
        parent_field.related_model._base_manager.filter(pk__in=missing).values_list("pk", f"{field}_id")
    )
    for o in objs:
        if parent_field.is_cached(o):
            expected = getattr(getattr(o, parent), f"{field}_id")
        else:
            expected = owners.get(getattr(o, parent_field.attname))
        current = getattr(o, f"{field}_id")
        if current is None:
            setattr(o, f"{field}_id", expected)
        elif current != expected:
            raise ValueError(f"{type(o).__name__}.{field} doesn't match its {parent}'s")


class QuerySet(models.QuerySet):
    def bulk_create(self, objs, *args, **kwargs):
        objs = list(objs)
        fill_scope(objs)
        return super().bulk_create(objs, *args, **kwargs)


class Model(models.Model):
    """Base for every table. Ids are UUIDv7: made on the phone as well as the server
    (offline sync), and time-ordered, so they index as well as integers.

    A synced row below the top of its tree names where its owner comes from:
    `scope = ("athlete", "program")` copies `program.athlete` into this row's `athlete`
    on save and in bulk_create (which is also how many-to-many rows are added), so every
    synced table carries its owner without joins (apps/core/sync.py lists them)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)

    scope = None

    objects = QuerySet.as_manager()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        fill_scope([self])
        super().save(*args, **kwargs)


def lock(obj):
    """Lock `obj`'s row until the transaction ends (SELECT … FOR UPDATE), so a second
    request doing the same thing waits and then sees the first one's result. Call inside
    transaction.atomic."""
    type(obj)._base_manager.select_for_update().filter(pk=obj.pk).values_list("pk", flat=True).get()


def check_same_gym(gym_id, **refs):
    """ValidationError naming each referenced row (exercise, tag, week type…) that belongs to
    another gym than `gym_id`. For models' clean(); the services refuse the same things."""
    from django.core.exceptions import ValidationError

    wrong = {
        name: "Pick one of this gym's."
        for name, obj in refs.items()
        if obj is not None and obj.gym_id != gym_id
    }
    if wrong:
        raise ValidationError(wrong)


def athlete_column():
    """The owner column of a synced training row, filled from its parent (see `scope`)."""
    return models.ForeignKey("accounts.Athlete", on_delete=models.PROTECT, related_name="+", editable=False)


def gym_column():
    """The owner column of a gym's library row, filled from its parent (see `scope`)."""
    return models.ForeignKey("accounts.Gym", on_delete=models.CASCADE, related_name="+", editable=False)
