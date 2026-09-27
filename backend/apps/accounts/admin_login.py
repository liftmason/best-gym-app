"""The Django admin's sign-in, under the same limits as every sign-in (apps/ratelimit.py).
The admin is the one part of the backend with pages; everything else is the API."""

from django.contrib import admin
from django.http import HttpResponse

from apps.ratelimit import client_ip, login_allowed


def admin_login(request, extra_context=None):
    if request.method == "POST" and not login_allowed(client_ip(request), request.POST.get("username", "")):
        return HttpResponse(
            "Too many sign-in attempts. Wait 15 minutes.", status=429, content_type="text/plain"
        )
    return admin.site.login(request, extra_context)
