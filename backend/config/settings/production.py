from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403

if not SECRET_KEY:  # noqa: F405
    raise ImproperlyConfigured("SECRET_KEY must be set in production")
_problems = checks.production_problems(  # noqa: F405
    email_provider=EMAIL_PROVIDER,  # noqa: F405
    from_email=DEFAULT_FROM_EMAIL,  # noqa: F405
    push_provider=PUSH_PROVIDER,  # noqa: F405
    site_url=SITE_URL,  # noqa: F405
    review_email=REVIEW_ACCOUNT_EMAIL,  # noqa: F405
    review_code=REVIEW_ACCOUNT_CODE,  # noqa: F405
    demo_code=DEMO_SIGNIN_CODE,  # noqa: F405
    billing=BILLING_ENABLED,  # noqa: F405
    stripe_key=STRIPE_SECRET_KEY,  # noqa: F405
    stripe_webhook_secret=STRIPE_WEBHOOK_SECRET,  # noqa: F405
)
if _problems:
    raise ImproperlyConfigured("Production settings: " + "; ".join(_problems))

# Error reporting (audit H9): off until a Sentry project exists and SENTRY_DSN is set.
SENTRY_DSN = os.environ.get("SENTRY_DSN", "")  # noqa: F405
if SENTRY_DSN:
    import sentry_sdk

    sentry_sdk.init(dsn=SENTRY_DSN, send_default_pii=False, traces_sample_rate=0)

DEBUG = False

# Render terminates TLS at its proxy.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_CONTENT_TYPE_NOSNIFF = True

# Render's own hostname is always allowed alongside anything in ALLOWED_HOSTS.
_render_host = os.environ.get("RENDER_EXTERNAL_HOSTNAME")  # noqa: F405
if _render_host:
    ALLOWED_HOSTS.append(_render_host)  # noqa: F405
    CSRF_TRUSTED_ORIGINS.append(f"https://{_render_host}")  # noqa: F405

# A demo site on a public URL (the free-tier trial) must not use the published demo
# password, and its demo coach is not an admin. seed_demo refuses to run without one.
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "")  # noqa: F405
DEMO_STAFF = False

# HSTS preload is hard to undo and needs a real domain first; revisit when one is bought.
SILENCED_SYSTEM_CHECKS = ["security.W021"]
