"""How a session is laid out, from the client's spreadsheet: RIR ranges and rep ranges,
warm-up drills, section headings and supersets, program notes, and the anonymised demo
athlete on "Meso 1"."""

import pytest
from django.core.management import call_command

from apps.exercises.models import Exercise
from apps.library import apply
from apps.library import services as library_services
from apps.library.models import Template, TemplateKind
from apps.programs import services as program_services
from apps.programs import undo
from apps.programs.models import LoadBasis, WeekType
from apps.programs.prescriptions import layout, parse_rep_scheme, parse_rir
from apps.workouts import sessions
from apps.workouts.models import CheckinAnswer

from ..conftest import ex

pytestmark = pytest.mark.django_db


@pytest.fixture
def drill(gym):
    e = Exercise.objects.create(
        gym=gym,
        name="Deep Squat Lat Hang",
        category=ex(gym, "mob").category,
        youtube_url="https://www.youtube.com/watch?v=abc",
        warmup=True,
    )
    return e


@pytest.fixture
def day(athlete, coach):
    week_type = WeekType.objects.get(gym=coach.gym, name="Accumulation")
    program = program_services.start_program(athlete, "Meso", athlete.today(), 1, week_type, by=coach.user)
    week = program.weeks.get()
    program_services.set_published(week, True)
    return week.days.get(date=athlete.today())


def dose(rx, **fields):
    """Change a few fields (only those, so a stale `order` in memory isn't written back)."""
    type(rx).objects.filter(pk=rx.pk).update(**fields)
    rx.refresh_from_db()
    return rx


# ---------------------------------------------------------------- parsing


@pytest.mark.parametrize(
    "text, expected",
    [
        ("10-12", (10, None)),
        ("15–20 each", (15, None)),
        ("10-12/leg", (10, None)),
        ("20-30 min", (None, 1200)),
        ("5-3-1", (None, None)),  # a wave, not a range
        ("12-10", (None, None)),  # not low-high
        ("x 5 breaths", (None, None)),
    ],
)
def test_rep_ranges_count_the_low_end(text, expected):
    assert parse_rep_scheme(text) == expected


def test_rir_targets_take_a_number_or_a_range():
    assert parse_rir("2") == (2, None)
    assert parse_rir(" 1 - 2 ") == (1, 2)
    assert parse_rir("3-2") == (2, 3)
    assert parse_rir("2-2") == (2, None)
    assert parse_rir("") == (None, None)
    for bad in ("x", "1-2-3", "12"):
        with pytest.raises(ValueError):
            parse_rir(bad)


# ---------------------------------------------------------------- layout on the board


def test_warmups_stay_first_and_supersets_are_labelled(day, athlete, gym, drill):
    squat = program_services.add_prescription(day, ex(gym, "bsq"), athlete)
    rdl = program_services.add_prescription(day, ex(gym, "rdl"), athlete)
    row = program_services.add_prescription(day, ex(gym, "row"), athlete)
    warm = program_services.add_prescription(day, drill, athlete)  # added last, lands first
    session = day.sessions.get()
    assert [rx.pk for rx in session.prescriptions.all()] == [warm.pk, squat.pk, rdl.pk, row.pk]
    assert warm.warmup and warm.sets == 1  # a warm-up drill starts as one, with no sets to log

    # Dragging a lift above the warm-up still leaves the warm-up first.
    program_services.move_prescription(row, session, 0)
    assert list(session.prescriptions.values_list("pk", flat=True))[0] == warm.pk

    dose(squat, section="Strength")
    dose(rdl, section="Hypertrophy", section_note="Superset when you can")
    dose(row, superset=True)
    # The row was dragged to the top, so it has nothing above it to superset with yet.
    warmups, entries = layout(session.prescriptions.all())
    assert warmups == [warm]
    assert [(e["item"].pk, e["label"], e["section"]) for e in entries] == [
        (row.pk, "", ""),
        (squat.pk, "", "Strength"),
        (rdl.pk, "", "Hypertrophy"),
    ]
    program_services.move_prescription(row, session, 3)  # back after the RDL
    warmups, entries = layout(session.prescriptions.all())
    assert [(e["item"].pk, e["label"]) for e in entries] == [(squat.pk, ""), (rdl.pk, "B1"), (row.pk, "B2")]


def test_layout_is_copied_through_templates_and_undo(coach, athlete, day, gym, drill):
    squat = program_services.add_prescription(day, ex(gym, "bsq"), athlete)
    program_services.add_prescription(day, drill, athlete)
    dose(squat, section="Strength", section_note="Heavy", rir=1, rir_max=2, rep_scheme="5-6", reps=5)
    template = library_services.save_program(gym, coach.user, day.week.program, "Meso copy")
    slots = list(template.weeks.get().sessions.get().slots.all())
    assert [s.warmup for s in slots] == [True, False]
    assert (slots[1].section, slots[1].section_note, slots[1].rir, slots[1].rir_max) == (
        "Strength",
        "Heavy",
        1,
        2,
    )

    week = day.week
    undo.record(week, coach.user, "Edit squat")
    dose(squat, section="", rir_max=None, superset=True)
    undo.undo(week)
    squat.refresh_from_db()
    assert (squat.section, squat.rir_max, squat.superset) == ("Strength", 2, False)


# ---------------------------------------------------------------- the player


@pytest.fixture
def log(day, athlete, gym, drill):
    squat = program_services.add_prescription(day, ex(gym, "bsq"), athlete)
    program_services.add_prescription(day, drill, athlete)
    rdl = program_services.add_prescription(day, ex(gym, "rdl"), athlete)
    row = program_services.add_prescription(day, ex(gym, "row"), athlete)
    dose(squat, section="Strength", rir=1, rir_max=2)
    dose(rdl, section="Hypertrophy", rep_scheme="10-12", reps=10)
    dose(row, superset=True)
    return sessions.start(athlete, day.sessions.get())


def test_steps_are_warmup_then_exercises_with_supersets_together(log):
    steps = sessions.steps(log.exercises.all())
    assert [s["warmup"] for s in steps] == [True, False, False]
    assert [se.exercise_name for se in steps[0]["items"]] == ["Deep Squat Lat Hang"]
    assert [se.exercise_name for se in steps[2]["items"]] == ["Romanian Deadlift", "Pendlay Row"]
    assert steps[2]["labels"] == ["B1", "B2"] and steps[2]["section"] == "Hypertrophy"
    assert log.name == "Back Squat + Romanian Deadlift + 1 more"  # warm-ups don't name the session
    assert sessions.planned_sets(log.exercises.get(warmup=True)) == 0


# ---------------------------------------------------------------- check-in


# ---------------------------------------------------------------- program notes


def test_template_note_becomes_the_program_note(coach, athlete, gym):
    template = library_services.new_template(gym, TemplateKind.PROGRAM, coach.user)
    template.program_note = "Goal: strong and healthy."
    template.save()
    session = template.weeks.get().sessions.first()
    library_services.add_slot(session, ex(gym, "bsq"))
    program, _first, _habits = apply.confirm(
        athlete, template, [0, 2, 4], apply.DEFAULTS, "new:this", True, coach.user
    )
    assert program.note == "Goal: strong and healthy."


# ---------------------------------------------------------------- the demo athlete


def test_seed_has_the_client_style_program():
    from apps.accounts.models import Athlete

    call_command("seed_demo")
    riley = Athlete.objects.get(user__email="riley@ironridge.example")
    assert riley.units == "lb"
    program = riley.programs.active().get()
    assert "Rest as needed" in program.note and program.weeks.count() == 4
    template = Template.objects.get(name="Meso 1 — Powerbuilding")
    first = template.weeks.first().sessions.first().slots.all()
    assert [s.warmup for s in first][:6] == [True] * 6
    squat = next(s for s in first if s.exercise.name == "Back Squat")
    assert squat.load_basis == LoadBasis.RPE and [o.load_value for o in squat.set_overrides.all()] == [
        8,
        9,
        7,
    ]
    logs = riley.session_logs.finished()
    assert logs.count() >= 7  # weeks 1-2 at least, less week 1's Day 4
    warm = logs.first().exercises.filter(warmup=True)
    assert not warm.exists() or all(se.checked_at for se in warm)
    assert CheckinAnswer.objects.filter(session_log__athlete=riley, other_text="thighs").exists()
