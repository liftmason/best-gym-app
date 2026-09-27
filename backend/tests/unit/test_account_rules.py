"""Account-side rules moved out of the pages: metrics (limits, coach edits, reminders), gym
settings, the "max updates" preference, the roster, PR decisions, sign-in limits."""

import datetime
from decimal import Decimal

import pytest
from django.core import mail

from apps import ratelimit
from apps.accounts import coaching, metrics, services
from apps.accounts.models import Athlete, MaxEntry, MaxUpdates
from apps.programs import services as program_services
from apps.programs.models import WeekType
from apps.workouts import prs, sessions

from ..conftest import ex, lift_field
from ..factories import AthleteFactory, CoachFactory

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------- metrics


def spec(gym, key):
    return metrics.spec_for(gym, key)


@pytest.mark.parametrize(
    "key, raw, ok",
    [
        ("bodyweight", "64.5", True),
        ("bodyweight", "19", False),
        ("height_cm", "168.5", True),
        ("height_cm", "168.55", False),  # one decimal place
        ("height_cm", "99", False),
        ("years_training", "3-5", True),
        ("years_training", "forever", False),
    ],
)
def test_metric_limits(gym, key, raw, ok):
    if ok:
        assert metrics.clean_value(spec(gym, key), raw) is not None
    else:
        with pytest.raises(metrics.InvalidMetric):
            metrics.clean_value(spec(gym, key), raw)


def test_lift_limits_and_blanks(gym):
    snatch = spec(gym, lift_field(gym, "sn"))
    assert metrics.clean_value(snatch, "82.5") == Decimal("82.5")
    assert metrics.clean_value(snatch, "") is None
    for bad in ("0", "1001", "heavy"):
        with pytest.raises(metrics.InvalidMetric):
            metrics.clean_value(snatch, bad)


def test_validate_checks_only_the_gyms_metrics(gym):
    assert metrics.validate(gym, {"bodyweight": "70", "lift_999999": "100"}) == {"bodyweight": Decimal("70")}


def test_a_coach_sets_a_max_in_the_gyms_unit(athlete, gym):
    key = lift_field(gym, "sn")
    metrics.save_coach_metric(athlete, key, "220", date=athlete.today(), entry_units="lb")
    entry = MaxEntry.objects.get(athlete=athlete)
    assert entry.kg == Decimal("99.79") and entry.source == "coach"


def test_coach_edits_refuse_future_dates_and_unknown_metrics(athlete, gym):
    with pytest.raises(metrics.InvalidMetric):
        metrics.save_coach_metric(
            athlete, "bodyweight", "70", date=athlete.today() + datetime.timedelta(days=1)
        )
    with pytest.raises(metrics.MetricUnknown):
        metrics.save_coach_metric(athlete, "lift_999999", "100")
    metrics.save_coach_metric(athlete, "height_cm", "170", date=athlete.today() + datetime.timedelta(days=9))
    athlete.refresh_from_db()
    assert athlete.height_cm == Decimal("170")  # height has no date, so none is checked


def test_reminders_only_when_something_is_missing(athlete, gym):
    assert metrics.remind(athlete, "https://site.test")
    assert len(mail.outbox) == 1 and "https://site.test/app/" in mail.outbox[0].body
    metrics.save_metrics(
        athlete,
        {
            "bodyweight": Decimal("64"),
            "height_cm": Decimal("168"),
            "years_training": "3-5",
            **{m.key: Decimal("80") for m in metrics.metric_specs(gym) if m.exercise},
        },
        source="athlete",
    )
    assert metrics.remind(athlete, "https://site.test") == []
    assert len(mail.outbox) == 1


# ---------------------------------------------------------------- settings, roster, preferences


def settings_for(coach, **overrides):
    fields = {
        "gym_name": "Iron Ridge",
        "coach_title": "Owner",
        "digest": False,
        "timezone": "Europe/London",
        "units": "lb",
        "week_start": 6,
    }
    return services.update_gym_settings(coach, **{**fields, **overrides})


def test_gym_settings(coach):
    settings_for(coach)
    gym = coach.gym
    assert (gym.name, gym.timezone, gym.units, gym.week_start) == ("Iron Ridge", "Europe/London", "lb", 6)
    assert (coach.title, coach.digest) == ("Owner", False)


@pytest.mark.parametrize(
    "overrides",
    [
        {"gym_name": " "},
        {"coach_title": "x" * 61},
        {"timezone": "Mars/Base"},
        {"units": "st"},
        {"week_start": 9},
    ],
)
def test_gym_settings_refused(coach, overrides):
    with pytest.raises(services.InvalidSettings):
        settings_for(coach, **overrides)


def test_roster_is_the_coachs_active_athletes(coach, athlete, gym):
    archived = AthleteFactory(coach=coach)
    coaching.end(archived)
    AthleteFactory(coach=CoachFactory(gym=gym))  # another coach's
    cards = services.roster(coach)
    assert [c["athlete"] for c in cards] == [athlete] and cards[0]["missing"] > 0
    assert services.roster(coach, "nobody") == []
    assert services.roster(coach, "MAYA")[0]["athlete"] == athlete
    with pytest.raises(Athlete.DoesNotExist):
        services.coach_athlete(coach, archived.pk)


def test_max_updates_preference(athlete):
    assert services.set_max_updates(athlete, MaxUpdates.APPROVE).max_updates == MaxUpdates.APPROVE
    with pytest.raises(ValueError):
        services.set_max_updates(athlete, "sometimes")


# ---------------------------------------------------------------- PR decisions


@pytest.fixture
def pending_pr(athlete, coach, gym):
    services.set_max_updates(athlete, MaxUpdates.APPROVE)
    MaxEntry.objects.create(
        athlete=athlete,
        exercise=ex(gym, "sn"),
        date=athlete.today() - datetime.timedelta(days=5),
        kg=80,
        source="coach",
    )
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    program = program_services.start_program(athlete, "P", athlete.today(), 1, week_type, by=coach.user)
    day = program.weeks.get().days.get(date=athlete.today())
    program_services.add_prescription(day, ex(gym, "sn"), athlete)
    log = sessions.start(athlete, day.sessions.get())
    s = sessions.log_set(log.exercises.get(), 1, load="85", reps="1", done=True)
    sessions.finish(log, 9)
    return s


def test_using_a_pr_makes_it_the_max(athlete, gym, pending_pr):
    prs.decide(athlete, pending_pr.pk, use=True)
    assert athlete.current_max(ex(gym, "sn")).kg == Decimal("85")
    with pytest.raises(prs.AlreadyHandled):
        prs.decide(athlete, pending_pr.pk, use=True)


def test_dismissing_a_pr_keeps_the_max(athlete, gym, pending_pr):
    prs.decide(athlete, pending_pr.pk, use=False)
    assert athlete.current_max(ex(gym, "sn")).kg == Decimal("80")
    assert prs.pending(athlete) == []


# ---------------------------------------------------------------- sign-in limits


def test_sign_in_limits_per_pair_address_and_email():
    for _ in range(10):
        assert ratelimit.login_allowed("203.0.113.1", "a@example.com")
    assert not ratelimit.login_allowed("203.0.113.1", "A@example.com")  # emails compare in lower case
    assert ratelimit.login_allowed("203.0.113.2", "a@example.com")
