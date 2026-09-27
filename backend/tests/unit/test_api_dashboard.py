"""The coach dashboard endpoints: /dashboard, /roster, /feed."""

import pytest
from django.db import connection
from django.test import Client
from django.test.utils import CaptureQueriesContext

from apps.dashboard import alerts
from apps.dashboard.models import Notification, NotificationKind
from apps.signin import services as signin

from ..factories import AthleteFactory, UserFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def as_coach(coach):
    client = Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(coach.user).access}")
    return client


def test_the_dashboard(as_coach, athlete, coach):
    alerts.sync_coach(coach)
    body = as_coach.get("/api/v1/dashboard").json()
    assert body["kpis"]["active"] == 1 and body["today"][0]["athlete"]["name"] == "Maya Torres"
    assert body["unread"] == Notification.objects.filter(read_at__isnull=True).count() > 0


def test_opening_the_dashboard_writes_nothing(as_coach, athlete):
    # M20 / H4: alert syncing is the cron job's, not a page load's.
    with CaptureQueriesContext(connection) as ctx:
        as_coach.get("/api/v1/dashboard")
        as_coach.get("/api/v1/roster")
    writes = [q["sql"] for q in ctx.captured_queries if q["sql"].split()[0] in ("INSERT", "UPDATE", "DELETE")]
    assert not [w for w in writes if "signin_devicesession" not in w]


def test_only_coaches_have_a_dashboard(athlete):
    client = Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(athlete.user).access}")
    assert client.get("/api/v1/dashboard").status_code == 404


def test_the_roster_sorts_and_filters(as_coach, athlete, coach):
    AthleteFactory(coach=coach, user=UserFactory(name="Aaron Able", email="aaron@example.com"))
    names = [r["athlete"]["name"] for r in as_coach.get("/api/v1/roster?sort=name").json()]
    assert names == ["Aaron Able", "Maya Torres"]
    assert [r["email"] for r in as_coach.get("/api/v1/roster?q=MAYA").json()] == ["maya@example.com"]


def test_the_roster_reads_the_same_queries_for_any_number_of_athletes(as_coach, coach):
    def count():
        with CaptureQueriesContext(connection) as ctx:
            as_coach.get("/api/v1/roster")
        return len(ctx.captured_queries)

    AthleteFactory(coach=coach)
    few = count()
    for _ in range(4):
        AthleteFactory(coach=coach)
    assert count() == few


def test_the_feed_pages_and_its_actions(as_coach, athlete, coach):
    for i in range(5):
        alerts.notify(athlete, NotificationKind.ISSUE, f"issue:{i}", f"Issue {i}", "")
    first = as_coach.get("/api/v1/feed?limit=3").json()
    assert len(first["items"]) == 3 and first["next"]
    rest = as_coach.get(f"/api/v1/feed?limit=3&before={first['next']}").json()
    assert len(rest["items"]) == 2 and rest["next"] is None
    seen = {i["id"] for i in first["items"]} | {i["id"] for i in rest["items"]}
    assert len(seen) == 5
    row = first["items"][0]
    assert row["kind"] == "issue" and row["athlete"]["name"] == "Maya Torres"
    assert as_coach.post(f"/api/v1/feed/{row['id']}/read").status_code == 204
    assert as_coach.post("/api/v1/feed/clear-read").json() == {"cleared": 1}
    assert as_coach.get("/api/v1/feed?before=junk").status_code == 400
