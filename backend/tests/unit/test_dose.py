"""The dose rules (apps/programs/dose.py), tested directly: what the form checks today and the
API will check later."""

from decimal import Decimal

import pytest

from apps.library import services as library_services
from apps.library.models import TemplateKind
from apps.programs import dose
from apps.programs import services as program_services
from apps.programs.models import LoadBasis, WeekType

from ..conftest import ex

pytestmark = pytest.mark.django_db


def valid(**raw):
    return dose.validate({"sets": 3, "load_basis": "none", **raw}, "kg")


def error(**raw):
    with pytest.raises(dose.InvalidDose) as caught:
        valid(**raw)
    return caught.value.errors


def test_sets_are_whole_numbers_between_1_and_20():
    assert valid(sets="4")["sets"] == 4
    assert error(sets="x") == {"sets": "Enter a whole number of sets."}
    assert error(sets=0) == {"sets": "Between 1 and 20 sets."}
    assert error(sets=21) == {"sets": "Between 1 and 20 sets."}


@pytest.mark.parametrize(
    "basis, raw, stored",
    [
        ("percent", "75", Decimal("75")),
        ("rpe", "8", Decimal("8")),
        ("none", "999", None),  # a basis without a load ignores what was typed
        ("bodyweight", "", None),
    ],
)
def test_loads_by_basis(basis, raw, stored):
    assert valid(load_basis=basis, load_value=raw)["load_value"] == stored


def test_weights_are_entered_in_the_coachs_unit_and_stored_in_kg():
    d = dose.validate({"sets": 3, "load_basis": "weight", "load_value": "225"}, "lb")
    assert d["load_value"] == Decimal("102.06")


@pytest.mark.parametrize(
    "basis, raw, message",
    [
        ("percent", "", "Load: enter a percentage between 1 and 200."),
        ("percent", "250", "Load: enter a percentage between 1 and 200."),
        ("rpe", "11", "Load: enter an RPE between 1 and 10."),
        ("weight", "0", "Load: enter a weight."),
        ("weight", "heavy", "Enter a number."),
    ],
)
def test_load_errors(basis, raw, message):
    assert error(load_basis=basis, load_value=raw) == {"load_value": message}


def test_unknown_basis_and_long_text_are_refused():
    assert error(load_basis="kilos") == {"load_basis": "Pick a load basis."}
    assert error(note="x" * 501) == {"note": "Keep it to 500 characters."}


def test_rep_schemes_and_rir_targets():
    d = valid(rep_scheme="  10-12 ", rir="1-2")
    assert (d["rep_scheme"], d["reps"], d["duration_seconds"]) == ("10-12", 10, None)
    assert (d["rir"], d["rir_max"]) == (1, 2)
    assert valid(rep_scheme="10 min")["duration_seconds"] == 600
    assert error(rir="lots") == {"rir": "Enter a number (2) or a range (1-2), up to 10."}


def test_a_warmup_drill_is_one_set_with_no_load_rir_or_section():
    d = valid(
        warmup=True, sets=4, load_basis="percent", load_value="70", rir="2", section="Strength", superset=True
    )
    assert (d["sets"], d["load_basis"], d["load_value"], d["rir"]) == (1, LoadBasis.NONE, None, None)
    assert (d["section"], d["superset"], d["set_rows"]) == ("", False, [])


def test_sections_and_custom_fields_are_tidied():
    d = valid(
        section="  Hyper   trophy ",
        custom_fields=[{"key": " Tempo ", "value": " 3-1-0 "}, {"key": "", "value": "dropped"}],
    )
    assert d["section"] == "Hyper trophy"
    assert d["custom_fields"] == [{"key": "Tempo", "value": "3-1-0"}]
    many = [{"key": f"k{i}", "value": "v"} for i in range(9)]
    assert error(custom_fields=many) == {None: "Keep it to 8 custom fields."}


def test_vary_by_set_rows():
    d = valid(
        load_basis="percent",
        load_value="70",
        rep_scheme="3",
        vary=True,
        set_rows=[{"reps": "3", "load": "70"}, {"reps": "", "load": "75"}, {"reps": "1", "load": ""}],
    )
    assert d["set_rows"] == [
        {"set_number": 1, "rep_scheme": "3", "reps": 3, "load_value": Decimal("70")},
        {"set_number": 2, "rep_scheme": "", "reps": 3, "load_value": Decimal("75")},  # reps from the parent
        {"set_number": 3, "rep_scheme": "1", "reps": 1, "load_value": None},  # load from the parent
    ]
    assert error(vary=True, set_rows=[{"reps": "3", "load": ""}]) == {None: "Fill in a row for every set."}
    rows = [{"reps": "3", "load": "70"}, {"reps": "3", "load": "300"}, {"reps": "3", "load": "70"}]
    bad = error(load_basis="percent", load_value="70", vary=True, set_rows=rows)
    assert bad == {None: "Set 2: enter a percentage between 1 and 200."}
    assert valid(vary=False, set_rows=rows)["set_rows"] == []  # rows only count when varying


def test_apply_writes_the_dose_and_replaces_overrides(athlete, coach, gym):
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program = program_services.start_program(athlete, "P", athlete.today(), 1, week_type, by=coach.user)
    day = program.weeks.get().days.first()
    squat = program_services.add_prescription(day, ex(gym, "bsq"), athlete)
    mob = program_services.add_prescription(day, ex(gym, "mob"), athlete)
    rows = [{"reps": "5", "load": "70"}, {"reps": "5", "load": "75"}]
    dose.apply(squat, valid(sets=2, load_basis="percent", load_value="70", vary=True, set_rows=rows))
    assert list(squat.set_overrides.values_list("load_value", flat=True)) == [Decimal("70"), Decimal("75")]
    dose.apply(squat, valid(sets=2, load_basis="percent", load_value="72"))
    assert not squat.set_overrides.exists() and squat.load_value == Decimal("72")
    dose.apply(mob, valid(warmup=True, rep_scheme="x 5 breaths"))
    assert list(day.sessions.get().prescriptions.values_list("pk", flat=True)) == [mob.pk, squat.pk]


def test_apply_works_on_template_slots(coach, gym):
    template = library_services.new_template(gym, TemplateKind.PROGRAM, coach.user)
    slot = library_services.add_slot(template.weeks.get().sessions.first(), ex(gym, "sn"))
    dose.apply(slot, valid(sets=5, rep_scheme="2", load_basis="percent", load_value="80", rir="1"))
    slot.refresh_from_db()
    assert (slot.sets, slot.reps, slot.load_value, slot.rir) == (5, 2, Decimal("80"), 1)


def test_a_dose_shown_for_editing_comes_back_unchanged(athlete, coach, gym):
    # The API's editor shows dose.values and sends them back: nothing may drift (a weight in
    # pounds, RIR ranges, per-set rows).
    from decimal import Decimal

    from apps.programs import dose as dose_rules
    from apps.programs import services as program_services
    from apps.programs.models import WeekType

    from ..conftest import ex

    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program = program_services.start_program(athlete, "P", athlete.today(), 1, week_type, by=coach.user)
    rx = program_services.add_prescription(program.weeks.get().days.first(), ex(gym, "bsq"), athlete)
    raw = {
        "sets": 3,
        "rep_scheme": "5",
        "load_basis": "weight",
        "load_value": "225",
        "rir": "1-2",
        "note": "Pause",
        "custom_fields": [{"key": "Tempo", "value": "3-1-0"}],
        "vary": True,
        "set_rows": [
            {"reps": "5", "load": "215"},
            {"reps": "5", "load": "225"},
            {"reps": "3", "load": "235"},
        ],
    }
    dose_rules.apply(rx, dose_rules.validate(raw, "lb"))
    rx.refresh_from_db()
    before = (rx.load_value, rx.rir, rx.rir_max, [o.load_value for o in rx.set_overrides.all()])
    shown = dose_rules.values(rx, "lb")
    assert shown["load_value"] == "225" and shown["rir"] == "1-2" and shown["set_rows"][2]["load"] == "235"
    dose_rules.apply(rx, dose_rules.validate(shown, "lb"))
    rx.refresh_from_db()
    assert (rx.load_value, rx.rir, rx.rir_max, [o.load_value for o in rx.set_overrides.all()]) == before
    assert rx.load_value == Decimal("102.06")
