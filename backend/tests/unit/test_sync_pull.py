"""Pull (apps/sync/pull.py). These run with real transactions (transaction=True): the
cursor works on committed transactions, and a test's own open transaction would hold it."""

import threading

import pytest
from django.db import connection, transaction

from apps.accounts import coaching
from apps.accounts.models import BodyweightEntry
from apps.core import sync as synced
from apps.programs import services as program_services
from apps.programs.models import WeekType
from apps.sync import pull, scope

from ..conftest import ex
from ..factories import AthleteFactory, CoachFactory, GymFactory

pytestmark = pytest.mark.django_db(transaction=True)


def first_cursor(athlete):
    """From the start of the log (a real phone starts from its bootstrap's cursor)."""
    return pull.encode({"lo": 0, "hi": None, "after": 0, "gym": str(athlete.gym.pk)})


def drain(athlete, cursor, limit=pull.PAGE):
    """Pull until there's no more: ({(table, id): row or None}, cursor, pages)."""
    seen, pages = {}, 0
    while True:
        page = pull.pull(athlete, cursor, limit)
        pages += 1
        for c in page["changes"]:
            seen[(c["table"], c["id"])] = c["row"]
        cursor = page["cursor"]
        if not page["more"]:
            return seen, cursor, pages


def rows(seen, table):
    return {k[1]: v for k, v in seen.items() if k[0] == table and v is not None}


def test_every_synced_table_is_on_the_phone_or_deliberately_not():
    on_phone = set(scope.ATHLETE) | set(scope.LIBRARY)
    coach_only = {
        "library.Template",
        "library.TemplateWeek",
        "library.TemplateSession",
        "library.TemplateSlot",
        "library.TemplateSlotSet",
        "library.TemplateSlotTag",
        "library.TemplateHabit",
    }
    assert set(synced.BY_ATHLETE) <= on_phone
    assert set(synced.BY_GYM) == set(scope.LIBRARY) | coach_only


def test_an_athlete_gets_their_own_rows_and_their_gyms_library(athlete, coach, gym):
    mine = BodyweightEntry.objects.create(athlete=athlete, date=athlete.today(), kg=70, source="athlete")
    other = AthleteFactory(coach=coach)
    BodyweightEntry.objects.create(athlete=other, date=other.today(), kg=90, source="athlete")
    GymFactory(pack="weightlifting")  # another gym's library
    seen, _, _ = drain(athlete, first_cursor(athlete))
    assert set(rows(seen, "accounts_bodyweightentry")) == {str(mine.pk)}
    exercises = rows(seen, "exercises_exercise")
    assert exercises and all(r["gym_id"] == str(gym.pk) for r in exercises.values())
    assert not rows(seen, "library_template")


def test_draft_weeks_never_sync(athlete, coach, gym):
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program = program_services.start_program(athlete, "P", athlete.today(), 1, week_type, by=coach.user)
    week = program.weeks.get()
    rx = program_services.add_prescription(week.days.first(), ex(gym, "sn"), athlete)
    seen, cursor, _ = drain(athlete, first_cursor(athlete))
    assert not rows(seen, "programs_programweek") and not rows(seen, "programs_prescription")
    assert rows(seen, "programs_program")  # the program itself (its name) is theirs

    program_services.set_published(week, True)
    seen, cursor, _ = drain(athlete, cursor)
    assert str(week.pk) in rows(seen, "programs_programweek") and str(rx.pk) in rows(
        seen, "programs_prescription"
    )

    program_services.set_published(week, False)
    seen, cursor, _ = drain(athlete, cursor)
    assert seen[("programs_prescription", str(rx.pk))] is None  # it leaves the phone


def test_deleted_rows_become_markers(athlete):
    entry = BodyweightEntry.objects.create(athlete=athlete, date=athlete.today(), kg=70, source="athlete")
    _, cursor, _ = drain(athlete, first_cursor(athlete))
    entry_id = str(entry.pk)
    entry.delete()
    seen, _, _ = drain(athlete, cursor)
    assert seen == {("accounts_bodyweightentry", entry_id): None}


def test_an_ended_programs_weeks_leave_the_phone(athlete, coach, gym):
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    old = program_services.start_program(athlete, "Old", athlete.today(), 1, week_type, by=coach.user)
    program_services.set_published(old.weeks.get(), True)
    _, cursor, _ = drain(athlete, first_cursor(athlete))
    program_services.start_program(athlete, "New", athlete.today(), 1, week_type, by=coach.user)
    seen, _, _ = drain(athlete, cursor)
    assert seen[("programs_programweek", str(old.weeks.get().pk))] is None
    assert seen[("programs_program", str(old.pk))] is None


def test_pages_add_up_to_everything(athlete):
    for day in range(1, 8):
        BodyweightEntry.objects.create(
            athlete=athlete, date=athlete.today().replace(day=day), kg=70, source="athlete"
        )
    everything, _, _ = drain(athlete, first_cursor(athlete))
    paged, _, pages = drain(athlete, first_cursor(athlete), limit=3)
    assert paged == everything and pages > 3


def test_a_transaction_that_commits_late_is_not_skipped(athlete):
    # Transaction A writes first (a lower sequence number) but commits after B. A cursor
    # that only remembered "after sequence N" would pass A by for good.
    wrote, release = threading.Event(), threading.Event()

    def slow():
        try:
            with transaction.atomic():
                BodyweightEntry.objects.create(
                    athlete=athlete, date=athlete.today().replace(day=1), kg=71, source="athlete"
                )
                wrote.set()
                release.wait(10)
        finally:
            connection.close()

    thread = threading.Thread(target=slow)
    thread.start()
    wrote.wait(10)
    fast = BodyweightEntry.objects.create(
        athlete=athlete, date=athlete.today().replace(day=2), kg=72, source="athlete"
    )
    early, cursor, _ = drain(athlete, first_cursor(athlete))
    assert str(fast.pk) not in rows(early, "accounts_bodyweightentry")  # held back behind A, not lost
    release.set()
    thread.join()
    later, _, _ = drain(athlete, cursor)
    assert len(rows(early, "accounts_bodyweightentry")) + len(rows(later, "accounts_bodyweightentry")) == 2


def test_a_new_gym_replaces_the_library(athlete, coach):
    _, cursor, _ = drain(athlete, first_cursor(athlete))
    elsewhere = CoachFactory(gym=GymFactory(pack="weightlifting"))
    coaching.end(athlete)
    coaching.start(elsewhere, athlete)
    page = pull.pull(athlete, cursor)
    assert page["library_reset"] and page["library"]
    assert {r["row"]["gym_id"] for r in page["library"]} == {str(elsewhere.gym.pk)}
    assert not pull.pull(athlete, page["cursor"])["library_reset"]


def test_a_made_up_cursor_is_refused(athlete):
    with pytest.raises(pull.BadCursor):
        pull.pull(athlete, "not-a-cursor")


def test_a_phone_that_missed_trimmed_changes_bootstraps_again(athlete):
    import datetime

    from apps.core import errors
    from apps.sync import bootstrap, purge

    BodyweightEntry.objects.create(athlete=athlete, date=athlete.today(), kg=70, source="athlete")
    from django.utils import timezone

    from apps.sync.models import Change

    stale = first_cursor(athlete)
    # The trigger stamps changes with the database's clock, not the test's frozen one.
    Change.objects.update(at=timezone.now() - datetime.timedelta(days=purge.KEEP_DAYS + 1))
    assert purge.purge() >= 1
    with pytest.raises(errors.Gone):
        pull.pull(athlete, stale)
    fresh = bootstrap.snapshot(athlete)
    assert pull.pull(athlete, fresh["cursor"])["more"] is False  # a new copy pulls on fine
