"""Rules that were only tested through the pages (S0 step 2 triage), now tested directly:
landing by profile, sign-in, account and invite checks, onboarding numbers, starter packs,
categories, sign-in limits."""

import datetime
from decimal import Decimal

import pytest
from django.contrib.auth import authenticate
from django.core import mail

from apps import ratelimit
from apps.accounts import invites, metrics, services
from apps.accounts.models import Athlete, BodyweightEntry, Invite, InviteStatus, MaxEntry
from apps.exercises import services as library
from apps.exercises.models import Category, Exercise, Measure, Tag, TrackedLift
from apps.programs.models import WeekType

from ..conftest import PASSWORD, cat, ex, lift_field
from ..factories import AthleteFactory, CoachFactory, GymFactory

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------- landing and sign-in


def test_sign_in_ignores_the_emails_case(coach):
    assert authenticate(username="DANA@Example.com", password=PASSWORD) == coach.user


# ---------------------------------------------------------------- new accounts


def test_passwords_must_pass_the_validators():
    with pytest.raises(services.InvalidAccount):
        services.sign_up_coach(
            name="Sam",
            email="sam@example.com",
            gym_name="Gym",
            units="kg",
            starter="empty",
            timezone="UTC",
            password="123",
        )
    coach = services.sign_up_coach(
        name="Sam",
        email="sam@example.com",
        gym_name="Gym",
        units="kg",
        starter="empty",
        timezone="UTC",
        password="a-long-enough-passphrase",
    )
    assert coach.user.check_password("a-long-enough-passphrase")


def test_names_are_required_and_limited():
    for name, gym_name in (("", "Gym"), ("x" * 151, "Gym"), ("Sam", ""), ("Sam", "x" * 121)):
        with pytest.raises(services.InvalidAccount):
            services.sign_up_coach(
                name=name,
                email="sam@example.com",
                gym_name=gym_name,
                units="kg",
                starter="empty",
                timezone="UTC",
            )


def test_joining_checks_the_password_and_leaves_the_invite_pending_on_a_clash(coach, athlete):
    invite = invites.create(coach)
    with pytest.raises(services.InvalidAccount):
        invites.accept(invite.pk, name="Pat", email="pat@example.com", password="short")
    with pytest.raises(services.AccountExists):
        invites.accept(invite.pk, name="Maya", email="maya@example.com")
    invite.refresh_from_db()
    assert invite.status == InviteStatus.PENDING


def test_coach_athlete_refuses_another_coachs_athlete(coach, gym):
    other = AthleteFactory(coach=CoachFactory(gym=gym))
    with pytest.raises(Athlete.DoesNotExist):
        services.coach_athlete(coach, other.pk)


# ---------------------------------------------------------------- invites


def test_an_invite_with_an_address_is_emailed(coach):
    invite = invites.create(coach, "pat@example.com", base_url="https://site.test")
    (email,) = mail.outbox
    assert email.to == ["pat@example.com"]
    assert email.subject == f"{coach.user.name} invited you to train with {coach.gym.name}"
    assert f"https://site.test/join/{invite.token}/" in email.body


def test_an_invite_without_an_address_is_just_a_link(coach):
    invites.create(coach, "", base_url="https://site.test")
    invites.create(coach, "pat@example.com")  # no site address given: not sent either
    assert mail.outbox == []


def test_invite_addresses_must_be_emails(coach):
    with pytest.raises(invites.InvalidInvite):
        invites.create(coach, "not-an-email")


def test_pending_leaves_out_accepted_and_revoked(coach):
    live, used, revoked = invites.create(coach), invites.create(coach), invites.create(coach)
    invites.accept(used.pk, name="A", email="a@example.com")
    invites.revoke(coach, revoked.pk)
    assert invites.pending(coach) == [live]


def test_the_join_link_resolves_to_the_join_page(coach):
    from apps.accounts.emails import invite_url

    invite = invites.create(coach)
    url = invite_url("https://site.test/", invite)
    assert url == f"https://site.test/join/{invite.token}/"
    assert Invite.objects.get(token=url.rstrip("/").rsplit("/", 1)[1]) == invite


# ---------------------------------------------------------------- onboarding numbers


def test_onboarding_numbers_default_to_the_athletes_unit(athlete, gym):
    athlete.units = "lb"
    athlete.save()
    metrics.save_metrics(
        athlete,
        {
            "bodyweight": Decimal("141"),
            lift_field(gym, "sn"): None,
            "height_cm": Decimal("168"),
            "years_training": "1-3",
        },
        source="onboarding",
    )
    entry = BodyweightEntry.objects.get(athlete=athlete)
    assert (entry.kg, entry.source) == (Decimal("63.96"), "onboarding")
    assert not MaxEntry.objects.exists()  # the blank lift is skipped
    athlete.refresh_from_db()
    assert (athlete.height_cm, athlete.years_training) == (Decimal("168"), "1-3")


def test_athletes_fill_in_only_whats_missing(athlete, gym):
    metrics.save_metrics(athlete, {"bodyweight": Decimal("64")}, source="athlete")
    filled = metrics.save_missing(
        athlete, {"bodyweight": "70", "height_cm": "168", lift_field(gym, "sn"): ""}
    )
    assert filled == ["height_cm"]
    assert BodyweightEntry.objects.filter(athlete=athlete).count() == 1  # already had one: ignored
    with pytest.raises(metrics.InvalidMetric):
        metrics.save_missing(athlete, {"years_training": "forever"})


def test_untracked_lifts_are_not_metrics(athlete, gym):
    key = lift_field(gym, "fsq")  # a lift the gym doesn't track
    assert metrics.spec_for(gym, key) is None
    with pytest.raises(metrics.MetricUnknown):
        metrics.save_coach_metric(athlete, key, "100")


def test_years_training_replaces_the_value(athlete):
    metrics.save_coach_metric(athlete, "years_training", "3-5")
    metrics.save_coach_metric(athlete, "years_training", "5+")
    athlete.refresh_from_db()
    assert athlete.years_training == "5+"


def test_reminders_list_the_missing_numbers_by_name(athlete, gym):
    metrics.remind(athlete, "https://site.test")
    body = mail.outbox[0].body
    assert "Snatch 1RM" in body and "Front Squat" not in body  # tracked lifts only
    assert "https://site.test/app/profile/numbers/" in body


# ---------------------------------------------------------------- starter packs and categories


def test_the_general_pack(db):
    gym = GymFactory(pack="general")
    names = set(Exercise.objects.filter(gym=gym).values_list("name", flat=True))
    tracked = list(TrackedLift.objects.filter(gym=gym).values_list("exercise__name", flat=True))
    assert tracked == ["Back Squat", "Bench Press", "Deadlift"]
    rdl = Exercise.objects.get(gym=gym, name="Romanian Deadlift")
    assert rdl.percent_of.name == "Deadlift"
    assert Exercise.objects.get(gym=gym, name="Farmer Carry").measure == Measure.DISTANCE
    assert not Exercise.objects.filter(gym=gym).exclude(youtube_url="").exists()
    assert "Snatch" not in names


def test_the_empty_pack(db):
    gym = GymFactory(pack="empty")
    assert Category.objects.filter(gym=gym).count() == 4
    assert WeekType.objects.filter(gym=gym).count() == 3
    assert not Exercise.objects.filter(gym=gym).exists()
    assert not Tag.objects.filter(gym=gym).exists() and not TrackedLift.objects.filter(gym=gym).exists()


def test_deleting_a_category_moves_archived_exercises_too(gym):
    snatch = cat(gym, "snatch")
    library.archive(ex(gym, "sn"))
    library.delete_category(snatch, cat(gym, "accessory"))
    assert ex(gym, "sn").category == cat(gym, "accessory")


def test_a_category_cannot_move_its_exercises_to_another_gym(gym):
    other = Category.objects.filter(gym=GymFactory(pack="weightlifting")).first()
    with pytest.raises(library.NeedsTarget):
        library.delete_category(cat(gym, "snatch"), other)


def test_duplicate_tags_and_week_type_names_are_refused(gym):
    from apps.programs import week_types

    with pytest.raises(library.InvalidName):
        library.add_tag(gym, "OVERHEAD")
    deload = WeekType.objects.get(gym=gym, name="Deload")
    for name in ("", "accumulation"):
        with pytest.raises(week_types.InvalidWeekType):
            week_types.update(deload, name=name, colour_value="#123456", description="")


# ---------------------------------------------------------------- sign-in limits


def test_one_address_gets_fifty_tries_across_accounts():
    for i in range(50):
        assert ratelimit.login_allowed("203.0.113.9", f"person{i}@example.com")
    assert not ratelimit.login_allowed("203.0.113.9", "someone-new@example.com")


def test_one_account_gets_thirty_tries_from_anywhere():
    for i in range(30):
        assert ratelimit.login_allowed(f"198.51.100.{i}", "maya@example.com")
    assert not ratelimit.login_allowed("198.51.100.250", "maya@example.com")


def test_rate_limit_windows_expire(frozen_clock):
    for _ in range(3):
        assert ratelimit.hit("test", "k", 3, 60)
    assert not ratelimit.hit("test", "k", 3, 60)
    frozen_clock.shift(datetime.timedelta(seconds=61))
    assert ratelimit.hit("test", "k", 3, 60)
