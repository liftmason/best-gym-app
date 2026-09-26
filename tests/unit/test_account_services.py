"""Coach sign-up and invites (apps/accounts/services.py, apps/accounts/invites.py), tested
directly rather than through the pages."""

import datetime

import pytest
from django.utils import timezone

from apps.accounts import invites, services
from apps.accounts.models import Invite, InviteStatus, User
from apps.exercises.models import Exercise
from apps.library import services as library_services
from apps.library.models import TemplateKind
from apps.workouts.models import CheckinQuestion, install_default_questions

from ..conftest import ex
from ..factories import CoachFactory, GymFactory

pytestmark = pytest.mark.django_db


def sign_up(**overrides):
    fields = {
        "name": "Sam Coach",
        "email": "sam@example.com",
        "gym_name": "Harbour Strength",
        "units": "lb",
        "starter": "general",
        "timezone": "America/Chicago",
    }
    return services.sign_up_coach(**{**fields, **overrides})


# ---------------------------------------------------------------- coach sign-up


def test_sign_up_creates_the_coach_and_their_gym():
    coach = sign_up(password="a-good-long-password")
    gym = coach.gym
    assert (gym.name, gym.units, gym.timezone) == ("Harbour Strength", "lb", "America/Chicago")
    assert coach.user.timezone == "America/Chicago" and coach.user.check_password("a-good-long-password")
    assert Exercise.objects.filter(gym=gym).exists()  # the starter pack
    assert CheckinQuestion.objects.gym_defaults(gym).count() == 2


def test_sign_up_without_a_password_or_a_real_zone():
    coach = sign_up(timezone="Mars/Olympus")
    assert coach.gym.timezone == "UTC"
    assert not coach.user.has_usable_password()  # sign-in moves to email codes


def test_sign_up_refuses_a_taken_email_whatever_its_case():
    sign_up()
    with pytest.raises(services.AccountExists):
        sign_up(email="SAM@example.com")


def test_sign_up_refuses_unknown_choices():
    with pytest.raises(ValueError):
        sign_up(units="stone")
    with pytest.raises(ValueError):
        sign_up(starter="yoga")


# ---------------------------------------------------------------- creating and revoking invites


def test_a_starting_template_must_be_the_gyms_program_or_saved_week(coach, gym):
    program = library_services.new_template(gym, TemplateKind.PROGRAM, coach.user)
    session = library_services.new_template(gym, TemplateKind.SESSION, coach.user)
    other_gym = library_services.new_template(GymFactory(pack="general"), TemplateKind.PROGRAM, None)
    assert invites.create(coach, "a@example.com", program).starting_template == program
    for template in (session, other_gym):
        with pytest.raises(ValueError):
            invites.create(coach, "", template)


def test_revoking_only_touches_the_coachs_own_pending_invites(coach, gym):
    invite = invites.create(coach)
    with pytest.raises(Invite.DoesNotExist):
        invites.revoke(CoachFactory(gym=gym), invite.pk)
    invites.revoke(coach, invite.pk)
    assert Invite.objects.get().status == InviteStatus.REVOKED
    with pytest.raises(Invite.DoesNotExist):
        invites.revoke(coach, invite.pk)  # no longer pending


def test_pending_leaves_out_expired_invites(coach):
    live, old = invites.create(coach), invites.create(coach)
    Invite.objects.filter(pk=old.pk).update(expires_at=timezone.now() - datetime.timedelta(seconds=1))
    assert invites.pending(coach) == [live]


# ---------------------------------------------------------------- accepting


def test_a_new_account_joins_through_an_invite(coach, gym):
    install_default_questions(gym)  # sign-up gives every gym these
    invite = invites.create(coach, "pat@example.com")
    athlete = invites.accept(invite.pk, name="Pat", email="pat@example.com", timezone_name="Nowhere/Real")
    assert athlete.coach == coach and athlete.gym == gym and athlete.units == gym.units
    assert athlete.user.timezone == gym.timezone  # the gym's zone when the device's isn't real
    assert CheckinQuestion.objects.for_athlete(athlete).count() == 2
    invite.refresh_from_db()
    assert (invite.status, invite.accepted_by) == (InviteStatus.ACCEPTED, athlete.user)


def test_an_existing_account_joins_as_itself(coach):
    user = User.objects.create_user("coach-too@example.com", name="Kim")
    athlete = invites.accept(invites.create(coach).pk, user=user)
    assert athlete.user == user


def test_an_invite_works_once(coach):
    invite = invites.create(coach)
    invites.accept(invite.pk, name="A", email="a@example.com")
    with pytest.raises(invites.InviteUnusable):
        invites.accept(invite.pk, name="B", email="b@example.com")


def test_revoked_and_expired_invites_are_unusable(coach):
    revoked, expired = invites.create(coach), invites.create(coach)
    invites.revoke(coach, revoked.pk)
    Invite.objects.filter(pk=expired.pk).update(expires_at=timezone.now() - datetime.timedelta(seconds=1))
    for invite in (revoked, expired):
        with pytest.raises(invites.InviteUnusable):
            invites.accept(invite.pk, name="A", email="a@example.com")


def test_accounts_that_cannot_take_an_athlete_profile(coach, athlete):
    with pytest.raises(invites.AlreadyAthlete):
        invites.accept(invites.create(coach).pk, user=athlete.user)
    athlete.archived_at = timezone.now()
    athlete.save()
    with pytest.raises(invites.ArchivedAthlete):
        invites.accept(invites.create(coach).pk, user=athlete.user)
    with pytest.raises(services.AccountExists):
        invites.accept(invites.create(coach).pk, name="Maya", email="MAYA@example.com")


def test_the_starting_template_arrives_as_an_unpublished_draft(coach, gym):
    template = library_services.new_template(gym, TemplateKind.PROGRAM, coach.user)
    library_services.add_slot(template.weeks.get().sessions.first(), ex(gym, "sn"))
    athlete = invites.accept(invites.create(coach, "", template).pk, name="A", email="a@example.com")
    program = athlete.programs.active().get()
    assert program.source_template == template
    assert not program.weeks.filter(published=True).exists()
    assert program.start_date > athlete.today()  # from next week
