"""Rate limits: one counter row per key in `ratelimit.Counter`, shared by every web worker.
Each hit is a single INSERT … ON CONFLICT statement, so parallel requests can't lose counts,
and a window lasts exactly as long as it says (audit C1, C2). Keys are hashed, so any length
of email or address fits. The hourly cron deletes expired rows (`purge`).

The page decorators went with the pages (sub-project 0); the API re-applies the limits listed
in docs/plans/S0_TEST_TRIAGE.md.
"""

import datetime
import hashlib
import uuid

from django.conf import settings
from django.db import connection
from django.utils import timezone


def client_ip(request):
    """Render's proxy appends the address it saw to X-Forwarded-For; the last entry is the
    one a client can't fake. To be confirmed on the live site: with LOG_CLIENT_IP=1 each
    rate-limited request writes its address headers to the log (docs/OPERATIONS.md)."""
    forwarded = request.headers.get("X-Forwarded-For", "")
    if settings.LOG_CLIENT_IP:
        headers = ("X-Forwarded-For", "True-Client-Ip", "Cf-Connecting-Ip", "X-Real-Ip")
        seen = {h: request.headers.get(h, "") for h in headers}
        print(f"client-ip check: {seen} REMOTE_ADDR={request.META.get('REMOTE_ADDR', '')}", flush=True)
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.META.get("REMOTE_ADDR", "")


def _key(name, key):
    return f"{name[:100]}:{hashlib.sha256(str(key).encode()).hexdigest()}"


def hit(name, key, limit, window):
    """Count one attempt; True if it's within `limit` for the window. A window starts at the
    first attempt and lasts `window` seconds; the first attempt after it ends starts anew."""
    from .models import Counter  # this module loads with the app, before its models

    now = timezone.now()
    table = Counter._meta.db_table
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            INSERT INTO {table} (id, key, window_ends_at, count) VALUES (%s, %s, %s, 1)
            ON CONFLICT (key) DO UPDATE SET
                count = CASE WHEN {table}.window_ends_at <= %s THEN 1 ELSE {table}.count + 1 END,
                window_ends_at = CASE WHEN {table}.window_ends_at <= %s
                    THEN EXCLUDED.window_ends_at ELSE {table}.window_ends_at END
            RETURNING count
            """,
            [uuid.uuid7(), _key(name, key), now + datetime.timedelta(seconds=window), now, now],
        )
        count = cursor.fetchone()[0]
    return count <= limit


def purge():
    """Delete counters whose window has ended; returns how many."""
    from .models import Counter

    return Counter.objects.filter(window_ends_at__lte=timezone.now()).delete()[0]


LOGIN_WINDOW = 15 * 60


def login_allowed(ip, email):
    """Sign-in attempts in 15 minutes: 10 per address and email, 50 per address (trying many
    accounts), 30 per email from anywhere (many addresses on one account). Every bucket
    counts the attempt, so none can be skipped."""
    email = (email or "").strip().lower()
    checks = [
        hit("login", f"{ip}:{email}", 10, LOGIN_WINDOW),
        hit("login-ip", ip, 50, LOGIN_WINDOW),
        hit("login-email", email, 30, LOGIN_WINDOW),
    ]
    return all(checks)
