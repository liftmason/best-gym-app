"""The coach's Sessions and Overview tabs for one athlete. What they show is worked out in
apps/workouts/coach_summary.py; these views only render it."""

from django.template.response import TemplateResponse

from . import charts, coach_summary


def sessions_tab(request, athlete, header_context):
    q = request.GET.get("q", "").strip()
    items, range_key = coach_summary.session_list(
        athlete, request.coach.gym.units, q, request.GET.get("range", "8")
    )
    context = {
        **header_context,
        "tab": "sessions",
        "items": items,
        "q": q,
        "range_key": range_key,
        "ranges": coach_summary.RANGES,
    }
    if request.htmx and request.htmx.target == "sessLog":
        return TemplateResponse(request, "coach/athlete/_sessions_list.html", context)
    return TemplateResponse(request, "coach/athlete/sessions.html", context)


# ---------------------------------------------------------------- Overview tab


def overview_tab(request, athlete, header_context):
    unit = request.coach.gym.units
    lifts, lift = coach_summary.chart_lift(athlete, request.GET.get("lift"))
    volume_svg, _weeks = charts.volume_chart(athlete, unit)
    context = {
        **header_context,
        "tab": "overview",
        "lifts": lifts,
        "lift": lift,
        "e1rm_svg": charts.e1rm_chart(athlete, lift, unit) if lift else "",
        "volume_svg": volume_svg,
        "unit": unit,
        "checkins": coach_summary.recent_checkins(athlete),
        "glance": coach_summary.week_glance(athlete),
        "prs": coach_summary.top_prs(athlete, unit),
    }
    if request.htmx and request.htmx.target == "e1rmChart":
        return TemplateResponse(request, "coach/athlete/_e1rm_chart.html", context)
    return TemplateResponse(request, "coach/athlete/overview.html", context)
