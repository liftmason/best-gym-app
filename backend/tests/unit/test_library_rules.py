"""Template editor and apply-preview rules (apps/library/services.py, apply.py), tested
directly."""

from decimal import Decimal

import pytest

from apps.exercises.models import Tag
from apps.library import apply, services
from apps.library.models import Template, TemplateKind, TemplateWeek
from apps.programs import services as program_services
from apps.programs.dose import validate
from apps.programs.models import WeekType

from ..conftest import ex
from ..factories import GymFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def template(coach, gym):
    return services.new_template(gym, TemplateKind.PROGRAM, coach.user)


def session(template):
    return template.weeks.first().sessions.first()


# ---------------------------------------------------------------- lookups and settings


def test_lookups_stay_in_the_gym(template, gym):
    assert services.gym_template(gym, template.pk) == template
    with pytest.raises(Template.DoesNotExist):
        services.gym_template(GymFactory(), template.pk)
    other = services.new_template(gym, TemplateKind.PROGRAM, None)
    with pytest.raises(TemplateWeek.DoesNotExist):
        services.template_week(other, template.weeks.get().pk)


def test_update_meta(template):
    changed = services.update_meta(template, name="  12-week   cycle ", sessions_per_week=4)
    assert set(changed) == {"name", "sessions_per_week"} and template.name == "12-week cycle"
    for bad in (
        {"name": "x" * 81},
        {"description": "x" * 201},
        {"sessions_per_week": 7},
        {"program_note": "x" * 2001},
    ):
        with pytest.raises(services.InvalidTemplate):
            services.update_meta(template, **bad)
    assert services.update_meta(template) == []


def test_stats(template, gym):
    services.add_slot(session(template), ex(gym, "sn"))
    services.add_tag_slot(session(template), [Tag.objects.get(gym=gym, name="overhead")])
    st = services.stats(template)
    assert (st["weeks"], st["sessions"], st["slots"], st["tag_slots"]) == (1, 3, 2, 1)
    assert st["calendar_weeks"] == 1  # 3 sessions at 3 a week


def test_points_and_week_types(template, gym):
    assert services.check_points("2.5") == Decimal("2.5") and services.check_points("") is None
    with pytest.raises(services.InvalidTemplate):
        services.check_points(51)
    week = template.weeks.get()
    services.set_week_type(week, WeekType.objects.get(gym=gym, name="Deload"))
    with pytest.raises(services.InvalidTemplate):
        services.set_week_type(week, WeekType.objects.filter(gym=GymFactory(pack="general")).first())


# ---------------------------------------------------------------- slots


def test_tag_slots_default_to_the_first_matching_exercise(template, gym):
    overhead = Tag.objects.get(gym=gym, name="overhead")
    slot = services.add_tag_slot(session(template), [overhead])
    assert slot.is_tag and overhead in slot.exercise.tags.all()
    with pytest.raises(services.InvalidTemplate, match="Tick at least one tag"):
        services.add_tag_slot(session(template), [])
    lonely = Tag.objects.create(gym=gym, name="nobody-has-it")
    with pytest.raises(services.InvalidTemplate, match="loosen the filter"):
        services.add_tag_slot(session(template), [lonely])


def test_slot_kinds(template, gym):
    slot = services.add_slot(session(template), ex(gym, "sn"))
    overhead = Tag.objects.get(gym=gym, name="overhead")
    good_default = services.default_for_tags(gym, [overhead])
    services.edit_slot(
        slot,
        kind="tag",
        default=good_default,
        tags=[overhead],
        dose=validate({"sets": 4, "load_basis": "none"}, "kg"),
    )
    slot.refresh_from_db()
    assert slot.is_tag and slot.sets == 4 and list(slot.tags.all()) == [overhead]
    with pytest.raises(services.InvalidTemplate, match="carries every tag"):
        services.edit_slot(slot, kind="tag", default=ex(gym, "bsq"), tags=[overhead])
    with pytest.raises(services.InvalidTemplate, match="Pick an exercise"):
        services.edit_slot(slot, kind="exercise")
    services.edit_slot(slot, kind="exercise", exercise=ex(gym, "cj"))
    slot.refresh_from_db()
    assert not slot.is_tag and slot.exercise == ex(gym, "cj") and not slot.tags.exists()


# ---------------------------------------------------------------- saved parts


def test_saved_weeks_and_sessions(template, coach, gym):
    saved_week = services.save_template_week(gym, coach.user, template.weeks.get(), "Week A")
    source, week = services.use_saved(template, "week", saved_week.pk)
    assert source == saved_week and week.order == 1
    saved_session = services.save_session(gym, coach.user, session(template), "Session A")
    with pytest.raises(services.InvalidTemplate):
        services.use_saved(template, "session", saved_session.pk)  # needs a week
    services.use_saved(template, "session", saved_session.pk, template.weeks.first())
    assert services.suggested_name(template, "week", template.weeks.first()).endswith("— week 1")
    with pytest.raises(services.InvalidTemplate):
        services.check_save_names("x" * 81)


def test_saving_an_empty_board_is_refused(athlete, coach, gym):
    program = program_services.start_program(
        athlete, "P", athlete.today(), 1, WeekType.objects.get(gym=gym, name="Accumulation"), by=coach.user
    )
    with pytest.raises(services.InvalidTemplate):
        services.save_week(gym, coach.user, program.weeks.get(), "Empty")
    with pytest.raises(services.InvalidTemplate):
        services.save_program(gym, coach.user, program, "Empty")
    assert services.suggested_program_names(program) == ("P (from Maya)", "Saved from Maya Torres's program")


def test_removing_a_template_habit(template):
    habit = services.add_habit(template, "Sleep", "😴", "daily", "")
    services.remove_habit(template, habit.pk)
    assert not template.habits.exists()


# ---------------------------------------------------------------- the apply draft


def test_draft_lifecycle(template, athlete, coach, gym):
    services.add_slot(session(template), ex(gym, "sn"))
    draft = apply.new_draft(template, athlete)
    assert (
        draft["days"] == apply.default_days(template) and draft["mode"] == apply.RECENT and draft["view"] == 0
    )
    draft = apply.update_draft(draft, athlete, days=["0", "2", "9", "x"], mode="default", publish=True)
    assert draft["days"] == [0, 2] and draft["mode"] == apply.DEFAULTS and draft["publish"]
    draft = apply.update_draft(draft, athlete, view="week:42")
    assert draft["view"] is None and draft["real_week"] == "42"
    other = services.new_template(gym, TemplateKind.PROGRAM, coach.user)
    switched = apply.update_draft(draft, athlete, template=other)
    assert switched["template"] == other.pk and switched["mode"] == apply.DEFAULTS  # mode kept
    assert apply.draft_template(gym, switched) == other
    assert apply.draft_template(GymFactory(), switched) is None


def test_preview(template, athlete, gym):
    services.add_slot(session(template), ex(gym, "sn"))
    p = apply.preview(template, athlete, apply.new_draft(template, athlete))
    assert p["summary"]["weeks"] == 1 and p["summary"]["sessions"] == 3 and p["summary"]["new_program"]
    assert p["shown"] == p["ghosts"][0] and p["ghosts"][0]["label"] == "Wk 1"


def test_sources_are_programs_and_saved_weeks(template, coach, gym):
    services.new_template(gym, TemplateKind.SESSION, coach.user)
    week = services.new_template(gym, TemplateKind.WEEK, coach.user)
    assert set(apply.sources(gym)) == {template, week}
    assert apply.first_source(gym, "week") == week
