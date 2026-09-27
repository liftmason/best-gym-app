from django.db import models

from apps.core import models as core


class Counter(core.Model):
    """One rate-limit counter: attempts under `key` in the window ending at
    `window_ends_at`. Sub-project 1 moves the limiter onto this table (audit C1, C2);
    until then the counts are in the database cache."""

    key = models.CharField(max_length=200, unique=True)
    window_ends_at = models.DateTimeField()
    count = models.PositiveIntegerField(default=0)

    def __str__(self):
        return f"{self.key}: {self.count}"
