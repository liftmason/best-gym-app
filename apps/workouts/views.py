"""The athlete app: week, check-in, session player, post-session, done, progress, profile.

Every lookup goes through request.athlete. A session log is found with _log(), which
404s for anyone else's. Screens are plain pages (boosted links and forms swap
#app-body); only set rows save in the background, one request per set.
"""

import datetime

from django.contrib import messages
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect
from django.template.response import TemplateResponse
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_POST

from apps import hx
from apps.accounts import services as account_services
from apps.accounts import units
from apps.accounts.access import athlete_required
from apps.accounts.metrics import current_metrics, metric_specs, missing_metrics
from apps.programs.models import ProgramSession

from . import charts, checkins, history, issues, sessions
from . import player as screens
from . import week as week_screen
from .forms import RIR_CHOICES, FinishForm, IssueForm
from .models import EDIT_WINDOW, OTHER_OPTION, SessionLog
from .video_views import video_context


def _log(request, log_id):
    return get_object_or_404(
        SessionLog.objects.select_related("program_session__day__week", "week_type"),
        pk=log_id,
        athlete=request.athlete,
    )


def _coach_first_name(athlete):
    return athlete.coach.user.get_short_name()


# ---------------------------------------------------------------- home / week


def _parse_date(value):
    try:
        return datetime.date.fromisoformat(value) if value else None
    except ValueError:
        return None


@athlete_required
def home(request):
    athlete = request.athlete
    from apps.programs.habit_views import athlete_card_context

    view = week_screen.week_view(
        athlete, _parse_date(request.GET.get("week")), _parse_date(request.GET.get("day"))
    )
    context = {
        "tab": "week",
        "coach_name": _coach_first_name(athlete),
        **athlete_card_context(athlete),
        **view,
    }
    return TemplateResponse(request, "app/home.html", context)


@athlete_required
@require_POST
def start(request, session_id):
    """Start (or resume) a planned session: today's, or a missed one filled in afterwards."""
    try:
        log = sessions.start_planned(request.athlete, session_id)
    except ProgramSession.DoesNotExist as err:
        raise Http404 from err
    except sessions.NotYetUnlocked as locked:
        messages.error(request, f"This session unlocks on {locked.date:%A}.")
        return redirect(f"{reverse('app:home')}?day={locked.date.isoformat()}")
    return redirect(_resume_url(log))


@athlete_required
def resume(request, log_id):
    return redirect(_resume_url(_log(request, log_id)))


def _questions(athlete):
    return checkins.questions(athlete)


def _resume_url(log):
    """The page for sessions' resume point (apps/workouts/player.py)."""
    where, n = screens.resume_point(log)
    if where == "checkin":
        return reverse("app:checkin", args=[log.pk, n])
    if where == "checkin_summary":
        return reverse("app:checkin_summary", args=[log.pk])
    if where == "player":
        return reverse("app:player", args=[log.pk, n])
    return reverse("app:finish", args=[log.pk])


# ---------------------------------------------------------------- check-in


def _flow(tabless_context):
    return {"hide_tabs": True, "tab": None, **tabless_context}


@athlete_required
def checkin(request, log_id, n):
    log = _log(request, log_id)
    if log.finished:
        return redirect("app:player", log.pk, 1)
    questions = _questions(request.athlete)
    if not 1 <= n <= len(questions):
        return redirect("app:checkin_summary", log.pk)
    question = questions[n - 1]
    answer = log.answers.filter(question=question).first()
    error = ""
    if request.method == "POST":
        try:
            checkins.answer(log, question, request.POST.get("value", ""), request.POST.get("other_text", ""))
        except checkins.InvalidAnswer:
            pass
        else:
            if n < len(questions):
                return redirect("app:checkin", log.pk, n + 1)
            return redirect("app:checkin_summary", log.pk)
        error = "Pick an answer to continue."
    total = len(questions) + 1
    context = _flow(
        {
            "log": log,
            "question": question,
            "answer": answer,
            "n": n,
            "total": total,
            "progress": round(n / total * 100),
            "back_url": reverse("app:checkin", args=[log.pk, n - 1]) if n > 1 else reverse("app:home"),
            "scale": range(1, 11),
            "other_option": OTHER_OPTION,
            "coach_name": _coach_first_name(request.athlete),
            "error": error,
        }
    )
    return TemplateResponse(request, "app/checkin.html", context)


@athlete_required
def checkin_summary(request, log_id):
    log = _log(request, log_id)
    if log.finished:
        return redirect("app:player", log.pk, 1)
    if request.method == "POST":
        checkins.finish(log, skip=request.POST.get("action") == "skip")
        return redirect("app:player", log.pk, 1)
    questions = _questions(request.athlete)
    total = len(questions) + 1
    context = _flow(
        {
            "log": log,
            "answers": list(log.answers.all()),
            "n": total,
            "total": total,
            "back_url": reverse("app:checkin", args=[log.pk, len(questions)])
            if questions
            else reverse("app:home"),
            "exercise_count": log.exercises.filter(warmup=False).count(),
        }
    )
    return TemplateResponse(request, "app/checkin_summary.html", context)


# ---------------------------------------------------------------- session player


def _block(se, athlete, log, unit, editable, label=""):
    """Everything the player shows for one exercise: the rx banner, set rows, demo link,
    history line and form videos."""
    p = sessions.prescribed(se)
    exercise = se.exercise
    measure = screens.measure_for(se, p)
    rows, time_unit = screens.set_rows(se, p, unit)
    last = screens.last_time(athlete, se, log, unit)
    return {
        "se": se,
        "p": p,
        "label": label,
        "exercise": exercise,
        "measure": measure,
        "rows": rows,
        "time_unit": time_unit,
        "banner": screens.banner(p, unit),
        "custom_fields": p.custom_fields if p else [],
        "last": last,
        **video_context(se, editable),
    }


@athlete_required
def player(request, log_id, n):
    """Screen n of a session: the warm-up checklist, or one exercise (a superset's
    exercises share a screen)."""
    athlete = request.athlete
    log = _log(request, log_id)
    steps = sessions.steps(
        log.exercises.select_related("exercise__category").prefetch_related("sets", "videos")
    )
    if not steps:
        return redirect("app:finish", log.pk)
    if not 1 <= n <= len(steps):
        return redirect("app:player", log.pk, 1)
    unit = athlete.units
    step = steps[n - 1]
    editable = log.editable()
    dots = ["on" if i == n else "done" if sessions.step_done(s) else "" for i, s in enumerate(steps, start=1)]
    blocks = []
    if not step["warmup"]:
        labels = step["labels"] or [""]
        blocks = [
            _block(se, athlete, log, unit, editable, labels[i] if i < len(labels) else "")
            for i, se in enumerate(step["items"])
        ]
    last_step = n == len(steps)
    title = "Warm-up" if step["warmup"] else " + ".join(se.exercise_name for se in step["items"])
    context = _flow(
        {
            "log": log,
            "step": step,
            "title": title,
            "warmups": [
                {"se": se, "p": sessions.prescribed(se), "exercise": se.exercise} for se in step["items"]
            ]
            if step["warmup"]
            else [],
            "blocks": blocks,
            "superset": len(blocks) > 1,
            "rir_choices": RIR_CHOICES,
            "n": n,
            "total": len(steps),
            "progress": round((n - 1) / len(steps) * 100 + 5),
            "dots": dots,
            "unit": unit,
            "editable": editable,
            "edit_until": log.finished_at + EDIT_WINDOW if log.finished_at else None,
            "coach_name": _coach_first_name(athlete),
            "prev_url": reverse("app:player", args=[log.pk, n - 1]) if n > 1 else None,
            "next_url": reverse("app:player", args=[log.pk, n + 1])
            if not last_step
            else (reverse("app:finish", args=[log.pk]) if editable else None),
            "next_label": ("Start lifting →" if step["warmup"] else "Next exercise →")
            if not last_step
            else ("Next →" if log.finished else "Finish session →"),
            "exit_url": reverse("app:pause", args=[log.pk]),
            "max_mb": blocks[0]["max_mb"] if blocks else None,
        }
    )
    return TemplateResponse(request, "app/player.html", context)


@athlete_required
@require_POST
def warmup_check(request, log_id, se_id):
    """Tick (or untick) one warm-up drill."""
    log = _log(request, log_id)
    se = get_object_or_404(log.exercises, pk=se_id, warmup=True)
    try:
        sessions.check_warmup(se, request.POST.get("checked") == "1")
    except sessions.SessionClosed:
        return hx.toast(HttpResponse(status=409), "This session can no longer be changed.", "bad")
    return TemplateResponse(
        request,
        "app/_warmup_item.html",
        {
            "w": {"se": se, "p": sessions.prescribed(se), "exercise": se.exercise},
            "log": log,
            "editable": True,
        },
    )


@athlete_required
@require_POST
def save_set(request, log_id, se_id, number):
    """One set, saved as it's ticked or changed. JSON so the row can retry on failure."""
    log = _log(request, log_id)
    if not log.editable():
        return JsonResponse({"error": "This session can no longer be changed."}, status=409)
    se = get_object_or_404(log.exercises, pk=se_id)
    if not 1 <= number <= sessions.MAX_SET_NUMBER:
        raise Http404
    post = request.POST
    try:
        sessions.log_set(
            se,
            number,
            load=post.get("load", "").strip(),
            reps=post.get("reps", "").strip(),
            time=post.get("time", "").strip(),
            time_unit=post.get("time_unit") or "s",
            rir=post.get("rir", "").strip(),
            done=bool(post.get("done")),
            unit=request.athlete.units,
        )
    except sessions.InvalidSet:
        return JsonResponse({"error": "Check the numbers in this set."}, status=400)
    except sessions.SessionClosed:
        return JsonResponse({"error": "This session can no longer be changed."}, status=409)
    return JsonResponse({"saved": True})


@athlete_required
def pause(request, log_id):
    log = _log(request, log_id)
    if log.finished:
        return redirect("app:progress")
    messages.info(request, "Session paused — pick it up any time")
    return redirect(f"{reverse('app:home')}?day={log.date.isoformat()}")


# ---------------------------------------------------------------- post-session and done


@athlete_required
def finish(request, log_id):
    log = _log(request, log_id)
    if not log.editable():
        return redirect("app:player", log.pk, 1)
    form = FinishForm(request.POST or None, initial={"rpe": log.session_rpe, "comment": log.comment})
    if request.method == "POST" and form.is_valid():
        first_time = not log.finished
        sessions.finish(log, form.cleaned_data["rpe"], form.cleaned_data["comment"])  # the form checked both
        if first_time:
            return redirect("app:done", log.pk)
        messages.success(request, "Changes saved")
        return redirect("app:progress")
    count = len(sessions.steps(log.exercises.prefetch_related("sets")))
    context = _flow(
        {
            "log": log,
            "form": form,
            "rpe": form["rpe"].value(),
            "scale": range(1, 11),
            "coach_name": _coach_first_name(request.athlete),
            "back_url": reverse("app:player", args=[log.pk, count]) if count else reverse("app:home"),
            "issues": list(log.issues.all()),
        }
    )
    return TemplateResponse(request, "app/finish.html", context)


@athlete_required
def issue(request, log_id):
    log = _log(request, log_id)
    form = IssueForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        issues.report(log, form.cleaned_data["kind"], form.cleaned_data["text"])
        response = TemplateResponse(request, "app/_issue_list.html", {"issues": list(log.issues.all())})
        hx.toast(response, f"Sent — {_coach_first_name(request.athlete)} has been notified", "good")
        return hx.trigger_after_swap(response, closeModal=True)
    template = "app/_issue_modal.html" if request.method == "GET" else "app/_issue_form.html"
    response = TemplateResponse(
        request, template, {"log": log, "form": form, "coach_name": _coach_first_name(request.athlete)}
    )
    if request.method == "POST":
        hx.retarget(response, "#issueForm", "outerHTML")
    return response


@athlete_required
def done(request, log_id):
    athlete = request.athlete
    log = _log(request, log_id)
    if not log.finished:
        return redirect(_resume_url(log))
    exercise_count, sets_done, sets_planned = screens.set_counts(log)
    today = athlete.today()
    next_date = history.next_session_date(athlete, today)
    top_sets = screens.top_sets(log)
    context = _flow(
        {
            "log": log,
            "exercise_count": exercise_count,
            "sets_done": sets_done,
            "sets_planned": sets_planned,
            "streak": history.streak(athlete, today),
            "next_date": next_date,
            "today": today,
            "top_sets": top_sets,
            "coach_name": _coach_first_name(athlete),
        }
    )
    return TemplateResponse(request, "app/done.html", context)


# ---------------------------------------------------------------- progress and profile


@athlete_required
def progress(request):
    athlete = request.athlete
    unit = athlete.units
    today = athlete.today()
    prs = [
        {
            "name": pr["name"],
            "heaviest": history.set_text(pr["heaviest"], unit),
            "heaviest_ago": history.ago(pr["heaviest_date"], today),
            "e1rm": history.e1rm_text(pr["e1rm"], unit) if pr["e1rm"] else "",
            "e1rm_ago": history.ago(pr["e1rm_date"], today) if pr["e1rm_date"] else "",
        }
        for pr in history.lifetime_prs(athlete)
    ]
    recent = history.recent_finished(athlete)
    now = timezone.now()
    lifts = charts.progress_lifts(athlete)
    lift = next((e for e in lifts if str(e.pk) == request.GET.get("lift")), lifts[0] if lifts else None)
    chart, change = charts.progress_chart(athlete, lift, unit) if lift else (None, None)
    context = {
        "lifts": lifts,
        "lift": lift,
        "chart": chart,
        "change": change,
        "unit": unit,
        "tab": "progress",
        "program": athlete.programs.active().first(),
        "coach_name": _coach_first_name(athlete),
        "prs": prs,
        "recent": [{"log": log, "editable": log.editable(now)} for log in recent],
    }
    return TemplateResponse(request, "app/progress.html", context)


@athlete_required
def profile(request):
    athlete = request.athlete
    specs = metric_specs(athlete.gym)
    current = current_metrics(athlete, specs)
    rows = []
    for spec in specs:
        m = current[spec.key]
        if m["value"] in (None, ""):
            value = None
        elif spec.kind == "weight":
            value = units.display(m["kg"], athlete.units)
        elif spec.kind == "height":
            value = f"{format(m['value'].normalize(), 'f')} cm"
        else:
            value = m["value"]
        rows.append({"label": spec.label, "value": value})
    context = {
        "tab": "profile",
        "rows": rows,
        "missing_count": len(missing_metrics(athlete, specs)),
        "coach_name": _coach_first_name(athlete),
    }
    return TemplateResponse(request, "app/profile.html", context)


@athlete_required
@require_POST
def units_setting(request):
    """Kilograms or pounds for this athlete's app (loads are stored in kg either way)."""
    athlete = request.athlete
    if request.POST.get("units") in ("kg", "lb"):
        account_services.set_units(athlete, request.POST["units"])
        messages.success(request, f"Weights now show in {athlete.get_units_display().lower()}")
    return redirect("app:profile")
