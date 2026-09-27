"""The backend's URLs. The API arrives in sub-project 2 (docs/EXPO_MIGRATION.md); until then
only the Django admin is served. /healthz is answered by HealthCheckMiddleware."""

from django.conf import settings
from django.contrib import admin
from django.urls import path

from apps.accounts.admin_login import admin_login

urlpatterns = [
    # The admin's sign-in, rate-limited; listed first so it wins over the admin's own.
    path(f"{settings.ADMIN_PATH}login/", admin_login),
    path(settings.ADMIN_PATH, admin.site.urls),
]
