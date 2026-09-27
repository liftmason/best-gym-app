"""An athlete adding form videos to a logged session (/api/v1/me/...). The file goes
straight from the phone or browser to the bucket with a signed PUT; the session log itself
arrives through sync (S3). The rules are in form_videos.py."""

import uuid

from ninja import Router, Schema, Status

from apps.api.main import athlete_of, limit

from . import form_videos
from .models import FormVideo, SessionLog

router = Router(tags=["My training"])


class UploadIn(Schema):
    session_exercise_id: uuid.UUID
    size: int  # bytes
    content_type: str  # video/mp4, video/quicktime, video/webm


class UploadOut(Schema):
    video_id: uuid.UUID
    upload_url: str  # PUT the file here, with this Content-Type and exactly `size` bytes
    content_type: str


class NoteIn(Schema):
    note: str


def _video(request, video_id):
    return FormVideo.objects.get(pk=video_id, session_log__athlete=athlete_of(request))


@router.post("/me/sessions/{log_id}/videos", response={201: UploadOut})
def start_upload(request, log_id: uuid.UUID, data: UploadIn):
    """Start uploading a video of one exercise in the session (up to three each)."""
    athlete = athlete_of(request)
    log = SessionLog.objects.get(pk=log_id, athlete=athlete)
    se = log.exercises.get(pk=data.session_exercise_id)
    limit(request, "videos", 20, 3600, key=athlete.pk)
    video, url = form_videos.start_upload(se, data.size, data.content_type)
    return Status(201, {"video_id": video.pk, "upload_url": url, "content_type": video.content_type})


@router.post("/me/videos/{video_id}/confirm", response={204: None})
def confirm(request, video_id: uuid.UUID):
    """The upload finished: the stored file is checked, then the coach is told."""
    form_videos.confirm(_video(request, video_id))
    return Status(204, None)


@router.patch("/me/videos/{video_id}", response={204: None})
def set_note(request, video_id: uuid.UUID, data: NoteIn):
    form_videos.set_note(_video(request, video_id), data.note)
    return Status(204, None)


@router.delete("/me/videos/{video_id}", response={204: None})
def remove(request, video_id: uuid.UUID):
    """Take a video back (until the coach has reviewed it)."""
    form_videos.remove(_video(request, video_id))
    return Status(204, None)
