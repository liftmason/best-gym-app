"""Stripe Checkout, the Portal and webhooks (apps/billing/stripe_billing.py). Webhook
payloads are shaped like Stripe's and signed the way Stripe signs them; the two outbound
calls are stubbed (docs/plans/S2_API.md, decision B)."""

import hashlib
import hmac
import json
import time
from types import SimpleNamespace

import pytest
from django.test import Client

from apps.billing import stripe_billing
from apps.billing.models import Plan, StripeEvent, Subscription, SubscriptionStatus
from apps.signin import services as signin

from ..factories import CoachFactory

pytestmark = pytest.mark.django_db
SECRET = "whsec_test"


@pytest.fixture(autouse=True)
def billing(settings):
    settings.BILLING_ENABLED = True
    settings.STRIPE_SECRET_KEY = "sk_test_x"
    settings.STRIPE_WEBHOOK_SECRET = SECRET


@pytest.fixture
def pro():
    return Plan.objects.create(
        code="pro", name="Pro", max_athletes=50, stripe_price_id="price_pro", public=True
    )


def deliver(event, secret=SECRET):
    payload = json.dumps(event)
    t = int(time.time())
    signature = hmac.new(secret.encode(), f"{t}.{payload}".encode(), hashlib.sha256).hexdigest()
    return Client().post(
        "/api/v1/billing/webhook",
        payload,
        content_type="application/json",
        HTTP_STRIPE_SIGNATURE=f"t={t},v1={signature}",
    )


def event(kind, obj, n=1):
    return {"id": f"evt_{kind}_{n}", "object": "event", "type": kind, "data": {"object": obj}}


def subscription_event(gym, status="active", kind="customer.subscription.updated", n=1):
    return event(
        kind,
        {
            "id": "sub_1",
            "object": "subscription",
            "customer": "cus_1",
            "status": status,
            "metadata": {"gym_id": str(gym.pk)},
            "items": {
                "object": "list",
                "data": [{"id": "si_1", "price": {"id": "price_pro"}, "current_period_end": 1790000000}],
            },
        },
        n,
    )


def test_subscribing_through_checkout(gym, pro):
    completed = {
        "id": "cs_1",
        "object": "checkout.session",
        "client_reference_id": str(gym.pk),
        "customer": "cus_1",
        "subscription": "sub_1",
    }
    assert deliver(event("checkout.session.completed", completed)).status_code == 200
    assert deliver(subscription_event(gym)).status_code == 200
    sub = Subscription.objects.get(gym=gym)
    assert (sub.plan, sub.status, sub.stripe_customer_id) == (pro, SubscriptionStatus.ACTIVE, "cus_1")
    assert sub.current_period_end.year == 2026


def test_events_in_any_order_find_their_gym(gym, pro):
    assert deliver(subscription_event(gym, kind="customer.subscription.created")).status_code == 200
    assert Subscription.objects.get(gym=gym).plan == pro


def test_a_failed_payment_then_a_paid_one(gym, pro):
    deliver(subscription_event(gym))
    deliver(event("invoice.payment_failed", {"id": "in_1", "object": "invoice", "customer": "cus_1"}))
    sub = Subscription.objects.get(gym=gym)
    assert sub.status == SubscriptionStatus.PAST_DUE and sub.payment_failed_at
    deliver(event("invoice.paid", {"id": "in_2", "object": "invoice", "customer": "cus_1"}))
    sub.refresh_from_db()
    assert sub.status == SubscriptionStatus.ACTIVE and sub.payment_failed_at is None


def test_cancelling_puts_the_gym_back_on_the_default_plan(gym, pro):
    from apps.billing import entitlements

    deliver(subscription_event(gym))
    deliver(subscription_event(gym, kind="customer.subscription.deleted", n=2))
    assert Subscription.objects.get(gym=gym).status == SubscriptionStatus.CANCELED
    assert entitlements.plan_for(gym).code == "unlimited"


def test_a_resent_event_is_handled_once(gym, pro):
    failed = event("invoice.payment_failed", {"id": "in_1", "object": "invoice", "customer": "cus_1"})
    deliver(subscription_event(gym))
    deliver(failed)
    first = Subscription.objects.get(gym=gym).payment_failed_at
    deliver(event("invoice.paid", {"id": "in_2", "object": "invoice", "customer": "cus_1"}))
    assert deliver(failed).status_code == 200  # Stripe resends: nothing changes
    assert Subscription.objects.get(gym=gym).payment_failed_at is None and first
    assert StripeEvent.objects.filter(event_id=failed["id"]).count() == 1


def test_unsigned_or_forged_webhooks_are_refused(gym):
    assert deliver(subscription_event(gym), secret="whsec_wrong").status_code == 400
    assert Client().post("/api/v1/billing/webhook", "{}", content_type="application/json").status_code == 400
    assert not StripeEvent.objects.exists()


def test_webhooks_are_off_without_a_secret(gym, settings):
    settings.STRIPE_WEBHOOK_SECRET = ""
    assert deliver(subscription_event(gym)).status_code == 404


# ---------------------------------------------------------------- Checkout and the Portal


@pytest.fixture
def stripe_calls(monkeypatch):
    calls = []

    def create(params):
        calls.append(params)
        return SimpleNamespace(url="https://checkout.stripe.test/session")

    fake = SimpleNamespace(
        v1=SimpleNamespace(
            checkout=SimpleNamespace(sessions=SimpleNamespace(create=create)),
            billing_portal=SimpleNamespace(sessions=SimpleNamespace(create=create)),
        )
    )
    monkeypatch.setattr(stripe_billing, "client", lambda: fake)
    return calls


def test_the_owner_subscribes_and_manages_billing(coach, gym, pro, stripe_calls):
    from apps.accounts.models import GymRole

    coach.memberships.update(role=GymRole.OWNER)
    coach.__dict__.pop("membership", None)
    api = Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(coach.user).access}")
    assert [p["code"] for p in api.get("/api/v1/billing/plans").json()] == ["pro"]
    response = api.post("/api/v1/billing/checkout", {"plan_code": "pro"}, content_type="application/json")
    assert response.json() == {"url": "https://checkout.stripe.test/session"}
    params = stripe_calls[0]
    assert params["line_items"] == [{"price": "price_pro", "quantity": 1}]
    assert params["subscription_data"]["metadata"]["gym_id"] == str(gym.pk)
    assert (
        api.post(
            "/api/v1/billing/checkout", {"plan_code": "gold"}, content_type="application/json"
        ).status_code
        == 400
    )
    assert api.post("/api/v1/billing/portal").status_code == 409  # not subscribed yet
    Subscription.objects.create(gym=gym, plan=pro, stripe_customer_id="cus_1")
    assert api.post("/api/v1/billing/portal").status_code == 200 and stripe_calls[-1]["customer"] == "cus_1"

    other = CoachFactory(gym=gym)  # joins as a coach, not the owner
    api = Client(HTTP_AUTHORIZATION=f"Bearer {signin.open_session(other.user).access}")
    assert (
        api.post(
            "/api/v1/billing/checkout", {"plan_code": "pro"}, content_type="application/json"
        ).status_code
        == 409
    )
