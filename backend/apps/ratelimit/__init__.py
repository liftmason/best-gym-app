"""Rate limits: counters in the database cache, shared by every web worker, in fixed windows.
The page decorators went with the pages (sub-project 0); the API re-applies the limits listed
in docs/plans/S0_TEST_TRIAGE.md, and sub-project 1 moves the counters to their own table
(`ratelimit.Counter`, already in the schema; audit C1, C2).
"""

import time

from django.conf import settings
from django.core.cache import cache


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


def hit(name, key, limit, window):
    """Count one attempt; True if it's within the limit. Fixed windows of `window` seconds."""
    bucket = int(time.time() // window)
    cache_key = f"rl:{name}:{key}:{bucket}"
    try:
        count = cache.incr(cache_key)
    except ValueError:
        cache.add(cache_key, 0, timeout=window + 60)
        count = cache.incr(cache_key)
    return count <= limit


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
