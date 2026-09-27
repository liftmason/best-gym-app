"""What the coach dashboard shows (apps/dashboard/summary.py), feed actions (alerts.dismiss,
clear_read) and bug reports (apps/dashboard/bugs.py), tested directly. The frozen clock makes
today Thursday 24 September 2026; weeks start on Monday."""

import datetime

import pytest

from apps.dashboard import alerts, bugs, summary
from apps.dashboard.models import BugReport, Notification
from apps.programs import services as program_services
from apps.programs.models import WeekType
from apps.workouts import sessions

from ..conftest import ex
from ..factories import AthleteFactory, UserFactory

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


def plan(program, athlete, gym, date, key="sn"):
    day = program.weeks.get(days__date=date).days.get(date=date)
    program_services.add_prescription(day, ex(gym, key), athlete)
    return day.sessions.get()


def test_compliance_bands():
    assert [summary.compliance_band(v) for v in (None, 90, 85, 84, 70, 69)] == [
        "good",
        "good",
        "good",
        "ok",
        "ok",
        "low",
    ]


def test_roster_rows_and_sorting(program, athlete, coach, gym):
    other = AthleteFactory(coach=coach, user=UserFactory(name="Aaron Able"))
    missed = plan(program, athlete, gym, athlete.today() - DAY)
    assert missed  # planned and never logged
    alerts.sync_coach(coach)
    feed = list(alerts.feed(coach))
    rows = summary.roster_rows([athlete, other], feed)
    maya = next(r for r in rows if r["athlete"] == athlete)
    assert maya["week"].order == 1 and maya["compliance"] == 0 and maya["band"] == "low"
    assert maya["alert_rows"] and maya["readiness"] is None
    counts = [len(r["alert_rows"]) for r in summary.sort_rows(rows, "attention")]
    assert counts == sorted(counts, reverse=True)  # most unread alerts first
    assert [r["athlete"] for r in summary.sort_rows(rows, "name")] == [other, athlete]


def test_kpis(program, athlete, coach, gym):
    log = sessions.start(athlete, plan(program, athlete, gym, athlete.today()))
    sessions.finish(log, 7)
    kpis = summary.kpis(coach, [athlete])
    assert kpis["active"] == 1 and kpis["sessions"] == 1 and kpis["sessions_dir"] == "up"
    assert kpis["joined"] == 1  # joined this month (the fixture athlete joined "now")
    assert kpis["need_programming"] == 1  # nothing planned after today


def test_today_list_leaves_out_warmups(program, athlete, gym):
    session = plan(program, athlete, gym, athlete.today())
    drill = program_services.add_prescription(session.day, ex(gym, "mob"), athlete)
    drill.warmup = True
    drill.save()
    (item,) = summary.today_list([athlete], athlete.today())
    assert (item["count"], item["done"]) == (1, False)


def test_recent_sessions_are_the_last_week(program, athlete, gym):
    for days_ago in (2, 9):
        log = sessions.start(athlete, plan(program, athlete, gym, athlete.today() - days_ago * DAY))
        sessions.finish(log, 7)
    assert [log.date for log in summary.recent_sessions([athlete], athlete.today())] == [
        athlete.today() - 2 * DAY
    ]


def test_dismiss_and_clear_read(coach, athlete):
    alerts.sync_athlete(athlete)
    row = alerts.feed(coach).first()
    with pytest.raises(Notification.DoesNotExist):
        alerts.dismiss(athlete.user, row.pk)  # not theirs
    alerts.dismiss(coach.user, row.pk)
    assert alerts.clear_read(coach) == 1
    assert alerts.clear_read(coach) == 0


def test_bug_reports(coach, athlete):
    report = bugs.report(
        athlete.user,
        description="  Chart is blank ",
        page="https://x/app/",
        screen="390×844",
        user_agent="A" * 500,
    )
    assert (report.side, report.gym, report.description) == ("athlete", coach.gym, "Chart is blank")
    assert len(report.user_agent) == bugs.MAX_USER_AGENT
    assert bugs.report(coach.user, description="x", side="bogus").side == "coach"  # from the profile
    with pytest.raises(bugs.InvalidReport):
        bugs.report(coach.user, description="   ")
    assert BugReport.objects.count() == 2
