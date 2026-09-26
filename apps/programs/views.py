"""Settings › Week types: a gym's own week types (name, description, colour, order).

A week type that anything uses (program weeks, template weeks, session logs) is
archived instead of deleted, so past weeks keep their label and colour. "In use" is
worked out from every model that points at WeekType, so new ones are covered
automatically."""

from django.http import Http404
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.views.decorators.http import require_POST

from apps import hx
from apps.accounts.access import coach_required

from . import week_types
from .models import WeekType


def card_context(gym):
    rows = list(WeekType.objects.filter(gym=gym))
    for wt in rows:
        wt.uses = week_types.usage_count(wt)
    return {
        "active": [w for w in rows if not w.archived],
        "archived": [w for w in rows if w.archived],
        "name_max": week_types.NAME_LENGTH,
        "description_max": week_types.DESCRIPTION_LENGTH,
    }


def render_card(request, message=None, kind=""):
    response = TemplateResponse(request, "programs/_week_types.html", card_context(request.coach.gym))
    return hx.toast(response, message, kind) if message else response


def save_pending_edits(request):
    week_types.save_pending_edits(request.coach.gym, request.POST)


@coach_required
@require_POST
def add(request):
    save_pending_edits(request)
    try:
        wt = week_types.add(request.coach.gym, request.POST.get("name", ""), request.POST.get("colour"))
    except week_types.InvalidWeekType as err:
        return render_card(request, str(err), "bad")
    return render_card(request, f"Week type “{wt.name}” added", "good")


@coach_required
@require_POST
def update(request, pk):
    """Saves name, description and colour as they're edited. Nothing is redrawn unless
    something was invalid, so the coach's typing and queued clicks aren't disturbed."""
    wt = get_object_or_404(WeekType, pk=pk, gym=request.coach.gym)
    post = request.POST
    try:
        week_types.update(
            wt,
            name=post.get(f"name_{wt.pk}", ""),
            colour_value=post.get(f"colour_{wt.pk}"),
            description=post.get(f"description_{wt.pk}", wt.description),
        )
    except week_types.InvalidWeekType as err:
        return hx.retarget(render_card(request, str(err), "bad"), "#weekTypes", "outerHTML")
    # The pill preview uses the colour, so redraw just that row's pill out of band.
    response = TemplateResponse(request, "programs/_week_type_pill.html", {"wt": wt, "oob": True})
    return hx.toast(response, "Week type saved")


@coach_required
@require_POST
def move(request, pk, direction):
    save_pending_edits(request)
    try:
        week_types.move(request.coach.gym, pk, direction)
    except ValueError as err:
        raise Http404 from err
    return render_card(request)


@coach_required
@require_POST
def remove(request, pk):
    save_pending_edits(request)
    wt = get_object_or_404(WeekType, pk=pk, gym=request.coach.gym, archived=False)
    name = wt.name
    uses = week_types.remove(wt)
    if uses:
        return render_card(
            request,
            f"“{wt.name}” is used by {uses} week{'s' if uses != 1 else ''}, so it was "
            "archived: it leaves the pickers, and those weeks keep it.",
        )
    return render_card(request, f"Deleted “{name}”")


@coach_required
@require_POST
def restore(request, pk):
    save_pending_edits(request)
    wt = get_object_or_404(WeekType, pk=pk, gym=request.coach.gym, archived=True)
    week_types.restore(wt)
    return render_card(request, f"“{wt.name}” restored", "good")
