"""Billing for a gym's owner (/api/v1/billing/...), on the web only: the plans on offer,
Stripe Checkout and the Customer Portal; and Stripe's webhook. Phones show the plan
read-only (/me). The rules are in stripe_billing.py and entitlements.py."""

from ninja import Router, Schema

from apps.api.main import coach_of

from . import stripe_billing
from .models import Plan

router = Router(tags=["Billing"])


class PlanOut(Schema):
    code: str
    name: str
    max_athletes: int | None
    max_coaches: int | None
    form_videos: bool


class CheckoutIn(Schema):
    plan_code: str


class Url(Schema):
    url: str  # open it in the browser


class Received(Schema):
    received: str


@router.get("/billing/plans", response=list[PlanOut])
def plans(request):
    coach_of(request)
    return list(Plan.objects.filter(public=True).exclude(stripe_price_id="").order_by("name"))


@router.post("/billing/checkout", response=Url)
def checkout(request, data: CheckoutIn):
    """A Stripe Checkout page to subscribe the gym (its owner only)."""
    return {"url": stripe_billing.checkout_url(coach_of(request), data.plan_code)}


@router.post("/billing/portal", response=Url)
def portal(request):
    """Stripe's Customer Portal: cards, invoices, changing or cancelling the plan."""
    return {"url": stripe_billing.portal_url(coach_of(request))}


@router.post("/billing/webhook", auth=None, response=Received, include_in_schema=False)
def webhook(request):
    """Stripe's events, verified by their signature."""
    return {"received": stripe_billing.receive(request.body, request.headers.get("Stripe-Signature", ""))}
