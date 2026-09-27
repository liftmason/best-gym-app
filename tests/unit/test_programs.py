import datetime
from decimal import Decimal

import pytest

from apps.accounts.models import MaxEntry
from apps.exercises.models import Tag
from apps.programs import services
from apps.programs.models import LoadBasis, PrescribedSet, Prescription, Program, ProgramSession, WeekType
from apps.programs.prescriptions import default_dose, load_text, parse_rep_scheme, suggested_weight, summary

from ..conftest import ex

pytestmark = pytest.mark.django_db
HX = {"HTTP_HX_REQUEST": "true"}
MON = datetime.date(2026, 9, 21)  # a Monday


def wt(gym, name="Accumulation"):
    return WeekType.objects.get(gym=gym, name=name)


@pytest.fixture
def program(athlete, coach):
    return services.start_program(
        athlete, "Comp Prep", MON + datetime.timedelta(days=2), 3, wt(coach.gym), by=coach.user
    )


def base(athlete):
    return f"/coach/athletes/{athlete.pk}/program/"


# ---------------------------------------------------------------- parsing and display


@pytest.mark.parametrize(
    "text,expected",
    [
        ("5", (5, None)),
        ("1+1", (1, None)),
        ("2 + 1 + 1", (1, None)),
        ("8/leg", (8, None)),
        ("10 each", (10, None)),
        ("12 per arm", (12, None)),
        ("10 min", (None, 600)),
        ("30s", (None, 30)),
        ("1.5 min", (None, 90)),
        ("AMRAP", (None, None)),
        ("20 m", (None, None)),
        ("400m", (None, None)),
        ("5-3-1", (None, None)),
        ("", (None, None)),
    ],
)
def test_parse_rep_scheme(text, expected):
    assert parse_rep_scheme(text) == expected


def test_load_text():
    assert load_text(LoadBasis.PERCENT, Decimal("75.00"), "kg") == "75%"
    assert load_text(LoadBasis.RPE, Decimal("8"), "kg") == "RPE 8"
    assert load_text(LoadBasis.WEIGHT, Decimal("100"), "lb") == "220.5 lb"
    assert load_text(LoadBasis.BODYWEIGHT, None, "kg") == "BW"
    assert load_text(LoadBasis.NONE, Decimal("5"), "kg") == ""


def test_summary_and_suggested_weight(athlete, program, gym):
    day = program.weeks.first().days.first()
    rx = services.add_prescription(day, ex(gym, "fsq"), athlete)
    rx.sets, rx.rep_scheme, rx.load_basis, rx.load_value, rx.rir = 5, "3", LoadBasis.PERCENT, Decimal("80"), 2
    rx.custom_fields = [{"key": "Tempo", "value": "3-1-0"}]
    rx.save()
    assert summary(rx, "kg") == "5×3 @ 80% · RIR 2 · Tempo 3-1-0"
    assert suggested_weight(rx, athlete, "kg") is None  # no back squat max yet
    MaxEntry.objects.create(athlete=athlete, exercise=ex(gym, "bsq"), date=MON, kg=150, source="coach")
    assert suggested_weight(rx, athlete, "kg") == "≈ 120 kg of Back Squat max 150 kg"
    PrescribedSet.objects.bulk_create(
        [
            PrescribedSet(prescription=rx, set_number=i, rep_scheme="3", load_value=v)
            for i, v in [(1, 70), (2, 75), (3, 80)]
        ]
    )
    assert summary(rx, "kg").startswith("3 sets: 3@70%, 3@75%, 3@80%")


def test_default_dose_copies_last_time_or_uses_the_measure(athlete, program, gym):
    days = list(program.weeks.first().days.all())
    assert default_dose(ex(gym, "bike"), athlete)["rep_scheme"] == "10 min"
    assert default_dose(ex(gym, "bike"), athlete)["duration_seconds"] == 600
    first = services.add_prescription(days[0], ex(gym, "sn"), athlete)
    assert (first.sets, first.rep_scheme, first.reps) == (3, "5", 5)
    first.sets, first.rep_scheme, first.load_basis, first.load_value = 6, "2", LoadBasis.PERCENT, 78
    first.save()
    again = services.add_prescription(days[2], ex(gym, "sn"), athlete)
    assert (again.sets, again.rep_scheme, again.load_value) == (6, "2", Decimal("78.00"))


# ---------------------------------------------------------------- program structure


def test_start_program_snaps_to_the_week_start_and_makes_back_to_back_weeks(program):
    weeks = list(program.weeks.all())
    assert program.start_date == MON
    assert [w.start_date for w in weeks] == [MON, MON + datetime.timedelta(7), MON + datetime.timedelta(14)]
    assert all(w.days.count() == 7 for w in weeks)
    assert list(weeks[1].days.values_list("date", flat=True))[0] == MON + datetime.timedelta(7)
    assert not any(w.published for w in weeks)


def test_sunday_gyms_start_weeks_on_sunday(athlete, coach):
    coach.gym.week_start = 6
    coach.gym.save()
    athlete.refresh_from_db()
    p = services.start_program(
        athlete, "Block", MON + datetime.timedelta(days=2), 1, wt(coach.gym), by=coach.user
    )
    assert p.start_date == datetime.date(2026, 9, 20)  # the Sunday before
    assert p.start_date.weekday() == 6


def test_starting_a_new_program_ends_the_old_one(athlete, coach, program):
    new = services.start_program(athlete, "Next", MON, 1, wt(coach.gym), by=coach.user)
    program.refresh_from_db()
    assert not program.active and program.ended_at is not None and new.active
    assert Program.objects.filter(athlete=athlete).count() == 2


def test_duplicate_inserts_after_and_shifts_later_weeks(athlete, gym, program):
    w1, w2, w3 = program.weeks.all()
    day = w1.days.first()
    rx = services.add_prescription(day, ex(gym, "sn"), athlete)
    rx.custom_fields = [{"key": "Rest", "value": "3 min"}]
    rx.save()
    rx.tag_slot_tags.add(Tag.objects.get(gym=gym, name="speed"))
    PrescribedSet.objects.create(prescription=rx, set_number=1, rep_scheme="2", load_value=70)
    services.add_session(day, "PM")
    w1.focus_note, w1.published = "Stay crisp", True
    w1.save()

    copy = services.duplicate_week(w1)
    weeks = list(program.weeks.all())
    assert [w.pk for w in weeks] == [w1.pk, copy.pk, w2.pk, w3.pk]
    assert [w.order for w in weeks] == [0, 1, 2, 3]
    assert [w.start_date for w in weeks] == [MON + datetime.timedelta(7 * i) for i in range(4)]
    w3.refresh_from_db()
    assert list(w3.days.values_list("date", flat=True))[0] == MON + datetime.timedelta(21)  # days moved too
    assert not copy.published and copy.focus_note == "Stay crisp"
    copied = Prescription.objects.get(session__day__week=copy)
    assert copied.custom_fields == [{"key": "Rest", "value": "3 min"}]
    assert list(copied.tag_slot_tags.values_list("name", flat=True)) == ["speed"]
    assert copied.set_overrides.get().load_value == 70
    assert copied.session.day.date == MON + datetime.timedelta(7)
    assert ProgramSession.objects.filter(day__week=copy, name="PM").exists()
    assert Prescription.objects.filter(session__day__week=w1).count() == 1  # original untouched


def test_delete_week_closes_the_gap(program):
    w1, w2, w3 = program.weeks.all()
    services.delete_week(w2)
    w3.refresh_from_db()
    assert (w3.order, w3.start_date) == (1, MON + datetime.timedelta(7))
    assert list(w3.days.values_list("date", flat=True))[0] == MON + datetime.timedelta(7)


def test_add_week_continues_the_dates(program, coach):
    week = services.add_week(program, wt(coach.gym, "Deload"))
    assert (week.order, week.start_date, week.week_type.name) == (3, MON + datetime.timedelta(21), "Deload")


def test_move_and_remove_keep_orders_tidy(athlete, gym, program):
    d1, d2 = list(program.weeks.first().days.all())[:2]
    a, b, c = (services.add_prescription(d1, ex(gym, k), athlete) for k in ["sn", "snp", "bsq"])
    services.move_prescription(c, a.session, 0)
    assert list(a.session.prescriptions.values_list("exercise__key", flat=True)) == ["bsq", "sn", "snp"]
    target = services.session_for(d2)
    services.move_prescription(a, target, 0)
    assert list(target.prescriptions.values_list("exercise__key", flat=True)) == ["sn"]
    assert list(c.session.prescriptions.values_list("order", flat=True)) == [0, 1]
    services.remove_prescription(a)
    assert not ProgramSession.objects.filter(pk=target.pk).exists()  # empty unnamed session goes


def test_one_active_program_per_athlete(athlete, program):
    from django.db import IntegrityError

    with pytest.raises(IntegrityError):
        Program.objects.create(athlete=athlete, name="Dup", start_date=MON)


# ---------------------------------------------------------------- the editor, over HTTP
