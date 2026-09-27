from django.db import models

from apps.core import models as core


class Counter(core.Model):
    """One rate-limit counter: attempts under `key` (a name and a hash) in the window ending
    at `window_ends_at`. Written only by `ratelimit.hit`, in one statement."""

    key = models.CharField(max_length=200, unique=True)
    window_ends_at = models.DateTimeField()
    count = models.PositiveIntegerField(default=0)

    def __str__(self):
        return f"{self.key}: {self.count}"
