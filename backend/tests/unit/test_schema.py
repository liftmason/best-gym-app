"""The database's own rules (S0 step 5): UUIDv7 ids, check constraints, case-insensitive
uniqueness, protected training history and the explicit erase, the snapshot version."""

import uuid
from decimal import Decimal

import pytest
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.utils import timezone

from apps.accounts import erase
from apps.accounts.models import BodyweightEntry, MaxEntry, User
from apps.dashboard.models import Notification, NotificationKind
from apps.exercises.models import Exercise
from apps.messaging import services as messaging
from apps.messaging.models import Message, Thread
from apps.programs import habits
from apps.programs import services as program_services
from apps.programs.models import LoadBasis, Prescription, Program, WeekType
from apps.workouts import sessions
from apps.workouts.models import SessionLog, SetLog

from ..conftest import cat, ex
from ..factories import AthleteFactory, UserFactory

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
