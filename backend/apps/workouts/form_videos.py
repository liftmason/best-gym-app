"""Form videos: an athlete adds a clip of an exercise to an open session, the coach watches
it and sends feedback. The rules live here; the bucket is behind videos.py (Cloudflare R2
in production), and the bytes never pass through Django."""

import datetime

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.billing import entitlements
from apps.core import errors
from apps.core import models as core
from apps.dashboard import alerts

from . import videos
from .models import FormVideo

MAX_PER_EXERCISE = 3
MAX_NOTE = 300
MAX_FEEDBACK = 4000


class VideoRefused(errors.Conflict):
    """With the message to show the athlete or coach."""


PENDING_WINDOW = datetime.timedelta(minutes=30)  # an upload started this recently still counts


def _taken(se):
    """Videos counting against the per-exercise cap: finished uploads, and uploads started
    in the last PENDING_WINDOW (parallel uploads can't slip past the cap; an abandoned one
    stops counting soon, and the hourly clean-up deletes it)."""
    recent = timezone.now() - PENDING_WINDOW
    return (
        se.videos.filter(deleted_at__isnull=True)
        .filter(Q(uploaded_at__isnull=False) | Q(created_at__gte=recent))
        .count()
    )


def can_upload(se, editable):
    return editable and videos.enabled() and _taken(se) < MAX_PER_EXERCISE


@transaction.atomic
def start_upload(se, size, content_type):
    """A pending video row and the signed URL the browser or phone PUTs the file to. The
    exercise's row is locked while counting, so two uploads at once can't both take the
    last place (audit M22)."""
    core.lock(se)
    log = se.session_log
    entitlements.require(log.athlete.gym, entitlements.FORM_VIDEOS)
    if not videos.enabled() or not log.editable():
        raise VideoRefused("Videos can't be added to this session.")
    max_bytes = videos.config()["max_bytes"]
    if not isinstance(size, int) or size < 1:
        raise VideoRefused("Videos can't be added to this session.")
    if size > max_bytes:
        raise VideoRefused(f"That video is over {max_bytes // (1024 * 1024)} MB. Trim it to a minute or two.")
    if not content_type.startswith("video/") or len(content_type) > 60:
        raise VideoRefused("That file isn't a video.")
    if _taken(se) >= MAX_PER_EXERCISE:
        raise VideoRefused(f"Up to {MAX_PER_EXERCISE} videos per exercise.")
    key = videos.new_key(log.athlete, content_type)
    video = FormVideo.objects.create(
        session_log=log,
        session_exercise=se,
        exercise_name=se.exercise_name,
        key=key,
        content_type=content_type,
        size=size,
    )
    return video, videos.upload_url(key, size, content_type)


def confirm(video):
    """The upload finished: check the stored file is the size that was signed for, then
    tell the coach."""
    if video.uploaded_at is not None:
        return video
    if videos.stored_size(video.key) != video.size:
        raise VideoRefused("The upload didn't finish. Try again.")
    video.uploaded_at = timezone.now()
    video.save(update_fields=["uploaded_at"])
    alerts.video_uploaded(video)
    return video


def set_note(video, note):
    """What the athlete wants the coach to look at; keeps the coach's feed text current."""
    video.note = " ".join((note or "").split())[:MAX_NOTE]
    video.save(update_fields=["note"])
    alerts.video_uploaded(video, reopen=False)
    return video


def remove(video):
    """The athlete takes a video back, until the coach has reviewed it."""
    if video.reviewed_at is not None:
        raise VideoRefused("Reviewed videos stay.")
    videos.delete(video.key)
    alerts.video_removed(video)
    video.delete()


@transaction.atomic
def review(video, coach_user, feedback=""):
    """Mark reviewed; any feedback goes to the athlete as a message quoting the video."""
    from apps.messaging import services as messaging

    feedback = (feedback or "").strip()
    if len(feedback) > MAX_FEEDBACK:
        raise VideoRefused(f"Keep feedback to {MAX_FEEDBACK} characters.")
    if feedback:
        athlete = video.session_log.athlete
        body = f"Form check on {video.exercise_name} ({video.session_log.date:%a %-d %b}): {feedback}"
        messaging.send(messaging.thread_for(athlete), coach_user, body[: messaging.MAX_BODY])
    video.feedback, video.reviewed_at, video.reviewed_by = feedback, timezone.now(), coach_user
    video.save(update_fields=["feedback", "reviewed_at", "reviewed_by"])
    alerts.video_reviewed(video)
    return video
