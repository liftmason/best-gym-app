"""The exercise rail beside a program board or the template editor: search the gym's
active exercises by name, tag or category, filter by tags, and, on an athlete's board, show
their history with each lift and put the most recently done first."""

from django.db.models import Q

from apps.exercises.models import Exercise


def with_history(exercises, athlete, unit):
    """Attach the athlete's history to each exercise: `hist` is None if never logged, else
    {"line": "78 kg ×1 · 2 days ago", "trend": "up", "spark", "date", "log": [(date, top set)]}."""
    from apps.workouts import history
    from apps.workouts.charts import rail_spark

    logs = history.exercise_history(athlete, [e.pk for e in exercises])
    today = athlete.today()
    for ex in exercises:
        entries = logs.get(ex.pk)
        trend = history.trend(entries) if entries else None
        ex.hist = (
            {
                "line": history.last_line(entries[0], unit, today),
                "trend": trend,
                "spark": rail_spark(entries, trend),
                "date": entries[0].date,
                "log": [(e.date, history.set_text(e.top, unit)) for e in entries],
            }
            if entries
            else None
        )
    return exercises


def by_last_done(exercises):
    """Most recently done first; never-done ones after, A–Z."""
    done = sorted(
        (e for e in exercises if e.hist), key=lambda e: (-e.hist["date"].toordinal(), e.name.lower())
    )
    return done + [e for e in exercises if not e.hist]


def search(gym, q="", tag_ids=(), athlete=None, sort="recent"):
    """(exercises, sort): the gym's active exercises matching `q` and every tag. With an
    athlete, each carries their history and "recent" puts the last done first; without one
    (the template editor) the list is always A–Z."""
    sort = "az" if sort == "az" or athlete is None else "recent"
    exercises = (
        Exercise.objects.filter(gym=gym, archived=False)
        .select_related("category")
        .prefetch_related("tags")
        .order_by("name")
    )
    q = (q or "").strip()
    if q:
        exercises = exercises.filter(
            Q(name__icontains=q) | Q(tags__name__icontains=q) | Q(category__name__icontains=q)
        ).distinct()
    for tag_id in tag_ids:
        exercises = exercises.filter(tags__pk=tag_id)
    exercises = list(exercises)
    if athlete is not None:
        exercises = with_history(exercises, athlete, gym.units)
    if sort == "recent":
        exercises = by_last_done(exercises)
    return exercises, sort
