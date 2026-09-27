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


def production_problems(
    *,
    email_provider,
    from_email,
    site_url,
    review_email="",
    review_code="",
    demo_code="",
    billing=False,
    stripe_key="",
    stripe_webhook_secret="",
):
    """What's wrong with a production configuration, as sentences (empty when fine)."""
    problems = []
    if demo_code:
        problems.append("fixed demo sign-in codes are for development only")
    if review_code and (not review_email or not (review_code.isdigit() and len(review_code) == 6)):
        problems.append("REVIEW_ACCOUNT_CODE needs REVIEW_ACCOUNT_EMAIL and six digits")
    if not email_provider:
        problems.append('set EMAIL_PROVIDER (resend, postmark, or "console" to send no email)')
    elif email_provider != "console" and "localhost" in from_email:
        problems.append("set DEFAULT_FROM_EMAIL to a real sender address")
    if billing and not (stripe_key and stripe_webhook_secret):
        problems.append("BILLING_ENABLED needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET")
    if "localhost" in site_url:
        problems.append("set SITE_URL to the site's public address (links in emails use it)")
    return problems
