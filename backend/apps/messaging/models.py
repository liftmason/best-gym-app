"""Coach–athlete messages: one thread per coaching link, so a new coach starts a fresh
thread and never sees the previous coach's conversation."""

from django.conf import settings
from django.db import models

from apps.core import models as core


class Thread(core.Model):
    coaching = models.OneToOneField("accounts.Coaching", on_delete=models.PROTECT, related_name="thread")
    athlete = models.ForeignKey("accounts.Athlete", on_delete=models.CASCADE, related_name="threads")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.coach} ↔ {self.athlete}"

    @property
    def coach(self):
        return self.coaching.coach

    @classmethod
    def for_athlete(cls, athlete):
        """The thread with the athlete's current coach (created on first use)."""
        link = athlete.coaching
        return cls.objects.select_related("coaching__coach__user", "athlete__user").get_or_create(
            coaching=link, defaults={"athlete": athlete}
        )[0]

    def unread_for(self, user):
        return self.messages.filter(read_at__isnull=True).exclude(sender=user)


class Message(core.Model):
    thread = models.ForeignKey(Thread, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    body = models.TextField(max_length=4000)
    sent_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["sent_at", "id"]
        indexes = [
            models.Index(
                fields=["thread"], condition=models.Q(read_at__isnull=True), name="unread_messages_by_thread"
            )
        ]

    def __str__(self):
        return f"{self.sender}: {self.body[:40]}"
