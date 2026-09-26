"""The program editor on the athlete's Program tab: week strip, 7-day board,
prescription modal and library rail. Every change goes through services.py and
returns the redrawn editor (#programEditor) with a toast."""

from django.contrib import messages
from django.core.exceptions import ObjectDoesNotExist
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404, redirect
from django.template.response import TemplateResponse
from django.urls import reverse
from django.views.decorators.http import require_POST

from apps import hx
from apps.accounts.access import coach_required
from apps.accounts.coach_views import _header_context, coach_athlete
from apps.exercises.models import Exercise, Tag

from . import rail, services, undo
from .dose import MAX_CUSTOM_FIELDS, MAX_SETS
from .forms import PrescriptionForm, StartProgramForm, set_rows_initial
from .models import LoadBasis, WeekType
from .prescriptions import load_text, suggested_weight, summary

# ------------------------------------------------------ lookups (always scoped to the coach's athlete)


def _program(athlete):
    return services.active_program(athlete)


def _scoped(lookup, athlete, pk):
    try:
        return lookup(athlete, pk)
    except ObjectDoesNotExist as err:
        raise Http404 from err


def _week(athlete, week_id):
    return _scoped(services.athlete_week, athlete, week_id)


def _day(athlete, day_id):
    return _scoped(services.athlete_day, athlete, day_id)


def _session(athlete, session_id):
    return _scoped(services.athlete_session, athlete, session_id)


def _rx(athlete, rx_id):
    return _scoped(services.athlete_prescription, athlete, rx_id)


# ---------------------------------------------------------------- rendering


def _current_week(program, athlete, week_id=None):
    return services.board_week(program, athlete.today(), week_id)


def editor_context(request, athlete, week_id=None):
    unit = request.coach.gym.units
    program = _program(athlete)
    context = {
        "athlete": athlete,
        "program": program,
        "unit": unit,
        "today": athlete.today(),
        "max_sets": MAX_SETS,
    }
    if program is None:
        return context
    weeks, week = _current_week(program, athlete, week_id)
    context.update({"weeks": weeks, "week": week})
    if week is None:
        return context
    days = services.board_days(week, unit)
    week_types = services.week_type_choices(week)
    context.update({"days": days, "week_types": week_types, "undo_entry": undo.latest(week)})
    return context


def _with_apply_preview(request, athlete, context):
    """While a template is being previewed on this board (apps/library/apply_views.py)."""
    from apps.library.apply_views import apply_context

    context.update(apply_context(request, athlete))
    return context


def render_editor(request, athlete, week_id=None, message=None, kind=""):
    context = _with_apply_preview(request, athlete, editor_context(request, athlete, week_id))
    response = TemplateResponse(request, "programs/_editor.html", context)
    return hx.toast(response, message, kind) if message else response


def rail_context(request, athlete=None, template=None):
    """The exercise library rail. On an athlete's board it shows their history and adds
    to the selected day; in the template editor (`template`) it adds to the selected
    session and can add tag slots from the active tag filter."""
    gym = request.coach.gym
    q = request.GET.get("q", "").strip()
    tag_ids = {t for t in request.GET.getlist("tag") if t.isdigit()}
    exercises, sort = rail.search(gym, q, tag_ids, athlete, request.GET.get("sort", "recent"))
    if template is not None:
        where = {
            "rail_search_url": reverse("coach:template_library", args=[template.pk]),
            "rail_add_url": reverse("coach:template_add_slot", args=[template.pk]),
            "rail_tag_slot_url": reverse("coach:template_add_tag_slot", args=[template.pk]),
            "rail_target": "#tplEditor",
            "rail_selected": "#selectedSession",
            "rail_where": "session",
        }
    else:
        where = {
            "rail_search_url": reverse("coach:program_library", args=[athlete.pk]),
            "rail_add_url": reverse("coach:day_add_exercise", args=[athlete.pk]),
            "rail_target": "#programEditor",
            "rail_selected": "#selectedDay",
            "rail_where": "day",
        }
    return {
        **where,
        "rail_athlete": athlete,
        "rail_exercises": exercises,
        "rail_tags": Tag.objects.filter(gym=gym),
        "rail_tag_ids": {int(t) for t in tag_ids},
        "rail_q": q,
        "rail_sort": sort,
        "rail_total": Exercise.objects.filter(gym=gym, archived=False).count(),
    }


@coach_required
def program_tab(request, pk):
    athlete = coach_athlete(request, pk)
    context = {
        **_header_context(request, athlete),
        "tab": "program",
        **_with_apply_preview(request, athlete, editor_context(request, athlete, request.GET.get("week"))),
        **rail_context(request, athlete),
    }
    if _program(athlete) is None:
        context["start_form"] = StartProgramForm(gym=athlete.gym, today=athlete.today())
    from .habit_views import coach_card_context

    context.update({k: v for k, v in coach_card_context(athlete).items() if k != "athlete"})
    return TemplateResponse(request, "programs/program_tab.html", context)


@coach_required
def library(request, pk):
    athlete = coach_athlete(request, pk)
    return TemplateResponse(
        request, "programs/_rail_list.html", {"athlete": athlete, **rail_context(request, athlete)}
    )


# ---------------------------------------------------------------- programs and weeks


@coach_required
def start(request, pk):
    """GET: the 'start a new program' modal. POST: start it (ending the current one)."""
    athlete = coach_athlete(request, pk)
    form = StartProgramForm(request.POST or None, gym=athlete.gym, today=athlete.today())
    context = {"athlete": athlete, "start_form": form, "has_program": _program(athlete) is not None}
    if request.method != "POST":
        return TemplateResponse(request, "programs/_start_modal.html", context)
    if not form.is_valid():
        return TemplateResponse(request, "programs/_start_form.html", context)
    data = form.cleaned_data
    had_program = _program(athlete) is not None
    try:
        services.start_new_program(
            athlete, data["name"], data["first_day"], data["weeks"], data["week_type"], by=request.user
        )
    except services.InvalidProgram as err:
        form.add_error(None, str(err))
        return TemplateResponse(request, "programs/_start_form.html", context)
    note = " The previous program was ended and kept." if had_program else ""
    messages.success(
        request,
        f"Started “{data['name']}” with {data['weeks']} week{'s' if data['weeks'] != 1 else ''}.{note}",
    )
    url = reverse("coach:program", args=[athlete.pk])
    if request.htmx:
        response = HttpResponse("")
        response["HX-Redirect"] = url  # a fresh page: new program, new weeks, new rail state
        return response
    return redirect(url)


@coach_required
@require_POST
def program_note(request, pk):
    """The program's note (goal, rest, nutrition), saved as the coach types."""
    athlete = coach_athlete(request, pk)
    program = _program(athlete)
    if program is None:
        raise Http404
    services.set_program_note(program, request.POST.get("note", ""))
    return hx.toast(HttpResponse(""), "Program note saved")


@coach_required
@require_POST
def week_add(request, pk):
    athlete = coach_athlete(request, pk)
    program = _program(athlete)
    if program is None:
        raise Http404
    try:
        week = services.add_week_at_end(program)
    except services.InvalidProgram as err:
        return render_editor(request, athlete, message=str(err), kind="bad")
    return render_editor(
        request, athlete, week.pk, f"{week.label} added at the end ({week.start_date:%-d %b})"
    )


@coach_required
@require_POST
def week_duplicate(request, pk, week_id):
    athlete = coach_athlete(request, pk)
    try:
        copy = services.duplicate_week(_week(athlete, week_id))
    except services.HasLoggedSessions as e:
        return render_editor(request, athlete, week_id, str(e), "err")
    return render_editor(
        request,
        athlete,
        copy.pk,
        f"Duplicated into {copy.label} — later weeks moved back a week. It isn't published yet.",
        "good",
    )


@coach_required
@require_POST
def week_delete(request, pk, week_id):
    athlete = coach_athlete(request, pk)
    week = _week(athlete, week_id)
    label = week.label
    try:
        services.delete_week(week)
    except services.HasLoggedSessions as e:
        return render_editor(request, athlete, week_id, str(e), "err")
    return render_editor(request, athlete, message=f"Deleted {label} — later weeks moved up a week")


@coach_required
@require_POST
def week_clear(request, pk, week_id):
    athlete = coach_athlete(request, pk)
    week = _week(athlete, week_id)
    kept = services.clear_week(week, by=request.user)
    message = "Week cleared" + (f" — {kept} completed day{'s' if kept != 1 else ''} kept" if kept else "")
    return render_editor(request, athlete, week.pk, message)


@coach_required
@require_POST
def week_publish(request, pk, week_id):
    athlete = coach_athlete(request, pk)
    week = _week(athlete, week_id)
    publish = request.POST.get("publish") == "1"
    services.set_published(week, publish)
    first = athlete.user.get_short_name()
    message = (
        f"{week.label} published — {first} sees it now, and later edits go live straight away"
        if publish
        else f"{week.label} unpublished — {first} no longer sees it"
    )
    return render_editor(request, athlete, week.pk, message, "good" if publish else "")


@coach_required
@require_POST
def week_settings(request, pk, week_id):
    athlete = coach_athlete(request, pk)
    week = _week(athlete, week_id)
    if "week_type" in request.POST:
        week_type = get_object_or_404(WeekType, pk=request.POST["week_type"], gym=athlete.gym)
        try:
            services.set_week_type(week, week_type, by=request.user)
        except services.NotAllowed as err:
            raise Http404 from err
        return render_editor(request, athlete, week.pk, f"{week.label} is now {week_type.name}")
    services.set_focus_note(week, request.POST.get("focus_note", ""), by=request.user)
    return hx.toast(_undo_button_oob(request, athlete, week), "Focus note saved")


# ---------------------------------------------------------------- sessions


@coach_required
@require_POST
def day_add_exercise(request, pk):
    athlete = coach_athlete(request, pk)
    day_id = request.POST.get("day", "")
    if not day_id.isdigit():
        response = hx.toast(HttpResponse(""), "Click a day on the board first", "bad")
        response["HX-Reswap"] = "none"
        return response
    day = _day(athlete, day_id)
    exercise = get_object_or_404(Exercise, pk=request.POST.get("exercise"), gym=athlete.gym, archived=False)
    session_id = request.POST.get("session") or None
    if session_id is not None:
        session = _session(athlete, session_id)  # must be one of this athlete's sessions
        day, session_id = session.day, session.pk  # the session decides the day
    index = request.POST.get("index", "")
    index = int(index) if index.isdigit() else None  # set when dragged in from the library
    services.add_prescription(day, exercise, athlete, session_id, index, by=request.user)
    # No HX-Retarget: the + button already targets #programEditor, and a retarget is resolved
    # from the button, which may have been redrawn out of the page while this request ran.
    return render_editor(request, athlete, day.week_id, f"{exercise.name} → {day.date:%a %-d %b}", "good")


@coach_required
@require_POST
def day_add_session(request, pk, day_id):
    athlete = coach_athlete(request, pk)
    day = _day(athlete, day_id)
    try:
        services.add_day_session(day, by=request.user)
    except services.TooManySessions:
        return render_editor(request, athlete, day.week_id, "Up to three sessions a day", "bad")
    return render_editor(request, athlete, day.week_id, f"Added a session on {day.date:%a}")


@coach_required
@require_POST
def session_rename(request, pk, session_id):
    athlete = coach_athlete(request, pk)
    session = _session(athlete, session_id)
    services.rename_session(session, request.POST.get(f"name_{session.pk}", ""), by=request.user)
    return hx.toast(_undo_button_oob(request, athlete, session.day.week), "Session renamed")


@coach_required
@require_POST
def session_delete(request, pk, session_id):
    athlete = coach_athlete(request, pk)
    session = _session(athlete, session_id)
    week_id, n = session.day.week_id, session.prescriptions.count()
    try:
        services.delete_session(session, by=request.user)
    except services.HasLoggedSessions:
        name = athlete.user.get_short_name()
        message = f"{name} has logged this session, so it stays. You can still edit its exercises."
        return render_editor(request, athlete, week_id, message, "err")
    extra = f" and its {n} exercise{'s' if n != 1 else ''}" if n else ""
    return render_editor(request, athlete, week_id, f"Removed the session{extra}")


# ---------------------------------------------------------------- prescriptions


def load_basis_for(form, rx):
    """The load basis to show: what was posted if it's a real choice, else the saved one.
    It goes into a JavaScript string (Alpine), so it must never be arbitrary text."""
    value = form["load_basis"].value()
    return value if value in LoadBasis.values else rx.load_basis


def _modal_context(request, athlete, rx, form):
    unit = request.coach.gym.units
    rows = set_rows_initial(rx, unit)
    raw_sets = form["sets"].value()
    sets = int(raw_sets) if str(raw_sets).isdigit() and 1 <= int(raw_sets) <= MAX_SETS else rx.sets
    parent = {"reps": form["rep_scheme"].value() or "", "load": str(form["load_value"].value() or "")}
    return {
        "athlete": athlete,
        "rx": rx,
        "form": form,
        "unit": unit,
        "max_sets": MAX_SETS,
        "sets_initial": sets,
        "parent_values": parent,
        "max_custom": MAX_CUSTOM_FIELDS,
        "custom_fields": rx.custom_fields or [],
        "set_rows": rows,
        "basis": load_basis_for(form, rx),
        "suggested": suggested_weight(rx, athlete, unit),
        "load_now": load_text(rx.load_basis, rx.load_value, unit),
    }


@coach_required
def rx_edit(request, pk, rx_id):
    athlete = coach_athlete(request, pk)
    rx = _rx(athlete, rx_id)
    unit = request.coach.gym.units
    if request.method == "POST":
        form = PrescriptionForm(request.POST, unit=unit)
        if form.is_valid():
            services.edit_prescription(rx, form.dose, by=request.user)
            response = render_editor(
                request, athlete, rx.session.day.week_id, f"{rx.exercise.name} updated", "good"
            )
            response = hx.retarget(response, "#programEditor", "outerHTML")
            return hx.trigger_after_swap(response, closeModal=True)
        context = _modal_context(request, athlete, rx, form)
        context["custom_fields"] = [
            {"key": k, "value": v}
            for k, v in zip(request.POST.getlist("cf_key"), request.POST.getlist("cf_value"), strict=False)
        ]
        context["set_rows"] = [
            {"reps": r, "load": v}
            for r, v in zip(request.POST.getlist("set_reps"), request.POST.getlist("set_load"), strict=False)
        ]
        return TemplateResponse(request, "programs/_rx_modal.html", context)
    form = PrescriptionForm(initial=PrescriptionForm.initial_for(rx, unit), unit=unit)
    return TemplateResponse(request, "programs/_rx_modal.html", _modal_context(request, athlete, rx, form))


@coach_required
@require_POST
def rx_remove(request, pk, rx_id):
    athlete = coach_athlete(request, pk)
    rx = _rx(athlete, rx_id)
    week_id, name, date = rx.session.day.week_id, rx.exercise.name, rx.session.day.date
    services.remove_prescription(rx, by=request.user)
    response = render_editor(request, athlete, week_id, f"Removed {name} from {date:%a}")
    response = hx.retarget(response, "#programEditor", "outerHTML")
    return hx.trigger_after_swap(response, closeModal=True)


@coach_required
def rx_swap(request, pk, rx_id):
    athlete = coach_athlete(request, pk)
    rx = _rx(athlete, rx_id)
    if request.method == "POST":
        exercise = get_object_or_404(services.swap_candidates(rx), pk=request.POST.get("exercise"))
        old = rx.exercise.name
        services.swap_exercise(rx, exercise, by=request.user)
        response = render_editor(
            request,
            athlete,
            rx.session.day.week_id,
            f"Swapped {old} for {exercise.name} — kept {summary(rx, request.coach.gym.units)}",
            "good",
        )
        response = hx.retarget(response, "#programEditor", "outerHTML")
        return hx.trigger_after_swap(response, closeModal=True)
    candidates = rail.by_last_done(
        rail.with_history(list(services.swap_candidates(rx)), athlete, request.coach.gym.units)
    )
    return TemplateResponse(
        request, "programs/_swap_list.html", {"athlete": athlete, "rx": rx, "candidates": candidates}
    )


@coach_required
@require_POST
def rx_move(request, pk, rx_id):
    """Drag and drop: move to position `index` in a session, or onto a day (its first session)."""
    athlete = coach_athlete(request, pk)
    rx = _rx(athlete, rx_id)
    if request.POST.get("session"):
        target = _session(athlete, request.POST["session"])
    else:
        target = services.session_for(_day(athlete, request.POST.get("day", "0")))
    try:
        index = int(request.POST.get("index", "0"))
    except ValueError:
        index = 0
    try:
        services.move_prescription(rx, target, index, by=request.user)
    except services.NotAllowed as err:
        raise Http404 from err
    return render_editor(request, athlete, target.day.week_id)


# ---------------------------------------------------------------- undo


def _undo_button_oob(request, athlete, week):
    """For saves that don't redraw the board: refresh the Undo button out of band."""
    return TemplateResponse(
        request,
        "programs/_undo_button.html",
        {"athlete": athlete, "week": week, "undo_entry": undo.latest(week), "oob": True},
    )


@coach_required
@require_POST
def week_undo(request, pk, week_id):
    athlete = coach_athlete(request, pk)
    week = _week(athlete, week_id)
    label = undo.undo(week)
    message = (
        f"Undone: {label}"
        if label
        else "Nothing to undo in this week — adding, duplicating or deleting weeks can't be undone"
    )
    return render_editor(request, athlete, week.pk, message)
