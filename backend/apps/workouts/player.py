"""What the session player shows, read-only: where a session picks up again, each exercise's
set rows (logged values, or the suggested ones), the prescription banner, and the counts on
the done screen. The views (and later the API) show what these return."""

from apps.accounts import units
from apps.programs.models import LoadBasis
from apps.programs.prescriptions import load_text, rir_text

from . import checkins, sessions


def resume_point(log):
    """Where a session picks up: ("checkin", n) for the next unanswered question,
    ("checkin_summary", None), ("player", n) for the first unfinished screen, or
    ("finish", None). A finished session reopens at its first screen for review."""
    if not log.finished and not log.checkin_skipped:
        answered = set(log.answers.values_list("question_id", flat=True))
        questions = checkins.questions(log.athlete)
        if questions and not log.exercises.filter(sets__isnull=False).exists():
            for n, q in enumerate(questions, start=1):
                if q.pk not in answered:
                    return ("checkin", n)
            return ("checkin_summary", None)
    steps = sessions.steps(log.exercises.prefetch_related("sets"))
    # Once any set is logged the warm-up is behind them, ticked or not.
    lifting = any(s.done for step in steps for se in step["items"] for s in se.sets.all())
    for n, step in enumerate(steps, start=1):
        if step["warmup"] and lifting:
            continue
        if not sessions.step_done(step):
            return ("player", n)
    if log.finished and steps:
        return ("player", 1)
    return ("finish", None)


def time_unit(p):
    """Timed work is entered in minutes when it's prescribed in whole minutes of 2 or more."""
    seconds = p.duration_seconds if p else None
    return "min" if seconds and seconds >= 120 and seconds % 60 == 0 else "s"


def set_rows(se, p, unit):
    logged = {s.set_number: s for s in se.sets.all()}
    planned = (len(p.overrides) or p.sets) if p else 0
    count = max([planned, *logged.keys(), 1])
    overrides = {o.set_number: o for o in p.overrides} if p else {}
    unit_of_time = time_unit(p)
    rows = []
    for number in range(1, count + 1):
        s = logged.get(number)
        o = overrides.get(number)
        if s is not None:
            load = units.from_kg(s.load_kg, unit).normalize() if s.load_kg is not None else ""
            reps = s.reps if s.reps is not None else ""
            seconds = s.duration_seconds
            rir = "" if s.rir is None else str(s.rir)
            done = s.done
        else:
            load, reps, rir, done = "", "", "", False
            seconds = p.duration_seconds if p else None
            if p:
                load_value = o.load_value if o and o.load_value is not None else p.load_value
                load = sessions.suggested_load(p, load_value, unit) or ""
                reps = (o.reps if o and o.reps is not None else p.reps) or ""
        if seconds is None:
            time = ""
        elif unit_of_time == "min":
            time = format((seconds / 60), "g")
        else:
            time = seconds
        rows.append(
            {
                "number": number,
                "load": format(load, "f") if load != "" else "",
                "reps": reps,
                "time": time,
                "rir": rir,
                "done": done,
                "placeholder": (o.rep_scheme if o and o.rep_scheme else p.rep_scheme) if p else "",
            }
        )
    return rows, unit_of_time


def banner(p, unit):
    if p is None:
        return None
    reps = p.rep_scheme or ("—" if not p.sets else "")
    load = load_text(p.load_basis, p.load_value, unit)
    hint = "prescribed load" if load else ""
    if p.overrides:
        hint = "loads vary by set"
    if p.load_basis == LoadBasis.PERCENT:
        kg = sessions.target_kg(p, p.load_value)
        if kg:
            hint = f"≈ {sessions.plate_round(kg, unit)} {unit} from your {p.max_exercise} max"
            if p.overrides:
                hint = f"loads vary by set · {p.max_exercise} max {units.display(p.max_kg, unit)}"
        else:
            hint = "no max on file, go by feel"
    rir = rir_text(p.rir, p.rir_max)
    return {"sets": len(p.overrides) or p.sets, "reps": reps, "load": load, "rir": rir, "hint": hint}


def set_counts(log):
    exercises = list(log.exercises.filter(warmup=False).prefetch_related("sets"))
    done = sum(1 for se in exercises for s in se.sets.all() if s.done)
    planned = sum(max(sessions.planned_sets(se), sum(1 for s in se.sets.all() if s.done)) for se in exercises)
    return len(exercises), done, planned


def top_sets(log):
    """How many exercises had at least one completed set with a load."""
    return sum(
        1 for se in log.exercises.prefetch_related("sets") if any(s.done and s.load_kg for s in se.sets.all())
    )


def last_time(athlete, se, log, unit):
    """ "78 kg ×1 · 7 days ago" for the exercise's last logged top set before this session,
    or None the first time (or if the exercise was deleted)."""
    from . import history

    if se.exercise is None:
        return None
    entries = history.exercise_history(athlete, [se.exercise_id], exclude_log=log, limit=1).get(
        se.exercise_id
    )
    return history.last_line(entries[0], unit, athlete.today()) if entries else None


def measure_for(se, p):
    """How the exercise is logged: its own measure, or (deleted from the library) time if it
    was prescribed as time, else reps."""
    from apps.exercises.models import Measure

    if se.exercise is not None:
        return se.exercise.measure
    return Measure.TIME if p and p.duration_seconds else Measure.REPS
