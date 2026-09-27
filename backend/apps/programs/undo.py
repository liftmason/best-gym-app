"""Undo for edits within one program week (docs/BUILD_PLAN.md, "Undo").

Before each board edit, `record()` stores a JSON snapshot of the week (type, focus
note, sessions, prescriptions with every dose field, tags and per-set overrides).
`undo()` restores the latest snapshot and deletes it. Restoring matches rows by id, so
moved and edited exercises come back as they were, including one moved to another week of
the program; a session an athlete has logged is never removed. Sessions are placed by day
of the week (0-6 from the week's start), so a snapshot still fits after the week has moved
(duplicating, deleting or applying weeks shifts later ones). Adding, duplicating or
deleting weeks and applying templates aren't recorded: they have their own confirm or
preview.
"""

from decimal import Decimal

from django.db import transaction

from apps.exercises.models import Exercise, Tag

from .models import EditHistory, PrescribedSet, Prescription, PrescriptionTag, ProgramSession, WeekType
from .prescriptions import COPIED_FIELDS

UNDO_DEPTH = 50
# Bump when the snapshot's shape changes; older snapshots are dropped, not half-restored.
SNAPSHOT_VERSION = 2


def _dec(value):
    return None if value is None else str(value)


def snapshot(week):
    sessions = []
    for session in (
        ProgramSession.objects.filter(day__week=week)
        .select_related("day")
        .prefetch_related("prescriptions__set_overrides", "prescriptions__tag_slot_tags")
    ):
        rxs = []
        for rx in session.prescriptions.all():
            fields = {f: getattr(rx, f) for f in COPIED_FIELDS}
            fields["load_value"] = _dec(fields["load_value"])
            rxs.append(
                {
                    "id": str(rx.pk),
                    "order": rx.order,
                    "exercise": str(rx.exercise_id),
                    "fields": fields,
                    "tags": [str(t.pk) for t in rx.tag_slot_tags.all()],
                    "overrides": [
                        {
                            "set_number": s.set_number,
                            "rep_scheme": s.rep_scheme,
                            "reps": s.reps,
                            "load_value": _dec(s.load_value),
                        }
                        for s in rx.set_overrides.all()
                    ],
                }
            )
        sessions.append(
            {
                "id": str(session.pk),
                "day": (session.day.date - week.start_date).days,
                "order": session.order,
                "name": session.name,
                "prescriptions": rxs,
            }
        )
    return {
        "v": SNAPSHOT_VERSION,
        "week_type": str(week.week_type_id) if week.week_type_id else None,
        "focus_note": week.focus_note,
        "sessions": sessions,
    }


def record(week, user, label):
    EditHistory.objects.create(program_week=week, coach=user, label=label[:120], snapshot=snapshot(week))
    stale = EditHistory.objects.filter(program_week=week).values_list("pk", flat=True)[UNDO_DEPTH:]
    EditHistory.objects.filter(pk__in=list(stale)).delete()


def latest(week):
    return EditHistory.objects.filter(program_week=week).first()


@transaction.atomic
def undo(week):
    """Restore the latest snapshot; returns its label (None if there's nothing to undo)."""
    entry = latest(week)
    if entry is None:
        return None
    if entry.snapshot.get("v") != SNAPSHOT_VERSION:
        EditHistory.objects.filter(program_week=week).delete()  # all older than this one
        return None
    restore(week, entry.snapshot)
    label = entry.label
    entry.delete()
    return label


def restore(week, snap):
    week_type = WeekType.objects.filter(pk=snap["week_type"], gym=week.program.athlete.gym).first()
    if week_type:
        week.week_type = week_type
    week.focus_note = snap["focus_note"]
    week.save(update_fields=["week_type", "focus_note"])

    days = {(d.date - week.start_date).days: d for d in week.days.all()}
    gym = week.program.athlete.gym
    wanted = [r for s in snap["sessions"] for r in s["prescriptions"]]
    # Everything restoring reads, loaded up front (audit M15): sessions, exercises, tags and
    # the prescriptions themselves, from anywhere in the program (one may have moved week).
    sessions = {str(x.pk): x for x in ProgramSession.objects.filter(day__week=week)}
    exercises = {
        str(e.pk): e for e in Exercise.objects.filter(gym=gym, pk__in={r["exercise"] for r in wanted})
    }
    tags = {str(t.pk): t for t in Tag.objects.filter(gym=gym, pk__in={t for r in wanted for t in r["tags"]})}
    existing = {
        str(rx.pk): rx
        for rx in Prescription.objects.filter(
            pk__in=[r["id"] for r in wanted], session__day__week__program=week.program
        ).select_related("session__day")
    }
    restored_sessions, left, updated, created, overrides, tagged = set(), set(), [], [], [], []
    # Put sessions and exercises back first, then delete what the snapshot didn't have:
    # deleting a session first would cascade to exercises that are about to move back.
    for s in snap["sessions"]:
        day = days.get(s["day"])
        if day is None:
            continue
        session = sessions.get(s["id"]) or ProgramSession(pk=s["id"], day=day)
        session.day, session.order, session.name = day, s["order"], s["name"]
        session.save()
        restored_sessions.add(session.pk)
        for r in s["prescriptions"]:
            exercise = exercises.get(r["exercise"])
            if exercise is None:
                continue  # deleted from the library since
            rx = existing.get(r["id"])
            if rx is None:
                rx = Prescription(pk=r["id"])  # removed since: back with the same id
                created.append(rx)
            else:
                if rx.session.day.week_id != week.pk:
                    left.add(rx.session)
                updated.append(rx)
            rx.session, rx.order, rx.exercise = session, r["order"], exercise
            for field, value in r["fields"].items():
                setattr(rx, field, Decimal(value) if field == "load_value" and value is not None else value)
            tagged.append((rx, [tags[t] for t in r["tags"] if t in tags]))
            overrides += [
                PrescribedSet(
                    prescription=rx,
                    set_number=o["set_number"],
                    rep_scheme=o["rep_scheme"],
                    reps=o["reps"],
                    load_value=Decimal(o["load_value"]) if o["load_value"] is not None else None,
                )
                for o in r["overrides"]
            ]
    Prescription.objects.bulk_update(updated, ["session", "order", "exercise", *COPIED_FIELDS])
    Prescription.objects.bulk_create(created)
    restored_rx = {rx.pk for rx in updated + created}
    PrescribedSet.objects.filter(prescription__in=restored_rx).delete()
    PrescribedSet.objects.bulk_create(overrides)
    PrescriptionTag.objects.filter(prescription__in=restored_rx).delete()
    PrescriptionTag.objects.bulk_create(
        [PrescriptionTag(prescription=rx, tag=t) for rx, ts in tagged for t in ts]
    )
    logged = set(
        ProgramSession.objects.filter(day__week=week, logs__isnull=False).values_list("pk", flat=True)
    )
    # Sessions logged since the snapshot are never removed, nor their exercises.
    Prescription.objects.filter(session__day__week=week).exclude(pk__in=restored_rx).exclude(
        session_id__in=logged - restored_sessions
    ).delete()
    ProgramSession.objects.filter(day__week=week).exclude(pk__in=restored_sessions | logged).delete()
    # Sessions in other weeks that exercises came back from: tidy as a move would.
    from .services import _empty_and_unused, _renumber

    for other in left:
        if _empty_and_unused(other):
            other.delete()
        else:
            _renumber(other)
