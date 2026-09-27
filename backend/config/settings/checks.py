"""Settings built from the environment that must fail loudly when they're wrong (audit
M32): a typo in EMAIL_PROVIDER used to fall back to printing email, and production could
start with emails sent from, and linking to, localhost."""

from django.core.exceptions import ImproperlyConfigured

CONSOLE = "django.core.mail.backends.console.EmailBackend"
PROVIDERS = {
    "resend": ("anymail.backends.resend.EmailBackend", "RESEND_API_KEY"),
    "postmark": ("anymail.backends.postmark.EmailBackend", "POSTMARK_SERVER_TOKEN"),
}
EMAIL_TIMEOUT = 10  # seconds; Anymail's default of 30 is a whole gunicorn worker timeout (H14)


def email(provider, key):
    """(EMAIL_BACKEND, ANYMAIL) for EMAIL_PROVIDER and EMAIL_API_KEY. Blank or "console"
    prints email to the console."""
    if provider in ("", "console"):
        return CONSOLE, {}
    if provider not in PROVIDERS:
        raise ImproperlyConfigured(
            f"EMAIL_PROVIDER {provider!r} isn't one of: console, {', '.join(PROVIDERS)}"
        )
    if not key:
        raise ImproperlyConfigured(f"EMAIL_PROVIDER is {provider!r} but EMAIL_API_KEY is empty")
    backend, setting = PROVIDERS[provider]
    return backend, {setting: key, "REQUESTS_TIMEOUT": EMAIL_TIMEOUT}


def production_problems(*, email_provider, from_email, site_url):
    """What's wrong with a production configuration, as sentences (empty when fine)."""
    problems = []
    if not email_provider:
        problems.append('set EMAIL_PROVIDER (resend, postmark, or "console" to send no email)')
    elif email_provider != "console" and "localhost" in from_email:
        problems.append("set DEFAULT_FROM_EMAIL to a real sender address")
    if "localhost" in site_url:
        problems.append("set SITE_URL to the site's public address (links in emails use it)")
    return problems
