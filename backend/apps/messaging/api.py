"""A coach's messages with one athlete (/api/v1/athletes/{id}/messages). The athlete's side
reaches their phone through sync (sub-project 3). Reading is a GET that writes nothing;
marking read is its own POST (audit M20)."""

import datetime
import uuid

from ninja import Router, Schema, Status

from apps.accounts import coaching
from apps.api.main import coach_of, limit
from apps.api.pagination import page

from . import services
from .models import Thread

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
