"""A coach's messages with one athlete (/api/v1/athletes/{id}/messages). The athlete's side
reaches their phone through sync (sub-project 3). Reading is a GET that writes nothing;
marking read is its own POST (audit M20)."""

import datetime
import uuid

from django.db.models import Count, F, Max, OuterRef, Q, Subquery
from ninja import Router, Schema, Status

from apps.accounts import coaching
from apps.accounts.models import CoachingStatus
from apps.api.main import coach_of, limit
from apps.api.pagination import page
from apps.api.schemas import AthleteRef, athlete_ref

from . import services
from .models import Message, Thread

router = Router(tags=["Messages"])


class MessageOut(Schema):
    id: uuid.UUID
    sender: str  # "coach" or "athlete"
    body: str
    sent_at: datetime.datetime
    read: bool


class MessagesOut(Schema):
    items: list[MessageOut]  # newest first
    next: str | None


class MessageIn(Schema):
    body: str


class Marked(Schema):
    marked: int


class ThreadRow(Schema):
    athlete: AthleteRef
    last_body: str
    last_at: datetime.datetime
    last_from: str  # athlete or coach
    unread: int  # the athlete's messages the coach hasn't read


@router.get("/threads", response=list[ThreadRow])
def threads(request):
    """The coach's conversations with their current athletes that have messages, the latest
    first, with how many of the athlete's are unread. A fixed number of queries."""
    coach = coach_of(request)
    last = Message.objects.filter(thread=OuterRef("pk")).order_by("-sent_at", "-id")
    rows = (
        Thread.objects.filter(coaching__coach=coach, coaching__status=CoachingStatus.ACTIVE)
        .select_related("athlete__user")
        .annotate(
            last_at=Max("messages__sent_at"),
            unread=Count(
                "messages",
                filter=Q(messages__read_at__isnull=True, messages__sender=F("athlete__user")),
            ),
            last_body=Subquery(last.values("body")[:1]),
            last_sender=Subquery(last.values("sender_id")[:1]),
        )
        .filter(last_at__isnull=False)
        .order_by("-last_at", "id")
    )
    return [
        {
            "athlete": athlete_ref(t.athlete),
            "last_body": t.last_body,
            "last_at": t.last_at,
            "last_from": "athlete" if t.last_sender == t.athlete.user_id else "coach",
            "unread": t.unread,
        }
        for t in rows
    ]


def _athlete(request, athlete_id):
    coach = coach_of(request)
    return coach, coaching.athlete_for(coach, athlete_id)


def _message(m, athlete):
    return {
        "id": m.pk,
        "sender": "athlete" if m.sender_id == athlete.user_id else "coach",
        "body": m.body,
        "sent_at": m.sent_at,
        "read": m.read_at is not None,
    }


@router.get("/athletes/{athlete_id}/messages", response=MessagesOut)
def messages(request, athlete_id: uuid.UUID, before: str = "", limit: int = 50):
    coach, athlete = _athlete(request, athlete_id)
    thread = Thread.objects.filter(coaching=coaching.link_for(coach, athlete)).first()
    if thread is None:
        return {"items": [], "next": None}
    rows, cursor = page(thread.messages.all(), before, limit, field="sent_at")
    return {"items": [_message(m, athlete) for m in rows], "next": cursor}


@router.post("/athletes/{athlete_id}/messages", response={201: MessageOut})
def send(request, athlete_id: uuid.UUID, data: MessageIn):
    _coach, athlete = _athlete(request, athlete_id)
    limit(request, "messages", 30, 60, key=request.user.pk)
    message = services.send(Thread.for_athlete(athlete), request.user, data.body)
    return Status(201, _message(message, athlete))


@router.post("/athletes/{athlete_id}/messages/read", response=Marked)
def mark_read(request, athlete_id: uuid.UUID):
    """The coach has seen the athlete's messages; clears the thread from their feed."""
    coach, athlete = _athlete(request, athlete_id)
    thread = Thread.objects.filter(coaching=coaching.link_for(coach, athlete)).first()
    return {"marked": services.mark_read(thread, request.user) if thread else 0}
