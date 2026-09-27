"""The "Report a bug" button in both headers, the reports in the admin, and ensure_admin."""

import pytest
from django.core.management import call_command
from django.test import Client

from apps.accounts.models import User
from apps.dashboard.models import BugReport

pytestmark = pytest.mark.django_db


def test_reports_are_listed_in_the_admin(coach, athlete, monkeypatch):
    BugReport.objects.create(
        user=athlete.user, side="athlete", description="Save button froze", page="javascript:alert(1)"
    )
    monkeypatch.setenv("ADMIN_EMAIL", "steven@example.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "a-long-admin-password")
    call_command("ensure_admin")
    admin = Client()
    admin.force_login(User.objects.get(email="steven@example.com"))
    listing = admin.get("/admin/dashboard/bugreport/").content.decode()
    assert "Save button froze" in listing
    detail = admin.get(f"/admin/dashboard/bugreport/{BugReport.objects.get().pk}/change/").content.decode()
    assert 'href="javascript:' not in detail  # a page address from the browser never becomes a script link


def test_ensure_admin(monkeypatch, athlete):
    call_command("ensure_admin")  # nothing set: nothing happens
    assert not User.objects.filter(is_superuser=True).exists()
    monkeypatch.setenv("ADMIN_EMAIL", "Steven@Example.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "short")
    call_command("ensure_admin")
    assert not User.objects.filter(is_superuser=True).exists()
    monkeypatch.setenv("ADMIN_PASSWORD", "a-long-admin-password")
    call_command("ensure_admin")
    admin = User.objects.get(email="steven@example.com")
    assert admin.is_superuser and admin.is_staff and admin.check_password("a-long-admin-password")
    monkeypatch.setenv("ADMIN_PASSWORD", "a-new-long-password")
    call_command("ensure_admin")
    admin.refresh_from_db()
    assert admin.check_password("a-new-long-password") and User.objects.filter(is_superuser=True).count() == 1
