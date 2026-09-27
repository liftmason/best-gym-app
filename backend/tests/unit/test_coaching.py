"""Coaching and gym links (accounts/coaching.py): who a coach's athletes are, archiving
as ending a link, joining a new coach with the same history, and history visibility."""

import datetime

import pytest
from django.db import IntegrityError, transaction

from apps.accounts import coaching, invites, services
from apps.accounts.models import Athlete, BodyweightEntry, CoachingStatus, GymMembership, GymRole
from apps.dashboard import alerts
from apps.dashboard.models import NotificationKind
from apps.messaging import services as messaging
from apps.messaging.models import Thread

from ..factories import AthleteFactory, CoachFactory, GymFactory

pytestmark = pytest.mark.django_db


def test_a_coach_signs_up_as_owner_of_their_gym():
    coach = services.sign_up_coach(
        name="Sam",
        email="sam@example.com",
        gym_name="Barbell Club",
        units="kg",
        starter="empty",
        timezone="UTC",
    )
    membership = GymMembership.objects.get(coach=coach)
    assert coach.gym.name == "Barbell Club" and membership.role == GymRole.OWNER


def test_one_active_gym_per_coach(coach):
    with pytest.raises(IntegrityError), transaction.atomic():
        coaching.join_gym(coach, GymFactory())


def test_a_coachs_athletes_are_their_active_links(coach, athlete, gym):
    archived = AthleteFactory(coach=coach)
    coaching.end(archived)
    AthleteFactory(coach=CoachFactory(gym=gym))
    AthleteFactory(coach=None)
    assert list(coaching.athletes_for(coach)) == [athlete]
    with pytest.raises(Athlete.DoesNotExist):
        coaching.athlete_for(coach, archived.pk)
    assert archived.coach == coach and archived.active_coaching is None  # the latest link


def test_listed_athletes_read_their_coach_and_gym_without_queries(coach, athlete, django_assert_num_queries):
    listed = list(coaching.athletes_for(coach))
    with django_assert_num_queries(0):
        assert listed[0].coach == coach and listed[0].gym == coach.gym


def test_one_active_coach_per_athlete(coach, athlete, gym):
    with pytest.raises(coaching.AlreadyCoached):
        coaching.start(CoachFactory(gym=gym), athlete)
    link = athlete.active_coaching
    with pytest.raises(IntegrityError), transaction.atomic():
        type(link).objects.filter(pk=link.pk).update(status=CoachingStatus.ENDED)  # no end date


def test_an_archived_athlete_joins_a_new_coach_with_their_history(coach, athlete, gym):
    BodyweightEntry.objects.create(athlete=athlete, date=athlete.today(), kg=70, source="athlete")
    coaching.end(athlete)
    new_coach = CoachFactory(gym=GymFactory(pack="weightlifting"))
    joined = invites.accept(invites.create(new_coach).pk, user=athlete.user)
    assert joined == athlete and joined.coach == new_coach and joined.gym == new_coach.gym
    assert joined.bodyweights.count() == 1
    assert [link.status for link in athlete.coachings.order_by("started_at")] == ["ended", "active"]


def test_a_coach_sees_an_athlete_only_while_the_link_is_active(coach, athlete, gym):
    other = CoachFactory(gym=gym)
    assert coaching.can_view(coach, athlete) and not coaching.can_view(other, athlete)
    coaching.end(athlete)
    assert not coaching.can_view(coach, athlete)


def test_hidden_history_starts_at_the_new_link(coach, athlete, gym, frozen_clock):
    coaching.end(athlete)
    frozen_clock.shift(datetime.timedelta(days=30))
    new_coach = CoachFactory(gym=gym)
    coaching.start(new_coach, athlete)
    today, last_month = athlete.today(), athlete.today() - datetime.timedelta(days=20)
    assert (
        coaching.can_view(new_coach, athlete, on=last_month)
        and coaching.visible_from(new_coach, athlete) is None
    )
    athlete.hide_history_before_link = True
    athlete.save()
    assert not coaching.can_view(new_coach, athlete, on=last_month)
    assert (
        coaching.can_view(new_coach, athlete, on=today) and coaching.visible_from(new_coach, athlete) == today
    )


def test_a_previous_coach_cannot_write_in_the_old_thread(coach, athlete):
    thread = Thread.for_athlete(athlete)
    messaging.send(thread, coach.user, "See you Monday")
    coaching.end(athlete)
    with pytest.raises(messaging.NotInThread):
        messaging.send(thread, coach.user, "Still there?")
    with pytest.raises(messaging.NotInThread):
        messaging.send(thread, athlete.user, "Bye")


def test_no_alerts_for_an_athlete_without_a_coach(athlete):
    coaching.end(athlete)
    assert alerts.notify(athlete, NotificationKind.ISSUE, "k", "text", "") is None
