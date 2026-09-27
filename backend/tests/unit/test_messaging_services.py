"""Messages (apps/messaging/services.py), tested directly."""

import pytest

from apps.dashboard import alerts
from apps.messaging import services
from apps.messaging.models import Message

from ..factories import UserFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def thread(athlete):
    return services.thread_for(athlete)


def test_sending_tidies_and_alerts_the_coach(thread, athlete, coach):
    message = services.send(thread, athlete.user, "  Are we going 80 on Saturday?  ")
    assert message.body == "Are we going 80 on Saturday?"
    assert alerts.feed(coach).filter(kind="message").exists()


def test_only_the_threads_people_can_write(thread):
    with pytest.raises(services.NotInThread):
        services.send(thread, UserFactory(), "hello")


def test_empty_and_overlong_messages_are_refused(thread, coach):
    with pytest.raises(services.EmptyMessage):
        services.send(thread, coach.user, "   ")
    with pytest.raises(ValueError):
        services.send(thread, coach.user, "x" * 4001)
    assert not Message.objects.exists()


def test_reading_marks_only_the_other_sides_messages(thread, athlete, coach):
    services.send(thread, athlete.user, "one")
    mine = services.send(thread, coach.user, "two")
    assert services.mark_read(thread, coach.user) == 1
    mine.refresh_from_db()
    assert mine.read_at is None  # the coach's own message waits for the athlete
    assert services.mark_read(thread, coach.user) == 0
    assert not alerts.feed(coach).filter(kind="message", cleared_at__isnull=True).exists()


def test_recent_is_the_last_messages_oldest_first(thread, coach):
    for i in range(5):
        services.send(thread, coach.user, f"m{i}")
    assert [m.body for m in services.recent(thread, limit=3)] == ["m2", "m3", "m4"]


def test_unread_count_is_the_coachs_unread_messages(thread, athlete, coach):
    services.send(thread, coach.user, "one")
    services.send(thread, coach.user, "two")
    services.send(thread, athlete.user, "mine")  # the athlete's own don't count
    assert services.unread_count(athlete) == 2
    services.mark_read(thread, athlete.user)
    assert services.unread_count(athlete) == 0
