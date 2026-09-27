"""Account emails. Links are built from `base_url` (the site's address, e.g.
"https://gymtrainer.onrender.com"): a page passes its own, the API and cron use SITE_URL."""

from django.core.mail import send_mail
from django.template.loader import render_to_string

# Where the athlete fills in their numbers (the app's route; see alerts._tab).
NUMBERS_PATH = "/app/profile/numbers/"


def invite_url(base_url, invite):
    """The short /join/<token>/ link that goes in emails and the copy box."""
    return f"{base_url.rstrip('/')}/join/{invite.token}/"


def send_invite_email(base_url, invite):
    context = {
        "invite": invite,
        "coach": invite.coach,
        "gym": invite.coach.gym,
        "join_url": invite_url(base_url, invite),
    }
    subject = render_to_string("emails/invite_subject.txt", context).strip()
    body = render_to_string("emails/invite.txt", context)
    send_mail(subject, body, None, [invite.email])


def send_metrics_reminder(base_url, athlete, missing_keys):
    from .metrics import metric_specs

    labels = [m.label for m in metric_specs(athlete.gym) if m.key in missing_keys]
    context = {
        "athlete": athlete,
        "coach": athlete.coach,
        "labels": labels,
        "url": f"{base_url.rstrip('/')}{NUMBERS_PATH}",
    }
    subject = render_to_string("emails/metrics_reminder_subject.txt", context).strip()
    body = render_to_string("emails/metrics_reminder.txt", context)
    send_mail(subject, body, None, [athlete.user.email])
