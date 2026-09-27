"""Settings that must fail loudly when they're wrong (audit M32, H14)."""

import pytest
from django.core.exceptions import ImproperlyConfigured

from apps.workouts import videos
from config.settings import checks


def test_email_goes_to_the_console_unless_a_provider_is_set():
    assert checks.email("", "") == ("django.core.mail.backends.console.EmailBackend", {})
    assert checks.email("console", "")[0].endswith("console.EmailBackend")


def test_a_real_provider_gets_its_key_and_a_timeout():
    backend, anymail = checks.email("resend", "re_123")
    assert backend == "anymail.backends.resend.EmailBackend"
    assert anymail == {"RESEND_API_KEY": "re_123", "REQUESTS_TIMEOUT": 10}


@pytest.mark.parametrize("provider,key", [("resnd", "re_123"), ("postmark", "")])
def test_a_typo_or_a_missing_key_is_refused(provider, key):
    with pytest.raises(ImproperlyConfigured):
        checks.email(provider, key)


def test_production_needs_real_addresses():
    good = {
        "email_provider": "resend",
        "from_email": "Coach <hi@gym.example>",
        "site_url": "https://gym.example",
    }
    assert checks.production_problems(**good) == []
    assert checks.production_problems(**good | {"email_provider": ""})
    assert checks.production_problems(**good | {"site_url": "http://localhost:8000"})
    assert checks.production_problems(**good | {"from_email": "Coach <no-reply@localhost>"})
    # Saying "console" on purpose is allowed (no email yet); the sender then doesn't matter.
    assert (
        checks.production_problems(**good | {"email_provider": "console", "from_email": "x@localhost"}) == []
    )


def test_storage_calls_time_out():
    config = videos.client().meta.config
    assert (config.connect_timeout, config.read_timeout) == (3, 10)
    assert config.retries["total_max_attempts"] == 3  # the first try and two retries
