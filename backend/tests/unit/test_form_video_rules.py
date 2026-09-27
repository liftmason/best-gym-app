"""Form-video rules (apps/workouts/form_videos.py), tested directly. The bucket is faked, as
in the other video tests."""

import datetime

import pytest

from apps.dashboard import alerts
from apps.messaging.models import Message
from apps.programs import services as program_services
from apps.programs.models import WeekType
from apps.workouts import form_videos, sessions, videos
from apps.workouts.models import FormVideo

from ..conftest import ex

pytestmark = pytest.mark.django_db
MB = 1024 * 1024


@pytest.fixture(autouse=True)
def bucket(monkeypatch, settings):
    settings.FORM_VIDEOS = {**settings.FORM_VIDEOS, "endpoint": "http://bucket.test"}
    deleted = []
    monkeypatch.setattr(videos, "upload_url", lambda key, size, ct: f"https://bucket.test/{key}?put")
    monkeypatch.setattr(videos, "stored_size", lambda key: FormVideo.objects.get(key=key).size)
    monkeypatch.setattr(videos, "delete", lambda key: deleted.append(key))
    return deleted


@pytest.fixture
def se(athlete, coach, gym):
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program = program_services.start_program(athlete, "P", athlete.today(), 1, week_type, by=coach.user)
    day = program.weeks.get().days.get(date=athlete.today())
    program_services.add_prescription(day, ex(gym, "sn"), athlete)
    return sessions.start(athlete, day.sessions.get()).exercises.get()


def uploaded(se, size=5 * MB):
    video, _url = form_videos.start_upload(se, size, "video/mp4")
    return form_videos.confirm(video)


def test_an_upload_is_signed_confirmed_and_alerts_the_coach(se, coach):
    video, url = form_videos.start_upload(se, 5 * MB, "video/mp4")
    assert url.startswith("https://bucket.test/") and video.uploaded_at is None
    assert not alerts.feed(coach).filter(kind="video").exists()
    form_videos.confirm(video)
    assert video.uploaded_at and alerts.feed(coach).filter(kind="video").exists()


@pytest.mark.parametrize(
    "size, content_type, message",
    [
        (201 * MB, "video/mp4", "That video is over 200 MB — trim it to a minute or two."),
        (5 * MB, "image/png", "That file isn't a video."),
        (0, "video/mp4", "Videos can't be added to this session."),
    ],
)
def test_uploads_that_are_refused(se, size, content_type, message):
    with pytest.raises(form_videos.VideoRefused, match=message):
        form_videos.start_upload(se, size, content_type)


def test_three_per_exercise(se):
    for _ in range(form_videos.MAX_PER_EXERCISE):
        uploaded(se)
    assert not form_videos.can_upload(se, True)
    with pytest.raises(form_videos.VideoRefused, match="Up to 3 videos per exercise."):
        form_videos.start_upload(se, MB, "video/mp4")


def test_closed_sessions_and_missing_storage_refuse(se, settings, frozen_clock):
    sessions.finish(se.session_log, 7)
    frozen_clock.shift(datetime.timedelta(hours=25))
    se.session_log.refresh_from_db()
    with pytest.raises(form_videos.VideoRefused):
        form_videos.start_upload(se, MB, "video/mp4")
    settings.FORM_VIDEOS = {**settings.FORM_VIDEOS, "endpoint": ""}
    assert not form_videos.can_upload(se, True)


def test_an_unfinished_upload_is_not_confirmed(se, monkeypatch):
    video, _url = form_videos.start_upload(se, 5 * MB, "video/mp4")
    monkeypatch.setattr(videos, "stored_size", lambda key: None)
    with pytest.raises(form_videos.VideoRefused, match="The upload didn't finish"):
        form_videos.confirm(video)


def test_notes_are_tidied_and_short(se):
    video = form_videos.set_note(uploaded(se), "  Is my   dip vertical?  " + "x" * 400)
    assert video.note.startswith("Is my dip vertical?") and len(video.note) == form_videos.MAX_NOTE


def test_removing_until_reviewed(se, coach, bucket):
    video = uploaded(se)
    form_videos.remove(video)
    assert not FormVideo.objects.exists() and bucket == [video.key]
    reviewed = form_videos.review(uploaded(se), coach.user)
    with pytest.raises(form_videos.VideoRefused):
        form_videos.remove(reviewed)


def test_review_feedback_goes_to_the_athletes_messages(se, coach):
    video = form_videos.review(uploaded(se), coach.user, "  Stay over the bar longer. ")
    assert (
        video.reviewed_at
        and video.reviewed_by == coach.user
        and video.feedback == "Stay over the bar longer."
    )
    message = Message.objects.get()
    assert message.sender == coach.user and message.body.startswith("Form check — Snatch (")
    assert message.body.endswith("Stay over the bar longer.")
    assert not alerts.feed(coach).filter(kind="video", cleared_at__isnull=True).exists()


def test_review_without_feedback_just_marks_it(se, coach):
    form_videos.review(uploaded(se), coach.user)
    assert not Message.objects.exists()
