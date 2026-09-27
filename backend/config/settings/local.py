import warnings

from .base import *  # noqa: F403

DEBUG = True
# The Expo web dev server, and the export served by `npm run serve:web`.
CORS_ALLOWED_ORIGINS = CORS_ALLOWED_ORIGINS or ["http://localhost:8081", "http://localhost:8082"]  # noqa: F405
# Seeded demo users (make seed) sign in with this code; codes print to the console.
DEMO_SIGNIN_CODE = "123456"
SECRET_KEY = SECRET_KEY or "local-dev-only-not-secret"  # noqa: F405
# Any host: a phone in Expo Go reaches `make run-lan` by the computer's network address.
ALLOWED_HOSTS = ["*"]
STORAGES["staticfiles"] = {  # noqa: F405
    "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
}

# WhiteNoise warns that STATIC_ROOT does not exist; in development runserver serves static files itself.
warnings.filterwarnings("ignore", message="No directory at", module="whitenoise.base")

# Form videos go to the MinIO container from docker-compose.yml unless STORAGE_* is set.
if not FORM_VIDEOS["endpoint"]:  # noqa: F405
    FORM_VIDEOS.update(  # noqa: F405
        endpoint="http://localhost:9000",
        bucket="gymtrainer-videos",
        access_key="gymtrainer",
        secret="gymtrainer-local-only",
        region="us-east-1",
    )
