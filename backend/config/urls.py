"""The backend's URLs: the JSON API at /api/v1/ (apps/api/main.py) and the Django admin.
/healthz is answered by HealthCheckMiddleware."""

from django.conf import settings
from django.contrib import admin
from django.urls import path

from apps.accounts.admin_login import admin_login
from apps.api.main import api

urlpatterns = [
    path("api/v1/", api.urls),
    # The admin's sign-in, rate-limited; listed first so it wins over the admin's own.
    path(f"{settings.ADMIN_PATH}login/", admin_login),
    path(settings.ADMIN_PATH, admin.site.urls),
]
