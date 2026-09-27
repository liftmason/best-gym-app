"""Rules that were only tested through the pages (S0 step 2 triage), now tested directly: the
athlete's days, sessions and PRs, the coach's session summaries, habits, alerts, form videos
and the digest. The frozen clock makes today Thursday 24 September 2026 (noon in New York)."""

import datetime
from decimal import Decimal

import pytest
from django.core import mail
from django.utils import timezone

from apps.accounts.models import MaxEntry, MaxUpdates
from apps.accounts.services import set_max_updates
from apps.dashboard import alerts, digest
from apps.programs import habits
from apps.programs import services as program_services
from apps.programs.models import ProgramSession, WeekType
from apps.workouts import charts, checkins, coach_summary, form_videos, history, player, sessions, videos
from apps.workouts.models import CheckinQuestion, FormVideo, QuestionType

from ..conftest import ex

pytestmark = pytest.mark.django_db
DAY = datetime.timedelta(days=1)


@pytest.fixture
def program(athlete, coach, gym):
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program = program_services.start_program(
        athlete, "P", athlete.today() - 7 * DAY, 3, week_type, by=coach.user
    )
    for week in program.weeks.all():
        program_services.set_published(week, True)
    return program


def planned(program, athlete, gym, date, key="sn", **dose):
    day = program.weeks.get(days__date=date).days.get(date=date)
    rx = program_services.add_prescription(day, ex(gym, key), athlete)
    for field, value in {"sets": 1, "rep_scheme": "1", "reps": 1, **dose}.items():
        setattr(rx, field, value)
    rx.save()
    return rx.session


def logged(program, athlete, gym, date, key="sn", load="80", reps="1", finish=True):
    log = sessions.start(athlete, planned(program, athlete, gym, date, key))
    sessions.log_set(log.exercises.get(), 1, load=load, reps=reps, done=True)
    if finish:
        sessions.finish(log, 7)
    return log


# ---------------------------------------------------------------- days and sessions


def test_a_missed_day_is_filled_in_without_a_checkin(program, athlete, gym):
    yesterday = athlete.today() - DAY
    log = sessions.start_planned(athlete, planned(program, athlete, gym, yesterday).pk)
    assert log.date == yesterday and log.checkin_skipped


def test_an_ended_programs_sessions_cannot_be_started(program, athlete, coach, gym):
    session = planned(program, athlete, gym, athlete.today())
    program_services.start_program(
        athlete, "Next", athlete.today(), 1, WeekType.objects.get(gym=gym, name="Deload"), by=coach.user
    )
    with pytest.raises(ProgramSession.DoesNotExist):
        sessions.start_planned(athlete, session.pk)


def test_day_statuses(program, athlete, gym):
    today = athlete.today()
    logged(program, athlete, gym, today - 2 * DAY)
    planned(program, athlete, gym, today - DAY)
    planned(program, athlete, gym, today, "cj")
    planned(program, athlete, gym, today + DAY, "bsq")
    done_ids = history.finished_session_ids(athlete)
    week = program.weeks.get(days__date=today)

    def status(date):
        day = (
            week.days.prefetch_related("sessions").get(date=date)
            if week.start_date <= date <= week.end_date
            else None
        )
        return history.day_status(day, today, done_ids)

    assert status(today - 2 * DAY) == history.DONE
    assert status(today - DAY) == history.MISSED
    assert status(today) == history.TODAY
    assert status(today + DAY) == history.UPCOMING
    assert status(today + 2 * DAY) == history.REST


def test_the_last_time_line(program, athlete, gym):
    logged(program, athlete, gym, athlete.today() - 7 * DAY, load="78")
    log = sessions.start(athlete, planned(program, athlete, gym, athlete.today()))
    se = log.exercises.get()
    assert player.last_time(athlete, se, log, "kg") == "78 kg ×1 · 7 days ago"
    first = sessions.start(athlete, planned(program, athlete, gym, athlete.today() - DAY, "hsn"))
    assert player.last_time(athlete, first.exercises.get(), first, "kg") is None


def test_unticking_a_warmup_and_finishing_again(program, athlete, gym):
    session = planned(program, athlete, gym, athlete.today(), "mob", warmup=True)
    log = sessions.start(athlete, session)
    drill = log.exercises.get()
    sessions.check_warmup(drill, True)
    assert sessions.check_warmup(drill, False).checked_at is None
    sessions.finish(log, 6)
    assert sessions.finish(log, 8).session_rpe == 8  # changed within the 24 hours


def test_only_warmup_drills_are_ticked(program, athlete, gym):
    log = sessions.start(athlete, planned(program, athlete, gym, athlete.today()))
    with pytest.raises(ValueError):
        sessions.check_warmup(log.exercises.get(), True)


# ---------------------------------------------------------------- PRs


def test_prs_wait_for_the_coach_and_raise_an_alert(program, athlete, coach, gym):
    set_max_updates(athlete, MaxUpdates.APPROVE)
    MaxEntry.objects.create(
        athlete=athlete, exercise=ex(gym, "sn"), date=athlete.today() - 9 * DAY, kg=100, source="coach"
    )
    log = logged(program, athlete, gym, athlete.today(), load="105")
    alerts.sync_prs(athlete)
    row = alerts.feed(coach).get(kind="pr")
    assert row.text.startswith("Snatch 105 kg × 1")
    from apps.workouts import prs

    prs.decide(athlete, log.exercises.get().sets.get().pk, use=True)
    assert athlete.current_max(ex(gym, "sn")).source == "coach"
    assert not alerts.feed(coach).filter(kind="pr", cleared_at__isnull=True).exists()


def test_an_exercise_without_a_max_is_never_a_candidate(program, athlete, gym):
    from apps.workouts import prs

    set_max_updates(athlete, MaxUpdates.APPROVE)
    logged(program, athlete, gym, athlete.today(), key="hsn", load="90")
    assert prs.pending(athlete) == []


def test_a_dismissed_pr_comes_back_when_beaten_again(program, athlete, gym):
    from apps.workouts import prs

    set_max_updates(athlete, MaxUpdates.APPROVE)
    MaxEntry.objects.create(
        athlete=athlete, exercise=ex(gym, "sn"), date=athlete.today() - 9 * DAY, kg=100, source="coach"
    )
    first = logged(program, athlete, gym, athlete.today() - DAY, load="102")
    prs.decide(athlete, first.exercises.get().sets.get().pk, use=False)
    logged(program, athlete, gym, athlete.today(), load="104")
    assert [c.set_log.load_kg for c in prs.pending(athlete)] == [Decimal("104")]


def test_automatic_maxes_follow_edits(program, athlete, gym):
    set_max_updates(athlete, MaxUpdates.AUTO)
    MaxEntry.objects.create(
        athlete=athlete, exercise=ex(gym, "sn"), date=athlete.today() - 9 * DAY, kg=100, source="coach"
    )
    log = logged(program, athlete, gym, athlete.today(), load="105")
    assert athlete.current_max(ex(gym, "sn")).kg == Decimal("105")
    sessions.log_set(log.exercises.get(), 1, load="95", reps="1", done=True)  # a typo fixed
    assert athlete.current_max(ex(gym, "sn")).kg == Decimal("100")
    assert not MaxEntry.objects.filter(athlete=athlete, source="session").exists()


# ---------------------------------------------------------------- the coach's summaries and charts


def test_session_item_readiness_pr_day_and_warmups(program, athlete, gym):
    q = CheckinQuestion.objects.create(athlete=athlete, type=QuestionType.SCALE, text="Ready?")
    today = athlete.today()
    session = planned(program, athlete, gym, today, "mob", warmup=True)
    program_services.add_prescription(session.day, ex(gym, "sn"), athlete, session_id=session.pk)
    log = sessions.start(athlete, session)
    checkins.answer(log, q, "8")
    sessions.log_set(log.exercises.get(warmup=False), 1, load="90", reps="1", done=True)
    sessions.finish(log, 8)
    MaxEntry.objects.create(
        athlete=athlete, exercise=ex(gym, "sn"), date=today - 30 * DAY, kg=85, source="coach"
    )
    (item,), _ = coach_summary.session_list(athlete, "kg")
    assert item["readiness"] == "8" and item["pr_day"]
    assert item["warmup"] == {"done": 0, "total": 1}
    assert [e["name"] for e in item["exercises"]] == ["Snatch"]


def test_lifetime_prs_and_the_progress_chart(program, athlete, gym):
    logged(program, athlete, gym, athlete.today() - 7 * DAY, load="80", reps="2")
    logged(program, athlete, gym, athlete.today() - 2 * DAY, load="83", reps="1")
    (pr,) = history.lifetime_prs(athlete)
    assert pr["heaviest"].load_kg == Decimal("83") and pr["heaviest_date"] == athlete.today() - 2 * DAY
    assert pr["e1rm"] and pr["e1rm_date"] in (athlete.today() - 7 * DAY, athlete.today() - 2 * DAY)
    points = charts.e1rm_points(athlete, ex(gym, "sn"))
    change = charts.progress_change(athlete, ex(gym, "sn"), "kg")
    assert change == {
        "change": round(float(points[-1][1] - points[0][1])),
        "drop": abs(round(float(points[-1][1] - points[0][1]))),
        "weeks": 1,
    }
    lifts, chosen = coach_summary.chart_lift(athlete, None)
    assert chosen == lifts[0]
    assert coach_summary.chart_lift(athlete, ex(gym, "sn").pk)[1] == ex(gym, "sn")


# ---------------------------------------------------------------- habits


def test_habits_tick_today_and_yesterday_only(athlete):
    habit = habits.prescribe(athlete, "Sleep", "😴", "daily")
    today = athlete.today()
    assert habits.toggle(habit, today) is True
    assert habits.toggle(habit, today - DAY) is True
    assert habits.toggle(habit, today) is False  # a second tap unticks
    with pytest.raises(habits.CannotTick):
        habits.toggle(habit, today - 2 * DAY)


def test_archiving_a_habit_keeps_its_history(athlete):
    habit = habits.prescribe(athlete, "Sleep", "😴", "daily")
    habits.toggle(habit, athlete.today())
    habits.archive(habit)
    assert habit.archived_at and habit.logs.exists()
    assert habit not in habits.active(athlete)


# ---------------------------------------------------------------- alerts and the digest


def test_dismissed_conditions_stay_dismissed(coach, athlete):
    alerts.sync_athlete(athlete)
    row = alerts.feed(coach).get(kind="metrics_missing")
    alerts.dismiss(coach.user, row.pk)
    alerts.sync_athlete(athlete)
    row.refresh_from_db()
    assert row.read_at is not None
    alerts.clear_read(coach)
    alerts.sync_athlete(athlete)
    assert not alerts.feed(coach).filter(kind="metrics_missing").exists()


def test_no_digest_when_its_turned_off(coach, athlete):
    coach.digest = False
    coach.save()
    alerts.sync_athlete(athlete)
    seven = timezone.localtime(timezone.now(), coach.gym_zone).replace(hour=7, minute=5)
    assert digest.send(coach, seven) == 0 and mail.outbox == []


# ---------------------------------------------------------------- form videos


@pytest.fixture
def storage(monkeypatch, settings):
    settings.FORM_VIDEOS = {
        **settings.FORM_VIDEOS,
        "endpoint": "http://bucket.test",
        "bucket": "videos",
        "access_key": "k",
        "secret": "s",
    }
    deleted = []
    monkeypatch.setattr(videos, "stored_size", lambda key: FormVideo.objects.get(key=key).size)
    monkeypatch.setattr(videos, "delete", lambda key: deleted.append(key))
    return deleted


def test_keys_and_signed_uploads(athlete, storage):
    key = videos.new_key(athlete, "video/quicktime")
    assert key.startswith(f"form-videos/{athlete.gym.pk}/{athlete.pk}/") and key.endswith(".mov")
    url = videos.upload_url(key, 1234, "video/mp4")  # presigning needs no network
    assert "X-Amz-Signature" in url and "content-length" in url.lower()


def test_the_coachs_video_alert(program, athlete, coach, gym, storage):
    log = sessions.start(athlete, planned(program, athlete, gym, athlete.today()))
    video, _url = form_videos.start_upload(log.exercises.get(), 1000, "video/mp4")
    form_videos.confirm(video)
    form_videos.set_note(video, "Is my dip vertical?")
    row = alerts.feed(coach).get(kind="video")
    assert row.text == "Uploaded a form video: Snatch — “Is my dip vertical?”"
    assert alerts.link_for(row).endswith(f"focus=video-{video.pk}")
    form_videos.remove(video)
    assert not alerts.feed(coach).filter(kind="video").exists()


def test_videos_expire(program, athlete, gym, storage):
    log = sessions.start(athlete, planned(program, athlete, gym, athlete.today()))
    se = log.exercises.get()
    kept, _url = form_videos.start_upload(se, 1000, "video/mp4")
    form_videos.confirm(kept)
    abandoned, _url = form_videos.start_upload(se, 1000, "video/mp4")
    FormVideo.objects.filter(pk=kept.pk).update(uploaded_at=timezone.now() - datetime.timedelta(days=91))
    FormVideo.objects.filter(pk=abandoned.pk).update(created_at=timezone.now() - datetime.timedelta(days=2))
    assert videos.expire() == (1, 1)
    kept.refresh_from_db()
    assert kept.deleted_at is not None and len(storage) == 2
