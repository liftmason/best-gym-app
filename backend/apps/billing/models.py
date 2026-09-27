"""What a gym pays for (docs/EXPO_MIGRATION.md, "Billing"). The gym pays, not each coach;
athletes never pay. A gym with no Subscription is on the default plan (settings.DEFAULT_PLAN,
Unlimited while billing is off)."""

from django.db import models

from apps.core import models as core


class Plan(core.Model):
    """Limits and features a gym gets. Blank limits mean no limit. Plans and prices are the
    owner's to set (in the admin) when billing is turned on."""

    code = models.SlugField(max_length=40, unique=True)
    name = models.CharField(max_length=80)
    max_athletes = models.PositiveIntegerField(null=True, blank=True)
    max_coaches = models.PositiveIntegerField(null=True, blank=True)
    form_videos = models.BooleanField(default=True)
    stripe_price_id = models.CharField(
        max_length=100, blank=True, help_text="The Stripe price Checkout sells."
    )
    public = models.BooleanField(default=False, help_text="Offered on the billing page.")

    def __str__(self):
        return self.name


class SubscriptionStatus(models.TextChoices):
    TRIALING = "trialing", "Trial"
    ACTIVE = "active", "Active"
    PAST_DUE = "past_due", "Payment failed"
    CANCELED = "canceled", "Cancelled"


class Subscription(core.Model):
    """A gym's paid plan, kept up to date from Stripe's webhooks."""

    gym = models.OneToOneField("accounts.Gym", on_delete=models.CASCADE, related_name="subscription")
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="subscriptions")
    status = models.CharField(
        max_length=10, choices=SubscriptionStatus.choices, default=SubscriptionStatus.ACTIVE
    )
    stripe_customer_id = models.CharField(max_length=100, blank=True, db_index=True)
    stripe_subscription_id = models.CharField(max_length=100, blank=True, db_index=True)
    current_period_end = models.DateTimeField(null=True, blank=True)
    trial_end = models.DateTimeField(null=True, blank=True)
    payment_failed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.gym}: {self.plan} ({self.get_status_display()})"


class StripeEvent(core.Model):
    """Each Stripe webhook event handled, so a resent one is handled once."""

    event_id = models.CharField(max_length=100, unique=True)
    type = models.CharField(max_length=100)
    received_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.type} {self.event_id}"
