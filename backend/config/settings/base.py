"""Settings shared by every environment. See docs/BUILD_PLAN.md, "Stack and architecture"."""

import os
from pathlib import Path

import dj_database_url

from . import checks

BASE_DIR = Path(__file__).resolve().parent.parent.parent

SECRET_KEY = os.environ.get("SECRET_KEY", "")
DEBUG = False
ALLOWED_HOSTS = [h.strip() for h in os.environ.get("ALLOWED_HOSTS", "").split(",") if h.strip()]
CSRF_TRUSTED_ORIGINS = [o.strip() for o in os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",") if o.strip()]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.postgres",
    "whitenoise.runserver_nostatic",
    "django.contrib.staticfiles",
    "anymail",
    "corsheaders",
    "apps.core",
    "apps.accounts",
    "apps.exercises",
    "apps.library",
    "apps.programs",
    "apps.workouts",
    "apps.messaging",
    "apps.dashboard",
    "apps.ratelimit",
    "apps.signin",
    "apps.api",
    "apps.billing",
    "apps.sync",
]

MIDDLEWARE = [
    "apps.dashboard.middleware.HealthCheckMiddleware",  # first: see its docstring
    # Outside the rest, so it sees the final response: empty JSON answers become `null`.
    "apps.api.middleware.EmptyJsonIsNullMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

# The product's name, as people see it (docs/OPERATIONS.md, "Naming the app").
# Emails say it with {% app_name %}.
APP_NAME = os.environ.get("APP_NAME") or "Liftmason"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
            "builtins": ["apps.core.templatetags.naming"],
        },
    },
]

# Postgres everywhere, including locally (docker compose up db). No SQLite.
DATABASES = {
    "default": dj_database_url.config(
        env="DATABASE_URL",
        default="postgres://gymtrainer:gymtrainer@localhost:5432/gymtrainer",
        conn_max_age=600,
        conn_health_checks=True,
    )
}

AUTH_USER_MODEL = "accounts.User"
PASSWORD_RESET_TIMEOUT = 60 * 60 * 24  # reset links last one day
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"  # stored in UTC; "today" is computed in the athlete's or gym's zone
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Form videos (athletes' uploads for the coach to check) live in an S3-compatible bucket:
# Cloudflare R2 in production. Uploads go straight from the browser to the bucket with a
# short-lived signed URL. With no STORAGE_* settings the upload button doesn't appear.
FORM_VIDEOS = {
    "endpoint": os.environ.get("STORAGE_ENDPOINT", ""),  # e.g. https://<account id>.r2.cloudflarestorage.com
    "bucket": os.environ.get("STORAGE_BUCKET", ""),
    "access_key": os.environ.get("STORAGE_ACCESS_KEY", ""),
    "secret": os.environ.get("STORAGE_SECRET", ""),
    "region": os.environ.get("STORAGE_REGION", "auto"),
    "max_bytes": 200 * 1024 * 1024,  # about 1–2 minutes of phone video
    "keep_days": 90,  # deleted this long after upload
}


# The site's address for links in emails sent outside a request (the coach digest).
SITE_URL = os.environ.get("SITE_URL", os.environ.get("RENDER_EXTERNAL_URL", "http://localhost:8000")).rstrip(
    "/"
)

# The Django admin's address. Set ADMIN_PATH in production to something not guessable
# (e.g. "manage-7f3k2/"): the default "admin/" is the first place bots try.
ADMIN_PATH = os.environ.get("ADMIN_PATH", "admin/")

# Temporary: log the address headers of rate-limited requests, to confirm which one
# Render's proxy guarantees (apps/ratelimit.client_ip). Turn it off again afterwards.
LOG_CLIENT_IP = os.environ.get("LOG_CLIENT_IP") == "1"
# The header the host's edge sets to the visitor's address, overwriting any a client sent
# (Render: Cf-Connecting-Ip). Blank: the last X-Forwarded-For entry (apps/ratelimit).
CLIENT_IP_HEADER = os.environ.get("CLIENT_IP_HEADER", "").strip()

# seed_demo: the password its new demo users get, and whether the demo coach is an admin.
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "demo-password-123")
DEMO_STAFF = True

# The web app calls the API from its own origin (docs/plans/S2_API.md, decision C): list it
# here, comma-separated. Only /api/ answers cross-origin requests, with credentials so the
# web app's refresh cookie is sent.
CORS_ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("WEB_APP_ORIGINS", "").split(",") if o.strip()]
CORS_URLS_REGEX = r"^/api/.*$"
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = ["authorization", "content-type", "x-client", "x-schema-version"]

# Sign-in codes (apps/signin). The app-review account (App Store, Play) gets a fixed code;
# in development the seeded demo users (@DEMO_EMAIL_DOMAIN) do (local settings).
REVIEW_ACCOUNT_EMAIL = os.environ.get("REVIEW_ACCOUNT_EMAIL", "").strip().lower()
REVIEW_ACCOUNT_CODE = os.environ.get("REVIEW_ACCOUNT_CODE", "").strip()
DEMO_SIGNIN_CODE = ""
DEMO_EMAIL_DOMAIN = "ironridge.example"
# The free test run (docs/plans/S8B_TEST_RUN.md): with no sending domain yet, one shared code
# signs anyone in (six digits, not the demo code). Blank once email is set up.
TEST_SIGNIN_CODE = os.environ.get("TEST_SIGNIN_CODE", "").strip()
# How long an access token lasts. 15 minutes normally; the free test run sets a week, because
# the web app and the API are on different sites there, so the web app can't refresh through
# its cookie and keeps the access token instead.
ACCESS_TOKEN_TTL_MINUTES = int(os.environ.get("ACCESS_TOKEN_TTL_MINUTES") or 15)

# Sign in with Apple and Google: the client ids tokens must be issued to (the iOS bundle id
# and the web Services ID for Apple; the iOS, Android and web client ids for Google),
# comma-separated. Blank turns that provider off.
APPLE_CLIENT_IDS = [c.strip() for c in os.environ.get("APPLE_CLIENT_IDS", "").split(",") if c.strip()]
GOOGLE_CLIENT_IDS = [c.strip() for c in os.environ.get("GOOGLE_CLIENT_IDS", "").split(",") if c.strip()]

# Billing (apps/billing): off, every check passes and no upgrade prompts show. Turning it on
# means setting DEFAULT_PLAN to the plan new gyms get, and the Stripe keys.
BILLING_ENABLED = os.environ.get("BILLING_ENABLED") == "1"
DEFAULT_PLAN = os.environ.get("DEFAULT_PLAN", "unlimited")
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

# The hourly jobs over HTTP (POST /api/v1/ops/cron), for hosts with no cron service: the
# free test run calls it from GitHub Actions (docs/plans/S8B_TEST_RUN.md). Blank turns the
# endpoint off; once Render's cron job runs `manage.py cron`, leave it blank.
CRON_TOKEN = os.environ.get("CRON_TOKEN", "").strip()

# Email: invites, reminders and the digest. EMAIL_PROVIDER is "resend" or "postmark" (with
# EMAIL_API_KEY) to send for real, or blank / "console" to print email instead. Anything
# else stops the site from starting (config/settings/checks.py).
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", f"{APP_NAME} <no-reply@localhost>")
SERVER_EMAIL = DEFAULT_FROM_EMAIL
EMAIL_PROVIDER = os.environ.get("EMAIL_PROVIDER", "").strip().lower()
EMAIL_BACKEND, ANYMAIL = checks.email(EMAIL_PROVIDER, os.environ.get("EMAIL_API_KEY", ""))

# Server errors are emailed to the admin account (when email is set up); Sentry reports
# them too once SENTRY_DSN is set (production settings).
ADMINS = [("Admin", os.environ["ADMIN_EMAIL"])] if os.environ.get("ADMIN_EMAIL") else []

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"line": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "line"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}

# Push notifications (apps/signin/push.py): "expo" sends through Expo's push service; blank
# or "console" logs them. EXPO_ACCESS_TOKEN is only needed if the Expo project turns on
# "enhanced push security".
PUSH_PROVIDER = checks.push(os.environ.get("PUSH_PROVIDER", ""))
EXPO_ACCESS_TOKEN = os.environ.get("EXPO_ACCESS_TOKEN", "")
