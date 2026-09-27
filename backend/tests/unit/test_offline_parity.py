"""The phone's own offline session, sent to the real server (docs/plans/S5_ATHLETE.md, step 5).

app/src/training/session/flow.test.tsx logs today's second session through the app's real
screens with no connection, on the parity scenario, and keeps what the phone would send
(shared/offline-session.json). Here the same scenario, with the same ids, takes that batch:
every action must be accepted, and the server's rules must then show what the phone showed.
"""

import datetime
import json
import pathlib

import pytest

from apps.sync import push
from apps.workouts import player, week
from apps.workouts.models import SessionLog

from .test_parity import build

PATH = pathlib.Path(__file__).resolve().parents[3] / "shared" / "offline-session.json"
pytestmark = pytest.mark.django_db(transaction=True)


def test_the_phones_offline_session_is_accepted_and_reads_the_same(
    fixed_ids, still_clock, athlete, coach, gym
):
    build(athlete, coach, gym)
    sent = json.loads(PATH.read_text())
    actions = [a | {"at": datetime.datetime.fromisoformat(a["at"])} for a in sent["actions"]]
    results = push.push(athlete, actions)
    assert [r["status"] for r in results] == ["done"] * len(actions), [
        r for r in results if r["status"] != "done"
    ]

    log = SessionLog.objects.get(pk=sent["log"])
    shown = sent["shown"]
    assert log.finished and log.session_rpe == shown["rpe"]
    assert list(player.set_counts(log)) == shown["counts"]
    assert log.answers.count() == shown["answers"] and log.issues.count() == shown["issues"]
    view = week.week_view(athlete)
    (card,) = [c for c in view["selected"]["cards"] if c["log"] and c["log"].pk == log.pk]
    assert card["state"] == "done" and card["editable"]

    again = push.push(athlete, actions)  # a retry after a lost answer changes nothing
    assert again == results and SessionLog.objects.filter(pk=log.pk).count() == 1
