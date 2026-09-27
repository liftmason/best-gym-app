"""Phase 5: templates, saved weeks and sessions, and applying them to an athlete."""

import datetime
from decimal import Decimal

import pytest

from apps.exercises.deletion import delete_exercise, deletion_impact
from apps.exercises.models import Exercise, Tag
from apps.library import apply, services
from apps.library.models import SlotKind, TemplateKind, TemplateSlot
from apps.programs import services as program_services
from apps.programs.models import LoadBasis, Prescription, ProgramWeek, WeekType
from apps.workouts import sessions as workout_sessions

from ..conftest import ex

pytestmark = pytest.mark.django_db
HX = {"HTTP_HX_REQUEST": "true"}
DAY = datetime.timedelta(days=1)


def tag(gym, name):
    return Tag.objects.get(gym=gym, name=name)


@pytest.fixture
def template(gym, coach):
    """3 sessions a week, two weeks: A (snatch 5×2 @ 70%), B (tag slot [unilateral], default
    Bulgarian split squat), C (C&J); week 2 is week 1 bumped by 2.5 points."""
    t = services.new_template(gym, TemplateKind.PROGRAM, coach.user)
    t.name = "Comp Cycle"
    t.save()
    a, b, c = t.weeks.get().sessions.all()
    s = services.add_slot(a, ex(gym, "sn"))
    s.sets, s.rep_scheme, s.reps, s.load_basis, s.load_value = 5, "2", 2, LoadBasis.PERCENT, Decimal("70")
    s.save()
    services.add_slot(b, ex(gym, "bsp"), tags=[tag(gym, "unilateral")])
    services.add_slot(c, ex(gym, "cj"))
    services.add_week(t, Decimal("2.5"))
    return t


@pytest.fixture
def step_up(gym):
    """A second "unilateral" exercise (the starter pack has only Bulgarian split squats)."""
    bsp = ex(gym, "bsp")
    step = Exercise.objects.create(gym=gym, name="Step-up", category=bsp.category)
    step.tags.set([tag(gym, "unilateral")])
    return step


@pytest.fixture
def program(athlete, coach):
    """Two weeks from this week; this week has a session today."""
    week_type = WeekType.objects.get(gym=coach.gym, name="Accumulation")
    return program_services.start_program(athlete, "Block", athlete.today(), 2, week_type, by=coach.user)


# ---------------------------------------------------------------- editing


def test_add_week_copies_and_bumps_percentages(template, gym):
    week1, week2 = template.weeks.all()
    slot1 = week1.sessions.first().slots.get()
    slot2 = week2.sessions.first().slots.get()
    assert (slot1.load_value, slot2.load_value) == (Decimal("70.00"), Decimal("72.50"))
    assert slot2.pk != slot1.pk and week2.sessions.count() == 3
    tag_slot = week2.sessions.all()[1].slots.get()
    assert tag_slot.kind == SlotKind.TAG and [t.name for t in tag_slot.tags.all()] == ["unilateral"]


def test_bump_only_touches_percentages():
    assert services.bump(Decimal("8"), LoadBasis.RPE, 2) == Decimal("8")
    assert services.bump(Decimal("100"), LoadBasis.WEIGHT, 2) == Decimal("100")
    assert services.bump(Decimal("70"), LoadBasis.PERCENT, Decimal("-2.5")) == Decimal("67.5")


def test_saving_a_board_week_and_a_program(athlete, coach, gym, program):
    week = program.weeks.first()
    today = athlete.today()
    day = week.days.get(date=today)
    program_services.add_prescription(day, ex(gym, "sn"), athlete)
    saved = services.save_week(gym, coach.user, week, "My week")
    session = saved.weeks.get().sessions.get()
    assert saved.kind == TemplateKind.WEEK and session.name == today.strftime("%A")
    assert session.slots.get().exercise.key == "sn"
    whole = services.save_program(gym, coach.user, program, "From Maya")
    assert whole.kind == TemplateKind.PROGRAM and whole.weeks.count() == 1  # only weeks with work


# ---------------------------------------------------------------- planning


def test_plan_packs_sessions_into_the_chosen_days(template, athlete):
    weeks = apply.plan(template, athlete, [0, 2, 4], apply.DEFAULTS)
    assert len(weeks) == 2 and sorted(weeks[0].days) == [0, 2, 4]
    weeks = apply.plan(template, athlete, [0, 3], apply.DEFAULTS)  # 6 sessions at 2 a week
    assert [w.session_count for w in weeks] == [2, 2, 2]
    assert apply.plan(template, athlete, [], apply.DEFAULTS) == []


def test_tag_slots_resolve_to_recent_lifts(template, athlete, gym, program, coach, step_up):
    # Maya did step-ups (unilateral) recently: "recent" mode picks them over the default.
    day = program.weeks.first().days.get(date=athlete.today())
    program_services.add_prescription(day, step_up, athlete)
    for week in program.weeks.all():
        program_services.set_published(week, True)
    log = workout_sessions.start(athlete, day.sessions.get())
    se = log.exercises.get()
    workout_sessions.save_set(
        se, 1, load_kg=Decimal("20"), reps=8, duration_seconds=None, rir=None, done=True
    )
    workout_sessions.finish(log, 7, "")
    recent = apply.plan(template, athlete, [0, 2, 4], apply.RECENT)[0].days[2].exercises[0][1]
    default = apply.plan(template, athlete, [0, 2, 4], apply.DEFAULTS)[0].days[2].exercises[0][1]
    assert recent == step_up and default.key == "bsp"


# ---------------------------------------------------------------- confirming


def test_confirm_appends_unpublished_weeks_with_the_exact_dose(template, athlete, coach, program):
    program_before = program.weeks.count()
    prog, first, _habits = apply.confirm(
        athlete, template, [0, 2, 4], apply.DEFAULTS, "append", False, coach.user
    )
    assert prog == program and first.order == program_before and program.weeks.count() == program_before + 2
    assert not first.published and first.start_date == program.start_date + apply.WEEK * first.order
    rx = Prescription.objects.filter(session__day__week=first, exercise__key="sn").get()
    assert (rx.sets, rx.rep_scheme, rx.load_basis, rx.load_value) == (5, "2", "percent", Decimal("70.00"))
    tagged = Prescription.objects.get(session__day__week=first, exercise__key="bsp")
    assert [t.name for t in tagged.tag_slot_tags.all()] == ["unilateral"]  # stays swappable on the board
    assert template.applications.count() == 1


def test_confirm_as_a_new_program(template, athlete, coach, program):
    new, first, _habits = apply.confirm(
        athlete, template, [0, 2, 4], apply.DEFAULTS, "new:next", True, coach.user
    )
    program.refresh_from_db()
    assert not program.active and new.active and new.name == "Comp Cycle" and new.source_template == template
    assert first.published and first.start_date == athlete.gym.week_start_for(athlete.today()) + apply.WEEK


def test_starting_at_a_future_week_replaces_empties_and_moves_the_rest(
    template, athlete, coach, gym, program
):
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program_services.add_week(program, week_type)  # weeks: this, +1 (empty), +2 (gets work)
    later = program.weeks.get(order=2)
    program_services.add_prescription(later.days.first(), ex(gym, "cj"), athlete)
    empty = program.weeks.get(order=1)
    options = {p.value: p for p in apply.placements(athlete)}
    assert (
        f"at:{empty.pk}" in options and "Start at Wk 2 (empty — replaced)" == options[f"at:{empty.pk}"].label
    )
    apply.confirm(athlete, template, [0, 2, 4], apply.DEFAULTS, f"at:{empty.pk}", False, coach.user)
    assert not ProgramWeek.objects.filter(pk=empty.pk).exists()
    later.refresh_from_db()
    assert (
        later.order == 3 and later.start_date == program.start_date + apply.WEEK * 3
    )  # after the 2 new weeks
    assert later.days.first().date == later.start_date and later.days.first().sessions.exists()


# ---------------------------------------------------------------- invites and deleting


def test_deleting_an_exercise_updates_template_slots(template, gym, step_up):
    bsp = ex(gym, "bsp")
    sn = ex(gym, "sn")
    for e in (bsp, sn):
        e.archived = True
        e.save()
    impact = deletion_impact(bsp)
    assert impact["slots_redefaulted"] == 2 and impact["templates"] == ["Comp Cycle"]  # tag slot, both weeks
    delete_exercise(bsp)
    tag_slots = TemplateSlot.objects.filter(kind=SlotKind.TAG)
    assert tag_slots.count() == 2 and all(s.exercise == step_up for s in tag_slots)
    assert deletion_impact(sn)["slots_removed"] == 2
    delete_exercise(sn)
    assert not TemplateSlot.objects.filter(exercise__key="sn").exists()
