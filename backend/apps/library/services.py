"""Changes to templates, saved weeks and saved sessions. Views stay thin.

Copying is the heart of it: weeks, sessions and slots are copied (never shared)
between templates, the library and athletes' programs, so editing one never changes
another. `copy_dose` moves every PrescriptionBase field, the per-set overrides and
the tags between a Prescription and a TemplateSlot, in either direction; `copy_doses`
does a batch in three queries (audit M15).
"""

import uuid
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import F, Max

from apps.core import errors
from apps.programs.models import LoadBasis, WeekType
from apps.programs.prescriptions import COPIED_FIELDS, keep_warmups_first, new_dose

from .models import (
    SlotKind,
    Template,
    TemplateHabit,
    TemplateKind,
    TemplateSession,
    TemplateSlot,
    TemplateWeek,
)


class InvalidTemplate(errors.Invalid):
    """With the message to show."""


STARTER_SESSIONS = {TemplateKind.PROGRAM: 3, TemplateKind.WEEK: 2, TemplateKind.SESSION: 1}


def session_letter(n):
    return f"Session {chr(65 + n)}" if n < 26 else f"Session {n + 1}"


def default_week_type(gym):
    return WeekType.objects.active().filter(gym=gym).first() or WeekType.objects.filter(gym=gym).first()


# ---------------------------------------------------------------- copying doses


def bump(value, basis, points):
    """A percentage load raised by `points` (e.g. +2.5); other loads are unchanged."""
    if not points or value is None or basis != LoadBasis.PERCENT:
        return value
    return max(Decimal("1"), Decimal(value) + Decimal(points))


def copy_doses(pairs, points=None):
    """Copy every dose field and the per-set overrides from each `src` onto its `dst`, and
    save the lot: one query for the rows and one for their overrides. `pairs` is
    [(src, dst)], every `dst` a new row of one model with its parent and exercise set.
    `points` bumps percentage loads. Prefetch the sources' set_overrides."""
    if not pairs:
        return []
    for src, dst in pairs:
        for field in COPIED_FIELDS:
            setattr(dst, field, getattr(src, field))
        dst.load_value = bump(dst.load_value, dst.load_basis, points)
        dst.pk, dst._state.adding = uuid.uuid7(), True  # always a new row
    model = type(pairs[0][1])
    model.objects.bulk_create([dst for _src, dst in pairs])
    rel = model._meta.get_field("set_overrides")
    overrides = rel.related_model
    overrides.objects.bulk_create(
        [
            overrides(
                **{rel.field.name: dst},
                set_number=s.set_number,
                rep_scheme=s.rep_scheme,
                reps=s.reps,
                load_value=bump(s.load_value, src.load_basis, points),
            )
            for src, dst in pairs
            for s in src.set_overrides.all()
        ]
    )
    return [dst for _src, dst in pairs]


def copy_dose(src, dst, points=None):
    """copy_doses for one row."""
    return copy_doses([(src, dst)], points)[0]


def add_tags(field, rows_tags):
    """Tag new rows in one query: `field` is the tags field (TemplateSlot.tags or
    Prescription.tag_slot_tags), `rows_tags` [(row, tags)]."""
    through = field.remote_field.through
    row_name, tag_name = field.m2m_field_name(), field.m2m_reverse_field_name()
    through.objects.bulk_create(
        [through(**{row_name: row, tag_name: tag}) for row, tags in rows_tags for tag in tags]
    )


def _src_tags(src):
    return list(src.tags.all()) if isinstance(src, TemplateSlot) else list(src.tag_slot_tags.all())


def _items(src):
    """A template or program session's slots or prescriptions, with what copying reads."""
    if isinstance(src, TemplateSession):
        return src.slots.prefetch_related("tags", "set_overrides")
    return src.prescriptions.prefetch_related("tag_slot_tags", "set_overrides")


def slots_from(items, session, points=None):
    """TemplateSlots copied from slots or program prescriptions (tag slots stay tag slots)."""
    pairs, tagged = [], []
    for i, src in enumerate(items):
        tags = _src_tags(src)
        kind = SlotKind.TAG if tags else SlotKind.EXERCISE
        dst = TemplateSlot(session=session, order=i, kind=kind, exercise_id=src.exercise_id)
        pairs.append((src, dst))
        tagged.append((dst, tags))
    slots = copy_doses(pairs, points)
    add_tags(TemplateSlot._meta.get_field("tags"), tagged)
    return slots


def copy_session(src, week, order, name=None, points=None, items=None):
    """Copy a template session (or a program session) with all its exercises. `items`: the
    session's slots or prescriptions, when the caller has them prefetched."""
    session = TemplateSession.objects.create(week=week, order=order, name=src.name if name is None else name)
    slots_from(_items(src) if items is None else items, session, points)
    return session


def copy_week(src, template, order, points=None):
    week = TemplateWeek.objects.create(
        template=template, order=order, week_type=src.week_type, focus_note=src.focus_note
    )
    for i, session in enumerate(src.sessions.prefetch_related("slots__tags", "slots__set_overrides")):
        copy_session(session, week, i, points=points, items=session.slots.all())
    return week


def _renumber(queryset):
    items = list(queryset.only("pk", "order"))
    changed = [item for order, item in enumerate(items) if item.order != order]
    for item in changed:
        item.order = items.index(item)
    queryset.model.objects.bulk_update(changed, ["order"])


# ---------------------------------------------------------------- templates


@transaction.atomic
def new_template(gym, kind, by):
    """An empty template, week or session, laid out like the mockup's "+ New" buttons."""
    template = Template.objects.create(
        gym=gym, kind=kind, created_by=by, sessions_per_week=STARTER_SESSIONS[kind]
    )
    week = TemplateWeek.objects.create(template=template, order=0, week_type=default_week_type(gym))
    for i in range(STARTER_SESSIONS[kind]):
        TemplateSession.objects.create(
            week=week, order=i, name=session_letter(i) if kind != "session" else ""
        )
    return template


def single_week(template):
    """The only week of a saved week or saved session (created if somehow missing)."""
    week = template.weeks.first()
    return week or TemplateWeek.objects.create(template=template, week_type=default_week_type(template.gym))


@transaction.atomic
def add_week(template, points=None):
    """A new last week: a copy of the previous one (percentages bumped by `points`),
    or one empty session if the template has no weeks."""
    last = template.weeks.last()
    order = (template.weeks.aggregate(m=Max("order"))["m"] or 0) + 1 if last else 0
    if last is None:
        week = TemplateWeek.objects.create(
            template=template, order=0, week_type=default_week_type(template.gym)
        )
        TemplateSession.objects.create(week=week, order=0, name=session_letter(0))
        return week
    return copy_week(last, template, order, points)


@transaction.atomic
def add_saved_week(template, saved):
    last = template.weeks.aggregate(m=Max("order"))["m"]
    order = 0 if last is None else last + 1  # not `or -1`: a last week numbered 0 is a week (audit M5)
    return copy_week(single_week(saved), template, order)


@transaction.atomic
def duplicate_week(week):
    template = week.template
    template.weeks.filter(order__gt=week.order).update(order=F("order") + 1)
    return copy_week(week, template, week.order + 1)


@transaction.atomic
def remove_week(week):
    template = week.template
    week.delete()
    _renumber(template.weeks.all())


@transaction.atomic
def add_session(week, name=None):
    n = week.sessions.count()
    return TemplateSession.objects.create(
        week=week, order=n, name=session_letter(n) if name is None else name
    )


@transaction.atomic
def add_saved_session(week, saved):
    source = single_week(saved).sessions.first()
    if source is None:
        return add_session(week, saved.display_name)
    return copy_session(source, week, week.sessions.count(), name=saved.display_name)


@transaction.atomic
def remove_session(session):
    week = session.week
    session.delete()
    _renumber(week.sessions.all())


@transaction.atomic
def add_slot(session, exercise, index=None, tags=None):
    """A fixed slot (or a tag slot when `tags` is given) at the end, or at `index`. The
    exercise must be one of the template's gym's, and not archived."""
    if exercise.gym_id != session.week.template.gym_id or exercise.archived:
        raise InvalidTemplate("That exercise isn't in this gym's library.")
    slot = TemplateSlot.objects.create(
        session=session,
        order=session.slots.count(),
        kind=SlotKind.TAG if tags else SlotKind.EXERCISE,
        exercise=exercise,
        **new_dose(exercise),
    )
    if tags:
        slot.tags.set(tags)
    if index is not None:
        move_slot(slot, session, index)
    else:
        keep_warmups_first(session)
    return slot


@transaction.atomic
def move_slot(slot, target, index):
    old = slot.session
    siblings = list(target.slots.exclude(pk=slot.pk))
    index = max(0, min(index, len(siblings)))
    siblings.insert(index, slot)
    slot.session = target
    for order, item in enumerate(siblings):
        item.order = order
    TemplateSlot.objects.bulk_update(siblings, ["session", "order"])
    keep_warmups_first(target)
    if old.pk != target.pk:
        _renumber(old.slots.all())


@transaction.atomic
def remove_slot(slot):
    session = slot.session
    slot.delete()
    _renumber(session.slots.all())


def add_habit(template, name, emoji, cadence, note=""):
    """A habit prescribed with the template (same rules as an athlete's; habits.InvalidHabit)."""
    from apps.programs import habits

    name, emoji, cadence, note = habits.clean(name, emoji, cadence, note)
    return TemplateHabit.objects.create(
        template=template, order=template.habits.count(), name=name, emoji=emoji, cadence=cadence, note=note
    )


# ---------------------------------------------------------------- saving boards into the library


def board_sessions(program_week):
    """(name, ProgramSession) for each session with work in a program week, in day order.
    An unnamed session is named after its weekday."""
    found = []
    for day in program_week.days.prefetch_related("sessions__prescriptions"):
        for session in day.sessions.all():
            if session.prescriptions.exists():
                found.append((session.name or day.date.strftime("%A"), session))
    return found


def suggested_week_name(program_week):
    return f"{program_week.week_type.name} - {len(board_sessions(program_week))} day"


def suggested_program_names(program):
    """(name, description) offered when saving an athlete's program as a template."""
    user = program.athlete.user
    short = user.get_short_name()
    return f"{program.name} (from {short})", f"Saved from {user.name or short}'s program"


@transaction.atomic
def save_week(gym, by, program_week, name, description=""):
    sessions = board_sessions(program_week)
    if not sessions:
        raise InvalidTemplate("This week has no sessions to save")
    name, description = check_save_names(name, description)
    template = Template.objects.create(
        gym=gym,
        kind=TemplateKind.WEEK,
        name=name,
        description=description,
        created_by=by,
        sessions_per_week=max(1, min(6, len(sessions))),
    )
    week = TemplateWeek.objects.create(
        template=template, order=0, week_type=program_week.week_type, focus_note=program_week.focus_note
    )
    for i, (session_name, session) in enumerate(sessions):
        copy_session(session, week, i, name=session_name)
    return template


@transaction.atomic
def save_session(gym, by, source, name, description=""):
    """Save a template session or a program session as a saved session."""
    name, description = check_save_names(name, description)
    template = Template.objects.create(
        gym=gym,
        kind=TemplateKind.SESSION,
        name=name,
        description=description,
        created_by=by,
        sessions_per_week=1,
    )
    week_type = source.week.week_type if isinstance(source, TemplateSession) else source.day.week.week_type
    week = TemplateWeek.objects.create(template=template, order=0, week_type=week_type)
    copy_session(source, week, 0, name="")
    return template


@transaction.atomic
def save_template_week(gym, by, template_week, name, description=""):
    name, description = check_save_names(name, description)
    template = Template.objects.create(
        gym=gym,
        kind=TemplateKind.WEEK,
        name=name,
        description=description,
        created_by=by,
        sessions_per_week=max(1, min(6, template_week.sessions.count())),
    )
    copy_week(template_week, template, 0)
    return template


@transaction.atomic
def save_program(gym, by, program, name, description=""):
    """An athlete's program as a template: every week with work, its sessions in day order."""
    if not any(board_sessions(w) for w in program.weeks.all()):
        raise InvalidTemplate("Nothing to save. This program has no sessions yet")
    name, description = check_save_names(name, description)
    template = Template.objects.create(
        gym=gym,
        kind=TemplateKind.PROGRAM,
        name=name,
        description=description,
        program_note=program.note,
        created_by=by,
    )
    most = 1
    order = 0
    for program_week in program.weeks.select_related("week_type"):
        sessions = board_sessions(program_week)
        if not sessions:
            continue
        week = TemplateWeek.objects.create(
            template=template,
            order=order,
            week_type=program_week.week_type,
            focus_note=program_week.focus_note,
        )
        for i, (session_name, session) in enumerate(sessions):
            copy_session(session, week, i, name=session_name)
        most = max(most, len(sessions))
        order += 1
    template.sessions_per_week = min(6, most)
    template.save(update_fields=["sessions_per_week"])
    return template


# ---------------------------------------------------------------- finding things (scoped to the gym)


def gym_template(gym, template_id):
    """One of the gym's templates, saved weeks or saved sessions (DoesNotExist otherwise)."""
    return Template.objects.get(pk=template_id, gym=gym)


def template_week(template, week_id):
    return TemplateWeek.objects.select_related("template").get(pk=week_id, template=template)


def template_session(template, session_id):
    return TemplateSession.objects.select_related("week").get(pk=session_id, week__template=template)


def template_slot(template, slot_id):
    return TemplateSlot.objects.select_related("session__week", "exercise").get(
        pk=slot_id, session__week__template=template
    )


def stats(template):
    """Counts shown on library cards and in the editor. `calendar_weeks` is how long the
    template runs at its sessions-per-week."""
    weeks = list(template.weeks.all())
    sessions = [s for w in weeks for s in w.sessions.all()]
    slots = [sl for s in sessions for sl in s.slots.all()]
    return {
        "weeks": len(weeks),
        "sessions": len(sessions),
        "slots": len(slots),
        "tag_slots": sum(1 for sl in slots if sl.kind == SlotKind.TAG),
        "habits": len(template.habits.all()),
        "calendar_weeks": -(-len(sessions) // template.sessions_per_week) if sessions else 0,
    }


# ---------------------------------------------------------------- template settings


MAX_NAME, MAX_DESCRIPTION, MAX_NOTE = 80, 200, 2000
MAX_POINTS = Decimal("50")


def update_meta(template, *, name=None, description=None, program_note=None, sessions_per_week=None):
    """Change whichever of name, description, program note and sessions per week (1-6) are
    given; names and descriptions are tidied. Returns the fields that changed."""
    fields = []
    for field, value, limit in (("name", name, MAX_NAME), ("description", description, MAX_DESCRIPTION)):
        if value is not None:
            value = " ".join(value.split())
            if len(value) > limit:
                raise InvalidTemplate(f"Keep the {field} to {limit} characters.")
            setattr(template, field, value)
            fields.append(field)
    if program_note is not None:
        program_note = program_note.strip()
        if len(program_note) > MAX_NOTE:
            raise InvalidTemplate(f"Keep the program note to {MAX_NOTE} characters.")
        template.program_note = program_note
        fields.append("program_note")
    if sessions_per_week is not None:
        if not 1 <= int(sessions_per_week) <= 6:
            raise InvalidTemplate("Written for 1 to 6 sessions a week.")
        template.sessions_per_week = int(sessions_per_week)
        fields.append("sessions_per_week")
    if fields:
        template.save(update_fields=[*fields, "updated_at"])
    return fields


def delete_template(template):
    """Programs it was applied to keep their weeks (everything was copied)."""
    template.delete()


def check_points(points):
    """A bump for percentage loads when adding a week: -50 to +50 points, or none."""
    if points in (None, ""):
        return None
    try:
        points = Decimal(str(points))
    except InvalidOperation:
        raise InvalidTemplate("Bump percentages by a number of points, e.g. 2.5.") from None
    if not -MAX_POINTS <= points <= MAX_POINTS:
        raise InvalidTemplate("Bump percentages by -50 to +50 points.")
    return points


def set_week_type(week, week_type):
    """One of the gym's week types; an archived one only if the week already has it."""
    if week_type.gym_id != week.template.gym_id or (week_type.archived and week_type.pk != week.week_type_id):
        raise InvalidTemplate("Pick one of your week types.")
    week.week_type = week_type
    week.save(update_fields=["week_type"])
    return week


def set_focus_note(week, note):
    """The template week's focus note (copied to the athlete's week when applied)."""
    week.focus_note = (note or "").strip()[:MAX_NOTE]
    week.save(update_fields=["focus_note"])
    return week


def rename_session(session, name):
    session.name = " ".join((name or "").split())[:80]
    session.save(update_fields=["name"])
    return session


# ---------------------------------------------------------------- slots


def default_for_tags(gym, tags):
    """The first (A–Z) active exercise carrying every tag, or None."""
    from apps.exercises.models import Exercise

    candidates = Exercise.objects.filter(gym=gym, archived=False)
    for tag in tags:
        candidates = candidates.filter(tags=tag)
    return candidates.order_by("name").first()


def add_tag_slot(session, tags, index=None):
    """A tag slot from the rail's ticked tags (at the end, or at `index`); its default is the
    first exercise with them all."""
    tags = list(tags)
    gym = session.week.template.gym
    if not tags:
        raise InvalidTemplate("Tick at least one tag first")
    if any(t.gym_id != gym.pk for t in tags):
        raise InvalidTemplate("Pick from your own tags.")
    default = default_for_tags(gym, tags)
    if default is None:
        raise InvalidTemplate("No exercise carries all of those tags. Loosen the filter")
    return add_slot(session, default, index=index, tags=tags)


def check_slot_kind(gym, kind, exercise=None, default=None, tags=()):
    """(exercise, tags) for a slot: a fixed exercise, or tags plus a default carrying them all.
    InvalidTemplate names the field that's wrong via its message."""
    tags = list(tags)
    if kind == SlotKind.EXERCISE:
        if exercise is None or exercise.gym_id != gym.pk or exercise.archived:
            raise InvalidTemplate("Pick an exercise.")
        return exercise, []
    if kind != SlotKind.TAG:
        raise InvalidTemplate("Pick what kind of slot it is.")
    if not tags or any(t.gym_id != gym.pk for t in tags):
        raise InvalidTemplate("Pick at least one tag.")
    if (
        default is None
        or default.gym_id != gym.pk
        or default.archived
        or not {t.pk for t in tags} <= set(default.tags.values_list("pk", flat=True))
    ):
        raise InvalidTemplate("Pick a default that carries every tag.")
    return default, tags


@transaction.atomic
def edit_slot(slot, *, kind, exercise=None, default=None, tags=(), dose=None):
    """Change what a slot is and its dose (from apps/programs/dose.validate) together."""
    from apps.programs import dose as doses

    chosen, tags = check_slot_kind(slot.session.week.template.gym, kind, exercise, default, tags)
    slot.kind, slot.exercise = kind, chosen
    if dose is not None:
        doses.apply(slot, dose)
    else:
        slot.save(update_fields=["kind", "exercise"])
    slot.tags.set(tags)
    return slot


# ---------------------------------------------------------------- habits and saved parts


def remove_habit(template, habit_id):
    TemplateHabit.objects.get(pk=habit_id, template=template).delete()


def saved_sources(gym, kind, exclude=None):
    """Saved weeks (kind "week") or saved sessions to drop into a template."""
    wanted = TemplateKind.WEEK if kind == "week" else TemplateKind.SESSION
    items = Template.objects.filter(gym=gym, kind=wanted)
    return items.exclude(pk=exclude.pk) if exclude is not None else items


def use_saved(template, kind, source_id, week=None):
    """Copy a saved week (as a new last week) or a saved session (into `week`)."""
    source = saved_sources(template.gym, kind, exclude=template).get(pk=source_id)
    if kind == "week":
        return source, add_saved_week(template, source)
    if week is None or week.template_id != template.pk:
        raise InvalidTemplate("Pick the week it goes in.")
    return source, add_saved_session(week, source)


def suggested_name(template, what, part):
    """The name offered when saving a template's week or session to the library."""
    if what == "week":
        return f"{template.display_name} - week {part.order + 1}"
    return part.name or template.display_name


def check_save_names(name, description=""):
    name, description = " ".join((name or "").split()), " ".join((description or "").split())
    if len(name) > MAX_NAME or len(description) > MAX_DESCRIPTION:
        raise InvalidTemplate(f"Names are up to {MAX_NAME} characters, descriptions {MAX_DESCRIPTION}.")
    return name, description


def card_names(template):
    """For a saved session's library card: its exercises' names, a tag slot as "[tag]"."""
    first = template.weeks.all()[0] if template.weeks.all() else None
    session = first.sessions.all()[0] if first and first.sessions.all() else None
    if session is None:
        return []
    return [
        f"[{sl.tags.all()[0].name}]" if sl.is_tag and sl.tags.all() else sl.exercise.name
        for sl in session.slots.all()
    ]


def part_summary(what, part):
    """What saving a template week ("week") or session to the library would save."""

    def plural(n, word):
        return f"{n} {word}{'s' if n != 1 else ''}"

    if what == "week":
        sessions = list(part.sessions.all())
        slots = sum(s.slots.count() for s in sessions)
        return {
            "week_type": part.week_type,
            "text": f"{plural(len(sessions), 'session')} · {plural(slots, 'exercise slot')}",
        }
    return {"week_type": None, "text": plural(part.slots.count(), "exercise slot")}


def weeks_with_sessions(program):
    """How many of a program's weeks have sessions (what saving it as a template keeps)."""
    return sum(1 for w in program.weeks.all() if board_sessions(w))
