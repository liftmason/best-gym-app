"""The product's name is written once (settings.APP_NAME), so renaming it is one change."""

from pathlib import Path

from django.conf import settings
from django.core import mail

from apps.accounts import emails, invites

BACKEND = Path(__file__).resolve().parents[2]
PLACEHOLDERS = [settings.APP_NAME, "Platform"]  # "Platform" was the mockup's


def test_no_code_or_email_spells_out_the_name():
    base = BACKEND / "config/settings/base.py"
    files = [*(BACKEND / "apps").rglob("*.py"), *(BACKEND / "config").rglob("*.py")]
    files += (BACKEND / "templates").rglob("*.txt")
    spelled = [
        str(f.relative_to(BACKEND))
        for f in files
        if f != base and any(name in f.read_text() for name in PLACEHOLDERS)
    ]
    assert spelled == []


def test_emails_say_the_name(coach, settings):
    settings.APP_NAME = "Barbell Club"
    invite = invites.create(coach, email="new@example.com")
    emails.send_invite_email("https://app.example", invite)
    assert "on Barbell Club, where" in mail.outbox[-1].body
