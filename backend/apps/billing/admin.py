from django.contrib import admin

from .models import Plan, StripeEvent, Subscription


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ["name", "code", "max_athletes", "max_coaches", "form_videos", "public", "stripe_price_id"]


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ["gym", "plan", "status", "current_period_end", "payment_failed_at"]
    list_filter = ["status", "plan"]
    list_select_related = ["gym", "plan"]


@admin.register(StripeEvent)
class StripeEventAdmin(admin.ModelAdmin):
    list_display = ["type", "event_id", "received_at"]
    readonly_fields = ["type", "event_id", "received_at"]
