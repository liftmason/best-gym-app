"""shared/parity.json: what the athlete's screens show, worked out by the server's rules, next to
the rows a phone holds. The app computes the same from the same rows offline, and its tests
fail on any difference (docs/plans/S5_ATHLETE.md, step 1). This test fails when the file is
stale: run it with UPDATE_PARITY=1 to rewrite it, then run the app's tests.

The scenario is one athlete two weeks into a program, with fixed ids and the frozen clock:
- sessions done, missed, paused and still ahead, and one finished yesterday (still editable);
- warm-ups, supersets, a section, varied sets, and loads by %, weight, RPE and time;
- a percentage from another lift's max, a PR, and a lift from before the phone's 12 months;
- a check-in answered part-way, and habits of every cadence.

Lists of sessions cover the phone's 12 months (older ones load online); PRs count
everything, the older part through the snapshot's baselines.
"""

import datetime
import itertools
import json
import os
import pathlib
import uuid
from decimal import Decimal

import pytest
import time_machine
from django.apps import apps as django_apps
from django.utils import timezone

from apps.accounts.models import MaxEntry, MeasurementSource
from apps.core.models import Model as BaseModel
from apps.programs import dose as doses
from apps.programs import habits
from apps.programs import services as program_services
from apps.programs.models import HabitLog, WeekType
from apps.sync import bootstrap, scope
from apps.workouts import checkins, history, player, prs, questions, sessions, week
from apps.workouts.models import SessionExercise, SessionLog, SetLog

from ..conftest import ex

PATH = pathlib.Path(__file__).resolve().parents[3] / "shared" / "parity.json"
DAY = datetime.timedelta(days=1)
MONDAY = datetime.date(2026, 9, 14)  # the program's first day; today is Thursday 24 September
pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def still_clock(frozen_clock):
    """The frozen time, not ticking: every timestamp the same on every run."""
    with time_machine.travel(timezone.now().replace(microsecond=0), tick=False) as traveller:
        yield traveller


@pytest.fixture
def fixed_ids(monkeypatch):
    """Ids 00000000-0000-7000-8000-000000000001, …: the same on every run."""
    counter = itertools.count(1)

    def next_id():
        return uuid.UUID(f"00000000-0000-7000-8000-{next(counter):012d}")

    monkeypatch.setattr(uuid, "uuid7", next_id)
    for model in django_apps.get_models():
        if issubclass(model, BaseModel):
            field = model._meta.pk
            monkeypatch.setattr(field, "default", next_id)
            field.__dict__.pop("_get_default", None)


def at(date, hour):
    return datetime.datetime.combine(date, datetime.time(hour), tzinfo=datetime.UTC)


def dose(rx, **raw):
    program_services.edit_prescription(rx, doses.validate({"sets": 1, **raw}, "kg"))
    return rx


def add(day, key, gym, athlete, session=None, **raw):
    rx = program_services.add_prescription(
        day, ex(gym, key), athlete, session_id=session.pk if session else None
    )
    return dose(rx, **raw)


def lift(log, key_order, sets):
    """Log `sets` [(load kg, reps, rir, done)] on the log's exercise at `key_order`."""
    se = log.exercises.get(order=key_order)
    for n, (load, reps, rir, done) in enumerate(sets, start=1):
        sessions.log_set(se, n, load=load, reps=reps, rir=rir, done=done, unit="kg")
    return se


def finish(log, rpe, when, comment=""):
    sessions.finish(log, rpe, comment)
    SessionLog.objects.filter(pk=log.pk).update(
        started_at=when - datetime.timedelta(hours=1), finished_at=when
    )


def build(athlete, coach, gym):
    by = coach.user
    for key, kg, days_ago in (("sn", "80", 200), ("sn", "82", 60), ("cj", "104", 60), ("bsq", "135", 60)):
        MaxEntry.objects.create(
            athlete=athlete,
            exercise=ex(gym, key),
            date=athlete.today() - days_ago * DAY,
            kg=Decimal(kg),
            reps=1,
            source=MeasurementSource.COACH,
        )
    # A lift from before the phone's 12 months: only its best reaches the phone (baselines).
    old = SessionLog.objects.create(
        athlete=athlete, date=athlete.today() - 400 * DAY, name="Old", started_at=at(MONDAY, 9)
    )
    old_se = SessionExercise.objects.create(session_log=old, exercise=ex(gym, "sn"), exercise_name="Snatch")
    SetLog.objects.create(session_exercise=old_se, set_number=1, load_kg=Decimal("84"), reps=1, done=True)
    SessionLog.objects.filter(pk=old.pk).update(finished_at=at(athlete.today() - 400 * DAY, 18))

    accumulation = WeekType.objects.get(gym=gym, name="Accumulation")
    program = program_services.start_program(athlete, "Comp Prep", MONDAY, 3, accumulation, by=by)
    program_services.set_program_note(program, "Openers on the 3rd.")
    w1, w2, w3 = program.weeks.order_by("order")
    program_services.set_focus_note(w2, "Keep every snatch crisp.")
    days1 = {d.date.weekday(): d for d in w1.days.all()}
    days2 = {d.date.weekday(): d for d in w2.days.all()}

    # Week 1: Monday done, Wednesday missed, Friday started and left paused.
    add(days1[0], "sn", gym, athlete, sets=5, rep_scheme="2", load_basis="percent", load_value="70")
    add(days1[0], "bsq", gym, athlete, sets=5, rep_scheme="5", load_basis="percent", load_value="70")
    add(days1[2], "sn", gym, athlete, sets=4, rep_scheme="2", load_basis="percent", load_value="72")
    add(days1[4], "cj", gym, athlete, sets=5, rep_scheme="2", load_basis="percent", load_value="75")

    # Week 2 Monday: warm-up, a section, varied sets, a superset, a fixed weight, a % of another lift.
    add(days2[0], "mob", gym, athlete, warmup=True, rep_scheme="5 min")
    add(
        days2[0],
        "sn",
        gym,
        athlete,
        sets=5,
        rep_scheme="2",
        load_basis="percent",
        load_value="75",
        rir="2",
        note="Stay over the bar.",
        custom_fields=[{"key": "Rest", "value": "2 min"}],
    )
    add(days2[0], "psn", gym, athlete, sets=3, rep_scheme="2", load_basis="percent", load_value="70")
    add(
        days2[0],
        "bsq",
        gym,
        athlete,
        sets=3,
        rep_scheme="5",
        load_basis="percent",
        load_value="70",
        section="Strength",
        section_note="Belt on",
        vary=True,
        set_rows=[{"reps": "5", "load": "70"}, {"reps": "3", "load": "80"}, {"reps": "1", "load": "90"}],
    )
    add(days2[0], "rdl", gym, athlete, sets=3, rep_scheme="8", load_basis="weight", load_value="60")
    add(
        days2[0],
        "row",
        gym,
        athlete,
        sets=3,
        rep_scheme="10",
        load_basis="weight",
        load_value="40",
        superset=True,
    )
    # Wednesday (yesterday): a complex, RPE, and time.
    add(days2[2], "cj", gym, athlete, sets=5, rep_scheme="1+1", load_basis="percent", load_value="80")
    add(days2[2], "fsq", gym, athlete, sets=4, rep_scheme="3", load_basis="rpe", load_value="8")
    add(days2[2], "bike", gym, athlete, sets=5, rep_scheme="2 min")
    # Thursday (today): two sessions.
    add(
        days2[3], "sn", gym, athlete, sets=6, rep_scheme="2", load_basis="percent", load_value="78", rir="1-2"
    )
    add(days2[3], "bsq", gym, athlete, sets=5, rep_scheme="3", load_basis="percent", load_value="80")
    pm = program_services.add_session(days2[3], "PM")
    add(
        days2[3], "pp", gym, athlete, session=pm, sets=4, rep_scheme="5", load_basis="weight", load_value="50"
    )
    add(days2[3], "abw", gym, athlete, session=pm, sets=3, rep_scheme="10")
    # Still ahead.
    add(days2[4], "snp", gym, athlete, sets=4, rep_scheme="3", load_basis="percent", load_value="100")
    add(days2[5], "cj", gym, athlete, sets=3, rep_scheme="1", load_basis="percent", load_value="85")
    # A draft week: never on the phone.
    add(w3.days.order_by("date").first(), "sn", gym, athlete, sets=3, rep_scheme="1")
    program_services.set_published(w1, True)
    program_services.set_published(w2, True)

    questions.add(athlete, "scale")
    choice = questions.add(athlete, "choice")
    questions.add_option(choice, "Legs are sore")

    def start(day, n=0):
        return sessions.start_planned(athlete, list(day.sessions.order_by("order", "id"))[n].pk)

    mon1 = start(days1[0])
    lift(mon1, 0, [("56", 2, 2, True)] * 5)
    lift(mon1, 1, [("95", 5, None, True)] * 4 + [("95", 4, None, True)])
    finish(mon1, 7, at(days1[0].date, 18), "Solid")

    fri1 = start(days1[4])  # paused: one set logged
    lift(fri1, 0, [("78", 2, None, True)])
    SessionLog.objects.filter(pk=fri1.pk).update(started_at=at(days1[4].date, 17))

    mon2 = start(days2[0])
    mon2.exercises.filter(warmup=True).update(checked_at=at(days2[0].date, 17))
    lift(mon2, 1, [("61.5", 2, 2, True)] * 4 + [("85", 1, 0, True)])  # 85 beats the 82 max: a PR
    lift(mon2, 2, [("57.5", 2, None, True)] * 3)
    lift(mon2, 3, [("95", 5, None, True), ("108", 3, None, True), ("121.5", 1, None, True)])
    lift(mon2, 4, [("60", 8, None, True)] * 3)
    lift(mon2, 5, [("40", 10, None, True), ("40", 10, None, True), ("40", 8, None, False)])
    finish(mon2, 8, at(days2[0].date, 18), "Snatch felt fast")

    wed2 = start(days2[2])
    lift(wed2, 0, [("83", 1, None, True)] * 5)
    se = wed2.exercises.get(order=2)
    for n in range(1, 6):
        sessions.log_set(se, n, time="2", time_unit="min", done=n < 5, unit="kg")
    finish(wed2, 6, at(days2[2].date, 23))  # 17 hours ago: still editable

    today_am = start(days2[3])  # the check-in part-way
    first = checkins.questions(athlete)[0]
    checkins.answer(today_am, first, "7")

    habit_daily = habits.prescribe(athlete, "Fruit", "🍎", "daily")
    habit_training = habits.prescribe(athlete, "Mobility", "🧘", "training", "Before every session")
    habit_weekly = habits.prescribe(athlete, "Zone 2", "🚲", "3x")
    today = athlete.today()
    for days_ago in (0, 1, 2, 3, 5, 6):
        HabitLog.objects.create(habit=habit_daily, date=today - days_ago * DAY)
    for d in (days1[0].date, days1[4].date, days2[0].date, days2[2].date):
        HabitLog.objects.create(habit=habit_training, date=d)
    # Three in week 1 (met), one on its Sunday (the week boundary), two so far in week 2.
    for d in (days1[0].date, days1[1].date, days1[3].date, days1[6].date, days2[0].date, days2[1].date):
        HabitLog.objects.create(habit=habit_weekly, date=d)
    return program


# ---------------------------------------------------------------- what the screens show


def dec(value):
    return None if value is None else format(value, "f")


def iso(value):
    return None if value is None else value.isoformat()


def week_json(view):
    out = {"today": iso(view["today"]), "paused": [str(p.pk) for p in view["paused"]]}
    w = view["week"]
    if w is None:
        return {**out, "week": None}
    selected = view["selected"]
    return {
        **out,
        "week": str(w.pk),
        "number": view["week_number"],
        "start": iso(w.start_date),
        "strip": [
            {
                "date": iso(e["day"].date),
                "status": e["status"],
                "count": e["count"],
                "is_today": e["is_today"],
                "selected": e["selected"],
            }
            for e in view["strip"]
        ],
        "cards": [
            {
                "session": str(c["session"].pk),
                "log": str(c["log"].pk) if c["log"] else None,
                "items": c["items"],
                "count": c["count"],
                "state": c["state"],
                "editable": c.get("editable"),
            }
            for c in selected["cards"]
        ]
        if selected
        else None,
        "prev_week": str(view["prev_week"].pk) if view["prev_week"] else None,
        "next_week": str(view["next_week"].pk) if view["next_week"] else None,
    }


def player_json(athlete, log, unit):
    exercises = list(log.exercises.prefetch_related("sets"))
    steps = sessions.steps(exercises)
    out = {
        "resume": list(player.resume_point(log)),
        "steps": [
            {
                "warmup": s["warmup"],
                "items": [str(se.pk) for se in s["items"]],
                "labels": s["labels"],
                "section": s["section"],
                "section_note": s["section_note"],
                "done": sessions.step_done(s),
            }
            for s in steps
        ],
        "exercises": {},
        "counts": list(player.set_counts(log)),
        "top_sets": player.top_sets(log),
        "candidates": [[str(c.set_log.pk), str(c.current.pk)] for c in prs.session_candidates(log)],
    }
    for se in exercises:
        p = sessions.prescribed(se)
        rows, time_unit = player.set_rows(se, p, unit)
        out["exercises"][str(se.pk)] = {
            "rows": rows,
            "time_unit": time_unit,
            "banner": player.banner(p, unit),
            "last_time": player.last_time(athlete, se, log, unit),
            "measure": player.measure_for(se, p),
            "planned_sets": sessions.planned_sets(se),
        }
    return out


def history_json(athlete, unit, since):
    today = athlete.today()
    by_exercise = history.exercise_history(athlete, since=since)
    return {
        "lifetime_prs": [
            {
                "exercise_id": str(pr["exercise_id"]),
                "name": pr["name"],
                "heaviest": history.set_text(pr["heaviest"], unit),
                "heaviest_date": iso(pr["heaviest_date"]),
                "e1rm": history.e1rm_text(pr["e1rm"], unit) if pr["e1rm"] else None,
                "e1rm_date": iso(pr["e1rm_date"]),
                "date": iso(pr["date"]),
            }
            for pr in history.lifetime_prs(athlete, with_ids=True)
        ],
        "pr_session_exercises": sorted(str(i) for i in history.pr_session_exercises(athlete)),
        "streak": history.streak(athlete),
        "compliance": list(history.compliance(athlete, today)),
        "next_session": iso(history.next_session_date(athlete, today)),
        "recent": [str(log.pk) for log in history.recent_finished(athlete, since=since)],
        "exercises": {
            str(exercise_id): {
                "trend": history.trend(entries),
                "entries": [
                    {
                        "date": iso(e.date),
                        "log": str(e.log_id),
                        "session_exercise": str(e.session_exercise_id),
                        "top": history.set_text(e.top, unit),
                        "best_e1rm": dec(e.best_e1rm),
                        "sets": history.sets_text(e.sets, unit),
                        "last_line": history.last_line(e, unit, today),
                    }
                    for e in entries
                ],
            }
            for exercise_id, entries in by_exercise.items()
        },
    }


def habits_json(athlete, date):
    return [
        {
            "habit": str(i["habit"].pk),
            "done": i["done"],
            "met_for_week": i["met_for_week"],
            "week_count": i["week_count"],
            "streak": i["streak"],
        }
        for i in habits.for_day(athlete, date)
    ]


def parity(athlete, coach, gym):
    build(athlete, coach, gym)
    athlete.refresh_from_db()
    today = athlete.today()
    snapshot = bootstrap.snapshot(athlete)
    since = snapshot["history_from"]
    logs = list(athlete.session_logs.filter(date__gte=since).order_by("date", "id"))
    week_days = [None, *(MONDAY + i * DAY for i in range(14)), MONDAY + 21 * DAY]
    expect = {}
    for unit in ("kg", "lb"):
        athlete.units = unit  # the week's cards use the athlete's own unit (not saved)
        expect[unit] = {
            "week": [
                {
                    "wanted_day": iso(d),
                    "view": week_json(week.week_view(athlete, wanted_week=d, wanted_day=d)),
                }
                for d in week_days
            ],
            "player": {str(log.pk): player_json(athlete, log, unit) for log in logs},
            "history": history_json(athlete, unit, since),
        }
    athlete.units = "kg"
    expect["habits"] = {iso(MONDAY + i * DAY): habits_json(athlete, MONDAY + i * DAY) for i in range(11)}
    return {
        "about": (
            "What the athlete's screens show, by the server's rules, from the rows a phone "
            "holds. Written by backend/tests/unit/test_parity.py (UPDATE_PARITY=1); checked by "
            "app/src/domain/parity.test.ts."
        ),
        "now": timezone.now().isoformat(),
        "today": iso(today),
        "athlete": {
            "id": str(athlete.pk),
            "user_id": str(athlete.user_id),
            "units": athlete.units,
            "timezone": athlete.user.timezone,
            "week_start": athlete.gym.week_start,
            "max_updates": athlete.max_updates,
        },
        "snapshot": {
            "tables": {k: v for k, v in sorted(snapshot["tables"].items())},
            "history_from": iso(snapshot["history_from"]),
            "baselines": snapshot["baselines"],
        },
        "expect": expect,
    }


def test_the_committed_parity_file_is_current(fixed_ids, still_clock, athlete, coach, gym):
    text = json.dumps(parity(athlete, coach, gym), indent=1, sort_keys=True, default=str) + "\n"
    if os.environ.get("UPDATE_PARITY"):
        PATH.write_text(text)
    assert PATH.exists() and PATH.read_text() == text, "run: UPDATE_PARITY=1 pytest tests/unit/test_parity.py"


def test_every_synced_table_is_in_the_scenario(fixed_ids, still_clock, athlete, coach, gym):
    """So a new synced table is checked too, or listed here as having no rules on the phone."""
    tables = parity(athlete, coach, gym)["snapshot"]["tables"]
    no_rules = {
        "workouts_issuereport",
        "workouts_formvideo",
        "messaging_thread",
        "messaging_message",
        "accounts_bodyweightentry",
        "programs_prescriptiontag",
        "exercises_tag",
        "exercises_exercisetag",
        "exercises_trackedlift",
        "accounts_coaching",
    }  # S5b and screens without derived rules
    empty = {t for t, rows in tables.items() if not rows} - no_rules
    assert not empty, f"tables with no rows in the parity scenario: {sorted(empty)}"
    assert set(tables) == {scope.table_of(label) for label in [*scope.ATHLETE, *scope.LIBRARY]}
