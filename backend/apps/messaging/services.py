"""Coach–athlete messages: sending, reading, and the recent part of a thread. Views and
(from sub-project 2) the API call these; they hold the rules."""

from django.utils import timezone

from apps.dashboard import alerts

from .models import Message, Thread

MAX_BODY = 4000
SHOWN = 100  # most recent messages shown


class EmptyMessage(Exception):
    """Nothing to send once the whitespace is gone."""


class NotInThread(Exception):
    """Only the thread's coach and athlete can write in it."""


def participants(thread):
    return {thread.coach.user_id, thread.athlete.user_id}


def send(thread, sender, body):
    """A message from the thread's coach or athlete. Alerts the other side."""
    if sender.pk not in participants(thread):
        raise NotInThread()
    body = (body or "").strip()
    if not body:
        raise EmptyMessage()
    if len(body) > MAX_BODY:
        raise ValueError(f"Messages are at most {MAX_BODY} characters.")
    message = Message.objects.create(thread=thread, sender=sender, body=body)
    alerts.message_sent(message)
    return message


def mark_read(thread, reader):
    """The reader has seen the other side's messages. For the coach this also clears the
    thread's item in their attention feed. Returns how many were newly marked."""
    unread = thread.unread_for(reader)
    count = unread.update(read_at=timezone.now())
    if count and reader.pk == thread.coach.user_id:
        alerts.thread_read(thread)
    return count


def recent(thread, limit=SHOWN):
    """The last `limit` messages, oldest first."""
    return list(thread.messages.select_related("sender").order_by("-sent_at", "-id")[:limit])[::-1]


def thread_for(athlete):
    return Thread.for_athlete(athlete)


def unread_count(athlete):
    """Messages from the athlete's current coach they haven't read yet."""
    return (
        Message.objects.filter(thread__athlete=athlete, thread__coach=athlete.coach, read_at__isnull=True)
        .exclude(sender=athlete.user)
        .count()
    )
