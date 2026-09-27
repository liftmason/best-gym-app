"""Push (apps/sync/push.py and actions.py): a whole session logged offline, repeats changing
nothing, rejections not blocking the rest, and a temporary failure stopping the batch."""

import datetime
import uuid

import pytest
from django.test import Client
from django.utils import timezone

from apps.programs import habits
from apps.programs import services as program_services
from apps.programs.models import HabitLog, WeekType
from apps.signin import services as signin
from apps.sync import actions, push
from apps.sync.models import SyncAction
from apps.workouts import questions
from apps.workouts.models import IssueReport, SessionLog, SetLog

from ..conftest import ex
from ..factories import AthleteFactory

pytestmark = pytest.mark.django_db
DAY = datetime.timedelta(days=1)


def act(name, **payload):
    return {"id": uuid.uuid7(), "name": name, "at": timezone.now(), "payload": payload}


@pytest.fixture
def planned(athlete, coach, gym):
    """Today's published session with a snatch; returns the ProgramSession."""
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program = program_services.start_program(athlete, "P", athlete.today(), 1, week_type, by=coach.user)
    week = program.weeks.get()
    program_services.set_published(week, True)
    day = week.days.get(date=athlete.today())
    program_services.add_prescription(day, ex(gym, "sn"), athlete)
    return day.sessions.get()


def offline_session(athlete, planned):
    """What a phone queues for a whole session done with no signal, with the ids it chose."""
    log_id, se_id = uuid.uuid7(), uuid.uuid7()
    rx = planned.prescriptions.get()
    question = questions.add(athlete, "scale")
    return (
        log_id,
        se_id,
        [
            act(
                "session.start",
                session_log_id=log_id,
                program_session_id=planned.pk,
                exercises=[{"id": se_id, "prescription_id": rx.pk}],
            ),
            act(
                "checkin.answer",
                answer_id=uuid.uuid7(),
                session_log_id=log_id,
                question_id=question.pk,
                value="7",
            ),
            act("checkin.finish", session_log_id=log_id),
            act(
                "set.save",
                set_id=uuid.uuid7(),
                session_exercise_id=se_id,
                set_number=1,
                load_kg="80",
                reps=2,
                done=True,
            ),
            act(
                "set.save",
                set_id=uuid.uuid7(),
                session_exercise_id=se_id,
                set_number=2,
                load_kg="85",
                reps=2,
                done=True,
            ),
            act("session.finish", session_log_id=log_id, rpe=8, comment="Felt quick"),
        ],
    )


def test_a_session_logged_offline_arrives_with_the_phones_ids(athlete, planned):
    log_id, se_id, batch = offline_session(athlete, planned)
    results = push.push(athlete, batch)
    assert [r["status"] for r in results] == ["done"] * 6
    log = SessionLog.objects.get()
    assert log.pk == log_id and log.finished and log.session_rpe == 8
    assert list(SetLog.objects.order_by("set_number").values_list("session_exercise_id", "load_kg")) == [
        (se_id, 80),
        (se_id, 85),
    ]
    assert results[0]["result"]["session_log_id"] == str(log_id)


def test_sending_the_batch_again_changes_nothing(athlete, planned):
    _, _, batch = offline_session(athlete, planned)
    first = push.push(athlete, batch)
    again = push.push(athlete, batch)
    assert again == first
    assert SessionLog.objects.count() == 1 and SetLog.objects.count() == 2 and SyncAction.objects.count() == 6


def test_a_rejected_action_does_not_block_the_rest(athlete, planned):
    log_id, se_id, batch = offline_session(athlete, planned)
    batch.insert(4, act("set.save", set_id=uuid.uuid7(), session_exercise_id=se_id, set_number=0, reps=2))
    results = push.push(athlete, batch)
    assert [r["status"] for r in results] == ["done"] * 4 + ["rejected"] + ["done"] * 2
    assert results[4]["error"]["code"] == "invalid_set"
    assert SyncAction.objects.get(pk=batch[4]["id"]).ok is False  # stored: a repeat says the same


def test_a_temporary_failure_stops_the_batch_for_a_retry(athlete, planned, monkeypatch):
    _, _, batch = offline_session(athlete, planned)
    schema, handler = actions.ACTIONS["set.save"]

    def down(*args):
        raise RuntimeError("database went away")

    monkeypatch.setitem(actions.ACTIONS, "set.save", (schema, down))
    results = push.push(athlete, batch)
    assert [r["status"] for r in results] == ["done", "done", "done", "retry", "retry", "retry"]
    assert SyncAction.objects.count() == 3
    monkeypatch.setitem(actions.ACTIONS, "set.save", (schema, handler))
    assert [r["status"] for r in push.push(athlete, batch)] == ["done"] * 6


def test_bad_actions_are_rejected(athlete, planned):
    results = push.push(athlete, [act("session.teleport"), act("set.save", set_number="many")])
    assert [r["error"]["code"] for r in results] == ["invalid", "invalid_payload"]


def test_another_athletes_things_are_not_found(athlete, coach, planned):
    other = AthleteFactory(coach=coach)
    log_id, _, batch = offline_session(athlete, planned)
    push.push(athlete, batch)
    (result,) = push.push(other, [act("session.finish", session_log_id=log_id, rpe=5)])
    assert result["status"] == "rejected" and result["error"]["code"] == "not_found"
    (reused,) = push.push(other, [batch[0]])  # someone else's action id
    assert (
        reused["status"] == "rejected"
        and SyncAction.objects.filter(pk=batch[0]["id"], athlete=athlete).exists()
    )


def test_a_session_already_started_elsewhere_returns_the_servers_ids(athlete, planned):
    from apps.workouts import sessions

    started = sessions.start_planned(athlete, planned.pk)  # on another device
    rx = planned.prescriptions.get()
    (result,) = push.push(
        athlete,
        [
            act(
                "session.start",
                session_log_id=uuid.uuid7(),
                program_session_id=planned.pk,
                exercises=[{"id": uuid.uuid7(), "prescription_id": rx.pk}],
            )
        ],
    )
    assert result["result"]["session_log_id"] == str(started.pk)
    assert result["result"]["exercises"] == {str(rx.pk): str(started.exercises.get().pk)}


def test_a_habit_ticked_offline_counts_on_the_day_it_was_ticked(athlete, frozen_clock):
    habit = habits.prescribe(athlete, "Sleep", "😴", "daily")
    ticked_at = timezone.now()
    day = athlete.today()
    frozen_clock.shift(3 * DAY)  # synced three days later
    action = act("habit.set", habit_id=habit.pk, date=day, done=True) | {"at": ticked_at}
    (result,) = push.push(athlete, [action])
    assert result["status"] == "done" and HabitLog.objects.filter(habit=habit, date=day).exists()
    late = act("habit.set", habit_id=habit.pk, date=day, done=False)  # "now" is three days on
    assert push.push(athlete, [late])[0]["error"]["code"] == "cannot_tick"


def test_issue_reports_are_limited(athlete, planned):
    log_id, _, batch = offline_session(athlete, planned)
    push.push(athlete, batch[:1])
    reports = [
        act("issue.report", issue_id=uuid.uuid7(), session_log_id=log_id, kind="pain", text="Wrist")
        for _ in range(11)
    ]
    statuses = [r["status"] for r in push.push(athlete, reports)]
    assert statuses == ["done"] * 10 + ["rejected"] and IssueReport.objects.count() == 10


def test_messages_and_metrics(athlete):
    message_id = uuid.uuid7()
    results = push.push(
        athlete,
        [
            act("message.send", message_id=message_id, body="Knee is better"),
            act("metrics.update", values={"bodyweight": "71.5"}),
        ],
    )
    assert results[0]["result"] == {"message_id": str(message_id)}
    assert results[1]["result"] == {"saved": ["bodyweight"]}


def test_the_push_endpoint(athlete, planned):
    _, _, batch = offline_session(athlete, planned)
    body = {"actions": [a | {"id": str(a["id"]), "at": a["at"].isoformat()} for a in batch]}
    import json

    api = Client(
        HTTP_AUTHORIZATION=f"Bearer {signin.open_session(athlete.user).access}", HTTP_X_SCHEMA_VERSION="1"
    )
    response = api.post("/api/v1/sync/push", json.dumps(body, default=str), content_type="application/json")
    assert response.status_code == 200 and [r["status"] for r in response.json()["results"]] == ["done"] * 6
