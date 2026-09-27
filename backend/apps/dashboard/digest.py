"""The coach's morning email: new "Needs your attention" items since the last one.

Sent once a day from DIGEST_HOUR in the gym's time zone, only when there's something new,
to coaches who haven't turned it off in Settings. The cron job runs hourly (manage.py cron):
a run missed at 7am sends at the next one, and a failed send is tried again next hour,
because the send is recorded only after the email has gone (audit H10).
"""

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.template.loader import render_to_string
from django.utils import timezone

from apps.core import models as core

from . import alerts

DIGEST_HOUR = 7


def due(coach, now):
    local = timezone.localtime(now, coach.gym_zone)
    if local.hour < DIGEST_HOUR or not coach.digest:
        return False
    last = coach.last_digest_at
    return last is None or timezone.localtime(last, coach.gym_zone).date() < local.date()


def items(coach):
    rows = alerts.feed(coach).filter(read_at__isnull=True)
    if coach.last_digest_at:
        rows = rows.filter(created_at__gt=coach.last_digest_at)
    return [{"row": r, "url": settings.SITE_URL + alerts.link_for(r)} for r in rows.order_by("created_at")]


@transaction.atomic
def send(coach, now=None):
    """Send if due and there's something new; returns the number of items sent. The coach
    row is locked, so two cron runs at once can't both send."""
    now = now or timezone.now()
    core.lock(coach)
    coach.refresh_from_db()
    if not due(coach, now):
        return 0
    new = items(coach)
    if not new:
        coach.last_digest_at = now
        coach.save(update_fields=["last_digest_at"])
        return 0
    context = {
        "coach": coach,
        "items": new,
        "dashboard": settings.SITE_URL + "/coach/",
        "settings_url": settings.SITE_URL + "/coach/settings/",
    }
    subject = render_to_string("emails/digest_subject.txt", context).strip()
    send_mail(subject, render_to_string("emails/digest.txt", context), None, [coach.user.email])
    coach.last_digest_at = now  # only once the email has gone
    coach.save(update_fields=["last_digest_at"])
    return len(new)
