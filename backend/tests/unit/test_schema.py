"""The database's own rules (S0 step 5): UUIDv7 ids, check constraints, case-insensitive
uniqueness, protected training history and the explicit erase, the snapshot version."""

import uuid
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.utils import timezone

from apps.accounts import erase
from apps.accounts.models import BodyweightEntry, MaxEntry, User
from apps.core import sync
from apps.dashboard.models import Notification, NotificationKind
from apps.exercises.models import Exercise, ExerciseTag, Tag
from apps.messaging import services as messaging
from apps.messaging.models import Message, Thread
from apps.programs import habits
from apps.programs import services as program_services
from apps.programs.models import LoadBasis, PrescribedSet, Prescription, PrescriptionTag, Program, WeekType
from apps.workouts import sessions
from apps.workouts.models import SessionLog, SetLog

from ..conftest import cat, ex
from ..factories import AthleteFactory, GymFactory, UserFactory

pytestmark = pytest.mark.django_db


def refused(fn):
    with pytest.raises(IntegrityError), transaction.atomic():
        fn()


@pytest.fixture
def week(athlete, coach, gym):
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program = program_services.start_program(athlete, "P", athlete.today(), 1, week_type, by=coach.user)
    week = program.weeks.get()
    program_services.set_published(week, True)
    return week


@pytest.fixture
def log(week, athlete, gym):
    day = week.days.get(date=athlete.today())
    program_services.add_prescription(day, ex(gym, "sn"), athlete)
    return sessions.start_planned(athlete, day.sessions.get().pk)


def test_ids_are_uuid7(athlete):
    assert athlete.pk.version == 7 and athlete.user.pk.version == 7


def test_emails_are_unique_in_any_case(make_user):
    make_user("sam@example.com")
    refused(lambda: User.objects.create_user("SAM@example.com", "x"))


def test_exercise_names_are_unique_per_gym_in_any_case(gym):
    refused(lambda: Exercise.objects.create(gym=gym, name="SNATCH", category=cat(gym, "Snatch")))


def test_a_dose_the_services_would_refuse_is_refused_by_the_database(log):
    rx = Prescription.objects.get()
    bad = [
        {"sets": 0},
        {"rir": 3, "rir_max": 1},
        {"rir": None, "rir_max": 2},
        {"load_basis": LoadBasis.WEIGHT, "load_value": Decimal("-1")},
        {"load_basis": LoadBasis.PERCENT, "load_value": Decimal("250")},
        {"load_basis": LoadBasis.RPE, "load_value": Decimal("11")},
    ]
    for change in bad:
        refused(lambda change=change: Prescription.objects.filter(pk=rx.pk).update(**change))
    Prescription.objects.filter(pk=rx.pk).update(load_basis=LoadBasis.WEIGHT, load_value=Decimal("150"))


def test_logged_sets_and_session_rpe_are_checked(log):
    se = log.exercises.get()
    sessions.log_set(se, 1, load="100", reps="2", done=True)
    refused(lambda: SetLog.objects.update(load_kg=Decimal("-5")))
    refused(lambda: SetLog.objects.update(set_number=0))
    refused(lambda: SessionLog.objects.update(session_rpe=11))


def test_training_history_cannot_be_deleted_by_accident(log, athlete, gym):
    sn = ex(gym, "sn")
    MaxEntry.objects.create(athlete=athlete, exercise=sn, date=athlete.today(), kg=100, source="coach")
    with pytest.raises(ProtectedError):
        athlete.delete()
    with pytest.raises(ProtectedError):
        athlete.user.delete()


def test_erase_removes_an_athlete_and_everything_about_them(log, athlete, coach, gym):
    other = AthleteFactory(coach=coach)
    se = log.exercises.get()
    sessions.log_set(se, 1, load="100", reps="1", done=True)
    sessions.finish(log, 8)
    BodyweightEntry.objects.create(athlete=athlete, date=athlete.today(), kg=80, source="athlete")
    habits.prescribe(athlete, "Sleep", "😴", "daily")
    messaging.send(Thread.for_athlete(athlete), athlete.user, "Hi coach")
    user_id = athlete.user.pk

    erase.erase_athlete(athlete)

    assert not User.objects.filter(pk=user_id).exists()
    for model in (SessionLog, Program, MaxEntry, BodyweightEntry, Message):
        assert not model.objects.exists(), model
    assert other.user.pk and User.objects.filter(pk=other.user.pk).exists()


def test_erase_keeps_the_account_of_an_athlete_who_is_also_a_coach(coach, gym):
    athlete = AthleteFactory(coach=coach, user=coach.user)
    erase.erase_athlete(athlete)
    assert User.objects.filter(pk=coach.user.pk).exists()


def test_a_deleted_sender_leaves_their_messages(athlete, coach):
    messaging.send(Thread.for_athlete(athlete), coach.user, "Nice work")
    sender = UserFactory()
    Message.objects.update(sender=sender)
    sender.delete()
    assert Message.objects.get().sender is None


def test_session_snapshots_are_versioned(log):
    assert log.exercises.get().prescribed["v"] == sessions.SNAPSHOT_VERSION == 1


def test_notification_keys_are_per_athlete_and_unique_without_one(athlete, coach):
    other = AthleteFactory(coach=coach)
    row = {"recipient": coach.user, "kind": NotificationKind.PR, "dedupe_key": "k", "text": "t"}
    Notification.objects.create(athlete=athlete, created_at=timezone.now(), **row)
    Notification.objects.create(athlete=other, created_at=timezone.now(), **row)
    Notification.objects.create(athlete=None, created_at=timezone.now(), **row)
    refused(lambda: Notification.objects.create(athlete=None, created_at=timezone.now(), **row))


def test_posted_ids_are_parsed_safely():
    from apps.core import ids

    value = uuid.uuid7()
    assert ids.parse(str(value)) == value and ids.parse(value) == value
    assert ids.parse("12") is None and ids.parse(None) is None and ids.parse("") is None


# ---------------------------------------------------------------- synced tables (S3 relies on these)


def _project_models():
    from django.apps import apps as django_apps

    return {
        m._meta.label: m
        for m in django_apps.get_models()
        if m.__module__.startswith("apps.") and not m._meta.auto_created
    }


def test_every_table_is_listed_as_synced_or_not():
    listed = sync.BY_ATHLETE + sync.BY_GYM + sync.BY_GYM_OR_ATHLETE + sync.NOT_SYNCED
    assert len(listed) == len(set(listed)), "a table is listed twice in apps/core/sync.py"
    assert set(_project_models()) == set(listed), "list new tables in apps/core/sync.py"


def test_synced_tables_carry_their_owner_column():
    models = _project_models()
    for label, owner in [(m, "athlete") for m in sync.BY_ATHLETE] + [(m, "gym") for m in sync.BY_GYM]:
        field = models[label]._meta.get_field(owner)
        assert field.many_to_one and not field.null, f"{label}.{owner}"
        assert field.related_model._meta.label == f"accounts.{owner.title()}", f"{label}.{owner}"
    for label in sync.BY_GYM_OR_ATHLETE:
        assert {models[label]._meta.get_field(f).null for f in ("athlete", "gym")} == {True}


def test_synced_many_to_many_links_have_their_own_table():
    models = _project_models()
    for label in sync.BY_ATHLETE + sync.BY_GYM:
        for field in models[label]._meta.many_to_many:
            through = field.remote_field.through._meta
            assert not through.auto_created, f"{label}.{field.name}: give it a through model"


def test_child_rows_take_their_owner_from_the_parent(log, athlete, gym):
    se = log.exercises.get()
    sessions.log_set(se, 1, load="80", reps="3", done=True)
    rx = Prescription.objects.get()
    rx.tag_slot_tags.set([Tag.objects.get(gym=gym, name="speed")])
    assert {SetLog.objects.get().athlete_id, se.athlete_id, rx.athlete_id} == {athlete.pk}
    assert PrescriptionTag.objects.get().athlete_id == athlete.pk
    assert ExerciseTag.objects.filter(exercise__gym=gym).exclude(gym=gym).count() == 0
    assert PrescribedSet.objects.exclude(athlete=athlete).count() == 0


def test_a_row_whose_owner_disagrees_with_its_parent_is_refused(log, coach):
    other = AthleteFactory(coach=coach)
    se = log.exercises.get()
    with pytest.raises(ValueError):
        SetLog.objects.create(session_exercise=se, set_number=2, athlete=other)
    with pytest.raises(ValueError):
        SetLog.objects.bulk_create([SetLog(session_exercise=se, set_number=2, athlete=other)])


def test_references_to_another_gyms_rows_are_invalid(log, athlete, gym):
    elsewhere = GymFactory(pack="weightlifting")
    rx = Prescription.objects.get()
    rx.exercise = ex(elsewhere, "sn")
    week = rx.session.day.week
    week.week_type = WeekType.objects.filter(gym=elsewhere).first()
    snatch = ex(gym, "sn")
    snatch.percent_of = ex(elsewhere, "cj")
    maxed = MaxEntry(
        athlete=athlete, exercise=ex(elsewhere, "bsq"), date=athlete.today(), kg=100, source="coach"
    )
    tagged = ExerciseTag(exercise=ex(gym, "sn"), tag=Tag.objects.filter(gym=elsewhere).first())
    for row in (rx, week, snatch, maxed, tagged):
        with pytest.raises(ValidationError):
            row.clean()
