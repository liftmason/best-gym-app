"""What a gym may do on its plan: `check(gym, action)` for every limited action, and
`require` to refuse. While settings.BILLING_ENABLED is off, everything is allowed and no
upgrade prompts show; turning billing on means setting the default plan and the setting,
not writing code. Athletes can always log and view their own data: nothing an athlete does
for themselves is checked here.
"""

import datetime
from dataclasses import dataclass

from django.conf import settings
from django.utils import timezone

from apps.core import errors

from .models import Plan, SubscriptionStatus

ADD_ATHLETE = "add_athlete"
FORM_VIDEOS = "form_videos"
PROGRAM = "program"  # coach programming: board, library, templates, applying
GRACE = datetime.timedelta(days=7)  # full access after a failed payment


class NotEntitled(errors.PaymentRequired):
    """With what the plan doesn't allow; the app offers the billing page."""


@dataclass
class Decision:
    allowed: bool
    reason: str = ""


def default_plan():
    plan, _ = Plan.objects.get_or_create(
        code=settings.DEFAULT_PLAN, defaults={"name": settings.DEFAULT_PLAN.replace("-", " ").title()}
    )
    return plan


def subscription(gym):
    return getattr(gym, "subscription", None) if gym.pk else None


def plan_for(gym):
    """The gym's plan: its subscription's, unless cancelled; else the default."""
    sub = subscription(gym)
    if sub is None or sub.status == SubscriptionStatus.CANCELED:
        return default_plan()
    return sub.plan


def lapsed(gym, now=None):
    """Payment failed more than GRACE ago and hasn't been fixed."""
    sub = subscription(gym)
    return bool(sub and sub.payment_failed_at and (now or timezone.now()) - sub.payment_failed_at > GRACE)


def athletes_in(gym):
    from apps.accounts.models import Coaching, CoachingStatus

    return Coaching.objects.filter(gym=gym, status=CoachingStatus.ACTIVE).count()


def check(gym, action):
    if not settings.BILLING_ENABLED:
        return Decision(True)
    plan = plan_for(gym)
    if action == PROGRAM:
        if lapsed(gym):
            return Decision(False, "The gym's payment failed, so programming is read-only until it's fixed.")
        return Decision(True)
    if action == ADD_ATHLETE:
        if plan.max_athletes is not None and athletes_in(gym) >= plan.max_athletes:
            return Decision(False, f"The {plan.name} plan has room for {plan.max_athletes} athletes.")
        return Decision(True)
    if action == FORM_VIDEOS:
        return Decision(
            plan.form_videos, "" if plan.form_videos else f"The {plan.name} plan doesn't include form videos."
        )
    raise ValueError(action)


def require(gym, action):
    decision = check(gym, action)
    if not decision.allowed:
        raise NotEntitled(decision.reason)


def summary(gym):
    """What /me shows a coach: the plan, its limits and what's allowed now."""
    plan = plan_for(gym)
    sub = subscription(gym)
    return {
        "billing_enabled": settings.BILLING_ENABLED,
        "plan": {"code": plan.code, "name": plan.name},
        "status": sub.status if sub else None,
        "athletes": {"used": athletes_in(gym), "max": plan.max_athletes},
        "form_videos": check(gym, FORM_VIDEOS).allowed,
        "programming": check(gym, PROGRAM).allowed,
    }
