"""The signed-in person's own endpoints: profile, units, history visibility, filling in
numbers, form-video uploads and bug reports."""

import pytest
from django.test import Client

from apps.accounts.models import BodyweightEntry
from apps.dashboard.models import BugReport
from apps.signin import services as signin
from apps.workouts import videos
from apps.workouts.models import FormVideo, SessionExercise, SessionLog

from ..conftest import ex

pytestmark = pytest.mark.django_db


@pytest.fixture
def me(athlete):
    return Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(athlete.user).access}")


def call(api, method, path, data=None, **extra):
    return getattr(api, method)(f"/api/v1{path}", data or {}, content_type="application/json", **extra)


def test_profile_units_and_history(me, athlete):
    assert call(me, "patch", "/me", {"name": "Maya T.", "timezone": "Europe/London"}).status_code == 204
    assert call(me, "patch", "/me", {"timezone": "Nowhere/Land"}).status_code == 400
    assert call(me, "put", "/me/units", {"units": "lb"}).status_code == 204
    assert call(me, "put", "/me/history-visibility", {"hide": True}).status_code == 204
    athlete.refresh_from_db()
    athlete.user.refresh_from_db()
    assert (athlete.user.name, athlete.user.timezone, athlete.units) == ("Maya T.", "Europe/London", "lb")
    assert athlete.hide_history_before_link


def test_filling_in_numbers_in_my_unit(me, athlete):
    athlete.units = "lb"
    athlete.save()
    before = {m["key"]: m for m in me.get("/api/v1/me/metrics").json()}
    assert before["bodyweight"]["missing"]
    assert call(me, "post", "/me/metrics", {"values": {"bodyweight": "180"}}).json() == {
        "filled": ["bodyweight"]
    }
    assert float(BodyweightEntry.objects.get().kg) == pytest.approx(81.65, abs=0.01)  # converted once
    after = {m["key"]: m for m in me.get("/api/v1/me/metrics").json()}
    assert after["bodyweight"]["value"] == "180 lb" and not after["bodyweight"]["missing"]
    assert call(me, "post", "/me/metrics", {"values": {"bodyweight": "999"}}).json() == {
        "filled": []
    }  # already there


def test_coach_only_accounts_have_no_athlete_endpoints(coach):
    client = Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(coach.user).access}")
    assert call(client, "put", "/me/units", {"units": "lb"}).status_code == 404


@pytest.fixture
def exercise_log(athlete, gym):
    log = SessionLog.objects.create(athlete=athlete, date=athlete.today())
    return SessionExercise.objects.create(session_log=log, exercise=ex(gym, "sn"), exercise_name="Snatch")


def test_uploading_a_form_video(me, exercise_log, monkeypatch):
    base = f"/me/sessions/{exercise_log.session_log_id}/videos"
    body = {"session_exercise_id": str(exercise_log.pk), "size": 5_000_000, "content_type": "video/mp4"}
    started = call(me, "post", base, body)
    assert started.status_code == 201 and started.json()["upload_url"].startswith("http")
    video_id = started.json()["video_id"]
    monkeypatch.setattr(videos, "stored_size", lambda key: 5_000_000)
    assert call(me, "post", f"/me/videos/{video_id}/confirm").status_code == 204
    assert call(me, "patch", f"/me/videos/{video_id}", {"note": "Hips?"}).status_code == 204
    monkeypatch.setattr(videos, "delete", lambda key: None)
    assert call(me, "delete", f"/me/videos/{video_id}").status_code == 204
    assert call(me, "post", base, body | {"content_type": "image/png"}).status_code == 409


def test_the_video_cap_counts_uploads_in_progress(me, exercise_log):
    # M22: only finished uploads were counted, so several started at once all got through.
    base = f"/me/sessions/{exercise_log.session_log_id}/videos"
    body = {"session_exercise_id": str(exercise_log.pk), "size": 1000, "content_type": "video/mp4"}
    codes = [call(me, "post", base, body).status_code for _ in range(4)]
    assert codes == [201, 201, 201, 409]
    assert FormVideo.objects.count() == 3


def test_bug_reports(me, athlete):
    response = call(
        me,
        "post",
        "/bug-reports",
        {"description": "The timer froze", "screen": "390x844"},
        HTTP_USER_AGENT="Phone/1",
    )
    assert response.status_code == 201
    report = BugReport.objects.get()
    assert (report.side, report.user_agent, report.gym) == ("athlete", "Phone/1", athlete.gym)
    assert call(me, "post", "/bug-reports", {"description": "  "}).status_code == 400
