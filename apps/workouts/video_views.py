"""Form videos: the athlete uploads a clip from the session player; the coach watches it
on the athlete's Sessions tab, writes feedback (sent into their message thread) and marks
it reviewed. Storage is in videos.py; the bytes never pass through Django."""

from django import forms
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.views.decorators.http import require_POST

from apps import hx
from apps.accounts.access import athlete_required, coach_required
from apps.accounts.coach_views import coach_athlete
from apps.ratelimit import by_user, rate_limit

from . import form_videos, videos
from .models import FormVideo, SessionLog


def _log(request, log_id):
    return get_object_or_404(SessionLog, pk=log_id, athlete=request.athlete)


def video_context(se, editable):
    return {
        "se": se,
        "log": se.session_log,
        "form_videos": [v for v in se.videos.all() if v.uploaded_at],
        "can_upload": form_videos.can_upload(se, editable),
        "max_mb": videos.config()["max_bytes"] // (1024 * 1024),
        "coach_name": se.session_log.athlete.coach.user.get_short_name(),
    }


def _card(request, se, message=None, kind=""):
    response = TemplateResponse(request, "app/_videos.html", video_context(se, se.session_log.editable()))
    return hx.toast(response, message, kind) if message else response


# ---------------------------------------------------------------- athlete


class StartForm(forms.Form):
    se = forms.IntegerField()
    size = forms.IntegerField(min_value=1)
    content_type = forms.CharField(max_length=60)


@athlete_required
@require_POST
@rate_limit("video", 20, 60 * 60, key=by_user)
def start(request, log_id):
    """Sign an upload for one clip; the browser then PUTs the file straight to the bucket."""
    log = _log(request, log_id)
    form = StartForm(request.POST)
    if not form.is_valid():
        return JsonResponse({"error": "Videos can't be added to this session."}, status=400)
    d = form.cleaned_data
    se = get_object_or_404(log.exercises, pk=d["se"])
    try:
        video, url = form_videos.start_upload(se, d["size"], d["content_type"])
    except form_videos.VideoRefused as err:
        return JsonResponse({"error": str(err)}, status=400)
    return JsonResponse(
        {"id": video.pk, "url": url, "done_url": f"/app/log/{log.pk}/videos/{video.pk}/done/"}
    )


@athlete_required
@require_POST
def done(request, log_id, video_id):
    """The browser finished uploading: check the file is really there, then tell the coach."""
    log = _log(request, log_id)
    video = get_object_or_404(FormVideo, pk=video_id, session_log=log, uploaded_at__isnull=True)
    try:
        form_videos.confirm(video)
    except form_videos.VideoRefused as err:
        return JsonResponse({"error": str(err)}, status=400)
    return _card(
        request,
        video.session_exercise,
        f"Video sent — {log.athlete.coach.user.get_short_name()} will review it",
        "good",
    )


@athlete_required
@require_POST
def note(request, log_id, video_id):
    log = _log(request, log_id)
    video = get_object_or_404(FormVideo, pk=video_id, session_log=log)
    form_videos.set_note(video, request.POST.get("note", ""))
    return hx.toast(HttpResponse(status=204), "Note saved")


@athlete_required
@require_POST
def remove(request, log_id, video_id):
    log = _log(request, log_id)
    video = get_object_or_404(FormVideo, pk=video_id, session_log=log, reviewed_at__isnull=True)
    se = video.session_exercise
    form_videos.remove(video)
    return _card(request, se, "Video removed")


# ---------------------------------------------------------------- coach


class ReviewForm(forms.Form):
    feedback = forms.CharField(required=False, max_length=4000)


@coach_required
def review(request, pk, video_id):
    """GET: the video with a feedback box. POST: send the feedback and mark it reviewed."""
    athlete = coach_athlete(request, pk)
    video = get_object_or_404(FormVideo.objects.available(), pk=video_id, session_log__athlete=athlete)
    form = ReviewForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        feedback = form.cleaned_data["feedback"].strip()
        form_videos.review(video, request.user, feedback)
        response = TemplateResponse(
            request, "coach/athlete/_video_note.html", {"video": video, "athlete": athlete}
        )
        name = athlete.user.get_short_name()
        hx.toast(response, f"Feedback sent to {name}" if feedback else "Marked reviewed", "good")
        return hx.trigger_after_swap(response, closeModal=True)
    return TemplateResponse(
        request,
        "coach/athlete/_video_modal.html",
        {"video": video, "athlete": athlete, "form": form, "src": videos.view_url(video.key)},
    )
