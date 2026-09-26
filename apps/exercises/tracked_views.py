"""Settings › Tracked lifts: the gym-wide, ordered list of lifts whose maxes are
asked at onboarding and shown on the Metrics tab and athlete header."""

from django.http import Http404
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.views.decorators.http import require_POST

from apps import hx
from apps.accounts.access import coach_required

from . import services
from .models import MAX_TRACKED_LIFTS, TrackedLift


def render_card(request, message=None, kind=""):
    gym = request.coach.gym
    response = TemplateResponse(
        request,
        "exercises/_tracked_lifts.html",
        {
            "tracked": TrackedLift.objects.filter(gym=gym).select_related("exercise__category"),
            "trackable": services.trackable(gym),
            "max_tracked": MAX_TRACKED_LIFTS,
        },
    )
    return hx.toast(response, message, kind) if message else response


@coach_required
def card(request):
    return render_card(request)


@coach_required
@require_POST
def add(request):
    try:
        tracked = services.track(request.coach.gym, request.POST.get("exercise", ""))
    except services.TrackingRefused as err:
        return render_card(request, str(err), "bad")
    return render_card(
        request, f"Now tracking {tracked.exercise.name} — athletes are asked for it at onboarding", "good"
    )


@coach_required
@require_POST
def remove(request, pk):
    tracked = get_object_or_404(TrackedLift, pk=pk, gym=request.coach.gym)
    name = tracked.exercise.name
    services.untrack(tracked)
    return render_card(
        request, f"Stopped tracking {name}. Maxes already recorded stay in each athlete's history."
    )


@coach_required
@require_POST
def move(request, pk, direction):
    try:
        services.move_tracked(request.coach.gym, pk, direction)
    except ValueError as err:
        raise Http404 from err
    return render_card(request)
