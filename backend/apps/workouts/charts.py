"""The numbers behind the app's charts (the app draws them; nothing here is stored).

- e1RM trend: an exercise's session e1RM (best set) over its last CHART_POINTS sessions, with
  the bodyweight at the time and the week type of the program week it fell in; consecutive
  points in the same week type form one phase band, so a dip reads against the block that
  caused it.
- Weekly volume and compliance: load × reps per training week (the gym's weeks), and
  compliance %, over the last 8 weeks.
- Progress: the change in e1RM over the athlete's chart, in their unit.
"""

import datetime
from decimal import Decimal

from apps.accounts import units

from . import history

CHART_POINTS = 12


def _week_type_on(athlete, date, weeks):
    for w in weeks:
        if w.start_date <= date <= w.start_date + datetime.timedelta(days=6):
            return w.week_type
    return None


def e1rm_points(athlete, exercise, limit=CHART_POINTS):
    """[(date, e1rm kg, bodyweight kg or None, week type or None)], oldest first."""
    from apps.programs.models import ProgramWeek

    entries = history.exercise_history(athlete, [exercise.pk], limit=limit).get(exercise.pk, [])
    entries = [e for e in reversed(entries) if e.best_e1rm]
    weeks = list(ProgramWeek.objects.filter(program__athlete=athlete).select_related("week_type"))
    bodyweights = list(athlete.bodyweights.order_by("date", "id"))
    points = []
    for e in entries:
        bw = next((b.kg for b in reversed(bodyweights) if b.date <= e.date), None)
        points.append((e.date, e.best_e1rm, bw, _week_type_on(athlete, e.date, weeks)))
    return points


def phase_bands(points):
    """[(week type, first index, last index)]: runs of consecutive e1RM points in the same
    week type (points with none are left out)."""
    bands, i = [], 0
    while i < len(points):
        week_type, j = points[i][3], i
        while j + 1 < len(points) and points[j + 1][3] == week_type:
            j += 1
        if week_type is not None:
            bands.append((week_type, i, j))
        i = j + 1
    return bands


def weekly(athlete, weeks=8):
    """[(week start, volume kg, compliance % or None)] for the last `weeks` training weeks."""
    from .models import SetLog

    today = athlete.today()
    this_week = athlete.gym.week_start_for(today)
    starts = [this_week - datetime.timedelta(weeks=n) for n in range(weeks - 1, -1, -1)]
    sets = SetLog.objects.filter(
        done=True,
        load_kg__isnull=False,
        reps__isnull=False,
        session_exercise__session_log__athlete=athlete,
        session_exercise__session_log__finished_at__isnull=False,
        session_exercise__session_log__date__gte=starts[0],
    ).values_list("session_exercise__session_log__date", "load_kg", "reps")
    volume = dict.fromkeys(starts, Decimal(0))
    for date, load, reps in sets:
        volume[athlete.gym.week_start_for(date)] += load * reps
    rows = []
    for start in starts:
        done, scheduled = history.compliance(
            athlete, today, end=min(start + datetime.timedelta(days=6), today)
        )
        rows.append((start, volume[start], round(done / scheduled * 100) if scheduled else None))
    return rows


def progress_change(athlete, exercise, unit):
    """{"change", "drop", "weeks"}: how far the e1RM moved (in `unit`, rounded) over the
    athlete's chart and over how many weeks; None with fewer than two points."""
    points = e1rm_points(athlete, exercise)
    if len(points) < 2:
        return None
    first, last = (float(units.from_kg(p[1], unit)) for p in (points[0], points[-1]))
    change = round(last - first)
    days = (points[-1][0] - points[0][0]).days
    return {"change": change, "drop": abs(change), "weeks": max(1, round(days / 7))}


def rail_series(entries):
    """The small trend beside a lift in the exercise rail: best e1RM (or top load) per
    session, oldest first; empty with fewer than two sessions."""
    values = [e.best_e1rm or (e.top.load_kg if e.top else 0) for e in reversed(entries)]
    return values if len(values) >= 2 else []


def chart_lifts(athlete):
    """Exercises worth charting: the gym's tracked lifts, then others the athlete has
    logged with a load."""
    from apps.exercises.models import Exercise, tracked_exercises

    tracked = list(tracked_exercises(athlete.gym))
    logged = history.exercise_history(athlete, limit=2)
    others = (
        Exercise.objects.filter(pk__in=[k for k, v in logged.items() if any(e.best_e1rm for e in v)])
        .exclude(pk__in=[e.pk for e in tracked])
        .order_by("name")
    )
    return tracked + list(others)


def progress_lifts(athlete):
    """The lifts the athlete's Progress chart offers: tracked or logged lifts with at least
    two e1RM points (one point isn't a line)."""
    return [e for e in chart_lifts(athlete) if len(e1rm_points(athlete, e)) >= 2]
