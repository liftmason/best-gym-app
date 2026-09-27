"""The change log (apps/sync): a Postgres trigger on every synced table records inserts,
updates and deletes, bulk ones included, with the row's owner."""

import pytest
from django.apps import apps as django_apps
from django.db import connection

from apps.accounts.models import BodyweightEntry
from apps.programs import services as program_services
from apps.programs.models import WeekType
from apps.sync import triggers
from apps.sync.models import Change
from apps.workouts import questions

from ..conftest import ex
from ..factories import AthleteFactory

pytestmark = pytest.mark.django_db


def changes(table=None):
    rows = Change.objects.order_by("seq")
    return list(rows.filter(table=table) if table else rows)


def test_every_synced_table_has_the_trigger():
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname = %s",
            [triggers.TRIGGER],
        )
        have = {row[0] for row in cursor.fetchall()}
    missing = [
        label for label in triggers.labels() if django_apps.get_model(label)._meta.db_table not in have
    ]
    assert not missing, f"add the sync trigger to: {missing} (see apps/sync/triggers.py)"


def test_inserts_updates_and_deletes_are_logged_with_their_owner(athlete):
    Change.objects.all().delete()
    entry = BodyweightEntry.objects.create(athlete=athlete, date=athlete.today(), kg=70, source="athlete")
    entry.kg = 71
    entry.save()
    entry_id = entry.pk
    entry.delete()
    logged = changes("accounts_bodyweightentry")
    assert [(c.op, c.row_id, c.athlete_id, c.gym_id) for c in logged] == [
        ("I", entry_id, athlete.pk, None),
        ("U", entry_id, athlete.pk, None),
        ("D", entry_id, athlete.pk, None),
    ]


def test_bulk_updates_and_deletes_are_logged_too(athlete):
    for day in range(3):
        BodyweightEntry.objects.create(
            athlete=athlete, date=athlete.today().replace(day=day + 1), kg=70, source="athlete"
        )
    Change.objects.all().delete()
    BodyweightEntry.objects.filter(athlete=athlete).update(kg=72)
    BodyweightEntry.objects.filter(athlete=athlete).delete()
    assert [c.op for c in changes()] == ["U"] * 3 + ["D"] * 3


def test_library_rows_are_logged_for_the_gym(gym):
    Change.objects.all().delete()
    snatch = ex(gym, "sn")
    snatch.cue = "Patience"
    snatch.save()
    (change,) = changes("exercises_exercise")
    assert (change.gym_id, change.athlete_id) == (gym.pk, None)


def test_check_in_questions_are_the_gyms_or_an_athletes(gym, athlete):
    Change.objects.all().delete()
    questions.add(gym, "text")
    questions.add(athlete, "text")
    owners = [(c.gym_id, c.athlete_id) for c in changes("workouts_checkinquestion")]
    assert owners == [(gym.pk, None), (None, athlete.pk)]


def test_a_row_moved_to_another_owner_leaves_the_first(athlete, coach):
    entry = BodyweightEntry.objects.create(athlete=athlete, date=athlete.today(), kg=70, source="athlete")
    other = AthleteFactory(coach=coach)
    Change.objects.all().delete()
    BodyweightEntry.objects.filter(pk=entry.pk).update(athlete=other)
    assert [(c.op, c.athlete_id) for c in changes()] == [("D", athlete.pk), ("U", other.pk)]


def test_publishing_a_week_logs_every_row_under_it(athlete, coach, gym):
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program = program_services.start_program(athlete, "P", athlete.today(), 1, week_type, by=coach.user)
    week = program.weeks.get()
    program_services.add_prescription(week.days.first(), ex(gym, "sn"), athlete)
    Change.objects.all().delete()
    program_services.set_published(week, True)
    tables = {c.table for c in changes()}
    assert {
        "programs_programweek",
        "programs_programday",
        "programs_programsession",
        "programs_prescription",
    } <= tables
    assert len({c.txid for c in changes()}) == 1  # one transaction
    assert all(c.athlete_id == athlete.pk for c in changes())
