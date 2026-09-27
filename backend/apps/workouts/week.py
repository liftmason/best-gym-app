"""The athlete's week: which week and day open, each day's status, and each session's card
(what's in it, and whether it can be started, resumed, filled in afterwards or waits for its
day). Read-only; the views (and later the API) show what these return."""

from apps.programs.prescriptions import layout, summary

from . import history


def published_weeks(program):
    return list(program.weeks.filter(published=True).select_related("week_type")) if program else []


def pick_week(weeks, today, wanted):
    if not weeks:
        return None
    if wanted:
        for w in weeks:
            if w.start_date <= wanted <= w.end_date:
                return w
    for w in weeks:
        if w.start_date <= today <= w.end_date:
            return w
    # Before the first published week, show it; after the last, show the last.
    return weeks[0] if today < weeks[0].start_date else weeks[-1]


def pick_day(week, today, wanted=None):
    """The day that opens: the one asked for if it's in the week, else today if it is,
    else the week's first day."""
    if wanted and week.start_date <= wanted <= week.end_date:
        return wanted
    return today if week.start_date <= today <= week.end_date else week.start_date


def card_state(log, day_date, today):
    """done, paused, start (today), backfill (a day gone by: log what was done), or locked
    (a day still ahead)."""
    if log and log.finished:
        return "done"
    if log:
        return "paused"
    if day_date == today:
        return "start"
    return "backfill" if day_date < today else "locked"


def session_card(athlete, session, log, day_date, today, unit):
    warmups, entries = layout(session.prescriptions.all())
    items = []
    if warmups:
        n = len(warmups)
        items.append({"name": "Warm-up", "dose": f"{n} drill{'s' if n != 1 else ''}"})
    for e in entries:
        rx = e["item"]
        dose = summary(rx, unit, list(rx.set_overrides.all()), custom=False)
        items.append({"name": f"{e['label']} {rx.exercise.name}".strip(), "dose": dose})
    card = {
        "session": session,
        "log": log,
        "items": items,
        "count": len(entries),
    }
    card["state"] = card_state(log, day_date, today)
    if card["state"] == "done":
        card["editable"] = log.editable()
    return card


def week_view(athlete, wanted_week=None, wanted_day=None):
    """Everything the week screen shows. `wanted_week` / `wanted_day` are dates."""
    today = athlete.today()
    program = athlete.programs.active().first()
    weeks = published_weeks(program)
    week = pick_week(weeks, today, wanted_week)
    view = {"program": program, "week": week, "today": today}
    paused = list(athlete.session_logs.unfinished().order_by("-started_at"))
    if week is None:
        view["paused"] = paused
        return view
    days = list(
        week.days.prefetch_related(
            "sessions__prescriptions__exercise", "sessions__prescriptions__set_overrides", "sessions__logs"
        )
    )
    done_ids = history.finished_session_ids(athlete)
    selected_date = pick_day(week, today, wanted_day)
    strip = []
    selected = None
    for day in days:
        sessions_ = list(day.sessions.all())
        entry = {
            "day": day,
            "status": history.day_status(day, today, done_ids),
            "count": sum(1 for s in sessions_ for rx in s.prescriptions.all() if not rx.warmup),
            "is_today": day.date == today,
            "selected": day.date == selected_date,
        }
        strip.append(entry)
        if entry["selected"]:
            selected = entry
            entry["cards"] = [
                session_card(athlete, s, next(iter(s.logs.all()), None), day.date, today, athlete.units)
                for s in sessions_
            ]
    index = weeks.index(week)
    view.update(
        {
            "strip": strip,
            "selected": selected,
            "week_number": week.order + 1,
            "prev_week": weeks[index - 1] if index > 0 else None,
            "next_week": weeks[index + 1] if index + 1 < len(weeks) else None,
            "paused": [p for p in paused if p.date != selected_date],
        }
    )
    return view
