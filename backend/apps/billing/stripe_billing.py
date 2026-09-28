"""Stripe (docs/EXPO_MIGRATION.md, "Billing"): Checkout to subscribe and the Customer Portal
to manage it, both on the web; webhooks keep each gym's Subscription in step.

- Only the gym's owner manages billing.
- Checkout puts the gym's id on the Stripe subscription (metadata), so every later event
  finds its gym even if it arrives before "checkout completed".
- Webhooks: the signature is verified (STRIPE_WEBHOOK_SECRET), and each event is handled
  once (StripeEvent). Events we don't use are recorded and ignored.
- Stripe calls time out (3 s to connect, 10 s to read) and retry twice (audit H14).
"""

import datetime

import stripe
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Gym, GymRole
from apps.core import errors

from .entitlements import default_plan
from .models import Plan, StripeEvent, Subscription, SubscriptionStatus

STATUSES = {
    "trialing": SubscriptionStatus.TRIALING,
    "active": SubscriptionStatus.ACTIVE,
    "past_due": SubscriptionStatus.PAST_DUE,
    "unpaid": SubscriptionStatus.PAST_DUE,
    "canceled": SubscriptionStatus.CANCELED,
    "incomplete_expired": SubscriptionStatus.CANCELED,
}


class BillingOff(errors.NotFound):
    """Billing isn't turned on here."""


def client():
    if not settings.BILLING_ENABLED or not settings.STRIPE_SECRET_KEY:
        raise BillingOff()
    return stripe.StripeClient(
        settings.STRIPE_SECRET_KEY, max_network_retries=2, http_client=stripe.RequestsClient(timeout=(3, 10))
    )


def _owner(coach):
    if coach.membership is None or coach.membership.role != GymRole.OWNER:
        raise errors.Conflict("Only the gym's owner manages billing.")
    return coach.gym


def billing_url(query=""):
    return f"{settings.SITE_URL}/billing{query}"


def checkout_url(coach, plan_code):
    """A Stripe Checkout page subscribing the coach's gym to a public plan."""
    gym = _owner(coach)
    plan = Plan.objects.filter(code=plan_code, public=True).exclude(stripe_price_id="").first()
    if plan is None:
        raise errors.Invalid({"plan_code": "Pick one of the plans offered."})
    sub = getattr(gym, "subscription", None)
    params = {
        "mode": "subscription",
        "line_items": [{"price": plan.stripe_price_id, "quantity": 1}],
        "client_reference_id": str(gym.pk),
        "subscription_data": {"metadata": {"gym_id": str(gym.pk)}},
        "success_url": billing_url("?done=1"),
        "cancel_url": billing_url(),
    }
    if sub and sub.stripe_customer_id:
        params["customer"] = sub.stripe_customer_id
    else:
        params["customer_email"] = coach.user.email
    return client().v1.checkout.sessions.create(params=params).url


def portal_url(coach):
    """Stripe's Customer Portal for the gym (cards, invoices, cancelling)."""
    gym = _owner(coach)
    sub = getattr(gym, "subscription", None)
    if sub is None or not sub.stripe_customer_id:
        raise errors.Conflict("The gym hasn't subscribed yet.")
    session = client().v1.billing_portal.sessions.create(
        params={"customer": sub.stripe_customer_id, "return_url": billing_url()}
    )
    return session.url


def cancel(gym):
    """End the gym's Stripe subscription now: its last coach deleted their account. Nothing
    to do while billing is off or the gym never subscribed."""
    sub = getattr(gym, "subscription", None)
    if not settings.BILLING_ENABLED or sub is None or not sub.stripe_subscription_id:
        return
    client().v1.subscriptions.cancel(sub.stripe_subscription_id)
    sub.status = SubscriptionStatus.CANCELED
    sub.save(update_fields=["status", "updated_at"])


# ---------------------------------------------------------------- webhooks


class BadWebhook(errors.Invalid):
    """Not signed by Stripe with our secret (or not JSON)."""


def receive(payload, signature):
    """Verify and handle one webhook delivery; returns the event's type."""
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise BillingOff()
    try:
        event = stripe.Webhook.construct_event(payload, signature, settings.STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.SignatureVerificationError) as err:
        raise BadWebhook("Not a Stripe webhook.") from err
    handle(event.to_dict())
    return event["type"]


@transaction.atomic
def handle(event):
    """Apply one event to the gym's Subscription, once."""
    _, created = StripeEvent.objects.get_or_create(event_id=event["id"], defaults={"type": event["type"]})
    if not created:
        return  # delivered before
    obj = event["data"]["object"]
    kind = event["type"]
    if kind == "checkout.session.completed":
        _checkout_completed(obj)
    elif kind in (
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    ):
        _subscription_changed(obj, deleted=kind.endswith("deleted"))
    elif kind == "invoice.payment_failed":
        _payment(obj, failed=True)
    elif kind in ("invoice.paid", "invoice.payment_succeeded"):
        _payment(obj, failed=False)


def _subscription_for(gym):
    sub = Subscription.objects.select_for_update().filter(gym=gym).first()
    return sub or Subscription(gym=gym, plan=default_plan())


def _gym(gym_id):
    return Gym.objects.filter(pk=gym_id).first() if gym_id else None


def _checkout_completed(session):
    gym = _gym(session.get("client_reference_id"))
    if gym is None:
        return
    sub = _subscription_for(gym)
    sub.stripe_customer_id = session.get("customer") or sub.stripe_customer_id
    sub.stripe_subscription_id = session.get("subscription") or sub.stripe_subscription_id
    sub.save()


def _when(value):
    return datetime.datetime.fromtimestamp(value, tz=datetime.UTC) if value else None


def _subscription_changed(obj, deleted):
    gym = _gym((obj.get("metadata") or {}).get("gym_id"))
    if gym is None:
        existing = Subscription.objects.filter(stripe_subscription_id=obj["id"]).select_related("gym").first()
        gym = existing.gym if existing else None
    if gym is None:
        return
    sub = _subscription_for(gym)
    items = (obj.get("items") or {}).get("data") or []
    price = items[0]["price"]["id"] if items else None
    plan = Plan.objects.filter(stripe_price_id=price).first() if price else None
    sub.plan = plan or sub.plan
    sub.stripe_customer_id = obj.get("customer") or sub.stripe_customer_id
    sub.stripe_subscription_id = obj["id"]
    sub.status = SubscriptionStatus.CANCELED if deleted else STATUSES.get(obj.get("status"), sub.status)
    # Newer API versions keep the period on each item.
    period_end = obj.get("current_period_end") or (items[0].get("current_period_end") if items else None)
    sub.current_period_end = _when(period_end) or sub.current_period_end
    sub.trial_end = _when(obj.get("trial_end"))
    if sub.status == SubscriptionStatus.ACTIVE:
        sub.payment_failed_at = None
    sub.save()


def _payment(invoice, failed):
    sub = Subscription.objects.select_for_update().filter(stripe_customer_id=invoice.get("customer")).first()
    if sub is None:
        return
    if failed:
        sub.payment_failed_at = sub.payment_failed_at or timezone.now()
        sub.status = SubscriptionStatus.PAST_DUE
    else:
        sub.payment_failed_at = None
        if sub.status == SubscriptionStatus.PAST_DUE:
            sub.status = SubscriptionStatus.ACTIVE
    sub.save()
