"""A gym's own week types (name, description, colour, order), edited in Settings.

A week type that anything uses (program weeks, template weeks, session logs) is archived
instead of deleted, so past weeks keep their label and colour. "In use" is worked out from
every model that points at WeekType, so new ones are covered automatically."""

from django.db import transaction
from django.db.models import Max

from apps.core import errors
from apps.exercises import services as library

from .models import HEX_COLOUR, WeekType

NAME_LENGTH = WeekType._meta.get_field("name").max_length
DESCRIPTION_LENGTH = WeekType._meta.get_field("description").max_length
DEFAULT_COLOUR = "#6B7280"


class InvalidWeekType(errors.Invalid):
    """With the message to show."""


def usage_count(week_type):
    """How many rows anywhere point at this week type."""
    total = 0
    for rel in WeekType._meta.get_fields(include_hidden=True):
        if rel.auto_created and not rel.concrete and (rel.one_to_many or rel.one_to_one):
            total += rel.related_model._base_manager.filter(**{rel.field.name: week_type}).count()
    return total


def colour(value):
    """ "#RRGGBB" in capitals, or None if it isn't one."""
    value = (value or "").strip().upper()
    return value if HEX_COLOUR.fullmatch(value) else None


def _name(gym, name, instance=None):
    try:
        return library.check_name(WeekType, gym, name, NAME_LENGTH, "week type", instance)
    except library.InvalidName as err:
        raise InvalidWeekType(str(err)) from None


def _description(value):
    description = " ".join((value or "").split())
    if len(description) > DESCRIPTION_LENGTH:
        raise InvalidWeekType(f"Keep descriptions to {DESCRIPTION_LENGTH} characters.")
    return description


def add(gym, name, colour_value=None):
    name = _name(gym, name)
    order = (WeekType.objects.filter(gym=gym).aggregate(m=Max("order"))["m"] or 0) + 1
    return WeekType.objects.create(
        gym=gym, name=name, colour=colour(colour_value) or DEFAULT_COLOUR, order=order
    )


def update(week_type, *, name, colour_value, description):
    """Name, colour and description together; InvalidWeekType names the first problem."""
    name = _name(week_type.gym, name, week_type)
    checked = colour(colour_value)
    if checked is None:
        raise InvalidWeekType("Pick a colour like #2E9E5B")
    week_type.name, week_type.colour, week_type.description = name, checked, _description(description)
    week_type.save(update_fields=["name", "colour", "description"])
    return week_type


def save_pending_edits(gym, post):
    """The card sends each row's on-screen name, description and colour (name_<id>,
    description_<id>, colour_<id>) with every request. Save valid changes before acting."""
    library.save_pending_names(WeekType, gym, post, NAME_LENGTH)
    for wt in WeekType.objects.filter(gym=gym):
        changed = []
        checked = colour(post.get(f"colour_{wt.pk}"))
        if checked and checked != wt.colour:
            wt.colour = checked
            changed.append("colour")
        if f"description_{wt.pk}" in post:
            description = " ".join(post[f"description_{wt.pk}"].split())
            if len(description) <= DESCRIPTION_LENGTH and description != wt.description:
                wt.description = description
                changed.append("description")
        if changed:
            wt.save(update_fields=changed)


@transaction.atomic
def move(gym, pk, direction):
    """Swap an active week type with its neighbour. ValueError if it isn't one."""
    library.move_in_order(
        list(WeekType.objects.select_for_update().filter(gym=gym, archived=False)), pk, direction
    )


def remove(week_type):
    """Archive it if anything uses it (returns how many uses), otherwise delete it (returns 0)."""
    uses = usage_count(week_type)
    if uses:
        week_type.archived = True
        week_type.save(update_fields=["archived"])
    else:
        week_type.delete()
    return uses


def restore(week_type):
    """Back in the pickers, at the end of the order."""
    week_type.archived = False
    week_type.order = (
        WeekType.objects.filter(gym=week_type.gym, archived=False).aggregate(m=Max("order"))["m"] or 0
    ) + 1
    week_type.save(update_fields=["archived", "order"])
    return week_type
