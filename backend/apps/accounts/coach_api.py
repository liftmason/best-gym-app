"""A coach's view of one athlete (profile, archiving, metrics) and their invites. Every
athlete is looked up through the coach (`coaching.athlete_for`), so anyone else's is a 404.
Weights are shown and entered in the gym's unit."""

import datetime
import uuid

from django.conf import settings
from ninja import Router, Schema, Status

from apps.api.main import coach_of, limit
from apps.api.schemas import AthleteRef, athlete_ref
from apps.core import errors

from . import coaching, invites, metrics, services, units

router = Router(tags=["Athletes"])


def _athlete(request, athlete_id):
    coach = coach_of(request)
    return coach, coaching.athlete_for(coach, athlete_id)


class MetricOut(Schema):
    key: str
    label: str
    kind: str  # weight, height, years
    value: str | None  # in the gym's unit for weights
    date: datetime.date | None
    source: str | None


class AthleteOut(Schema):
    athlete: AthleteRef
    email: str
    units: str
    weight_class: str
    competition_name: str
    competition_date: datetime.date | None
    joined_at: datetime.datetime
    max_updates: str
    hide_history_before_link: bool
    metrics: list[MetricOut]
    missing_metrics: list[str]


def _metrics(athlete, unit):
    specs = metrics.metric_specs(athlete.gym)
    current = metrics.current_metrics(athlete, specs)
    rows = []
    for m in specs:
        c = current[m.key]
        value = c["value"]
        if value is not None and m.kind == "weight":
            value = units.display(c["kg"], unit)
        rows.append(
            {
                "key": m.key,
                "label": m.label,
                "kind": m.kind,
                "value": None if value is None else str(value),
                "date": c["date"],
                "source": c["source"],
            }
        )
    return rows


def _athlete_out(athlete, unit):
    return {
        "athlete": athlete_ref(athlete),
        "email": athlete.user.email,
        "units": athlete.units,
        "weight_class": athlete.weight_class,
        "competition_name": athlete.competition_name,
        "competition_date": athlete.competition_date,
        "joined_at": athlete.joined_at,
        "max_updates": athlete.max_updates,
        "hide_history_before_link": athlete.hide_history_before_link,
        "metrics": _metrics(athlete, unit),
        "missing_metrics": metrics.missing_metrics(athlete),
    }


@router.get("/athletes/{athlete_id}", response=AthleteOut)
def athlete(request, athlete_id: uuid.UUID):
    coach, athlete = _athlete(request, athlete_id)
    return _athlete_out(athlete, coach.gym.units)


@router.post("/athletes/{athlete_id}/archive", response={204: None})
def archive(request, athlete_id: uuid.UUID):
    """End the coaching link. The athlete keeps their history and account; they can join a
    coach again through an invite."""
    _coach, athlete = _athlete(request, athlete_id)
    coaching.end(athlete)
    return Status(204, None)


class MaxUpdatesIn(Schema):
    value: str  # "auto" or "approve"


@router.put("/athletes/{athlete_id}/max-updates", response={204: None})
def max_updates(request, athlete_id: uuid.UUID, data: MaxUpdatesIn):
    _coach, athlete = _athlete(request, athlete_id)
    services.set_max_updates(athlete, data.value)
    return Status(204, None)


class MetricIn(Schema):
    value: str
    date: datetime.date | None = None


class HistoryRow(Schema):
    what: str
    value: str
    date: datetime.date
    source: str


class MetricsOut(Schema):
    metrics: list[MetricOut]
    history: list[HistoryRow]


@router.get("/athletes/{athlete_id}/metrics", response=MetricsOut)
def athlete_metrics(request, athlete_id: uuid.UUID):
    coach, athlete = _athlete(request, athlete_id)
    unit = coach.gym.units
    return {
        "metrics": _metrics(athlete, unit),
        "history": [
            {
                "what": what,
                "value": units.display(e.kg, unit),
                "date": e.date,
                "source": e.get_source_display(),
            }
            for what, e in metrics.recent_history(athlete)
        ],
    }


@router.put("/athletes/{athlete_id}/metrics/{key}", response=list[MetricOut])
def set_metric(request, athlete_id: uuid.UUID, key: str, data: MetricIn):
    """Set one metric (weights in the gym's unit, dated; height and years replace)."""
    coach, athlete = _athlete(request, athlete_id)
    metrics.save_coach_metric(athlete, key, data.value, date=data.date, entry_units=coach.gym.units)
    return _metrics(athlete, coach.gym.units)


class Reminded(Schema):
    missing: list[str]


@router.post("/athletes/{athlete_id}/remind-metrics", response=Reminded)
def remind(request, athlete_id: uuid.UUID):
    """Email the athlete about their missing numbers (once a day at most)."""
    _coach, athlete = _athlete(request, athlete_id)
    return {"missing": metrics.remind(athlete, settings.SITE_URL)}


# ---------------------------------------------------------------- invites


class InviteRow(Schema):
    id: uuid.UUID
    email: str
    link: str
    starting_template: str | None
    created_at: datetime.datetime
    expires_at: datetime.datetime


class InviteIn(Schema):
    email: str = ""
    starting_template_id: uuid.UUID | None = None


class InviteCreated(InviteRow):
    email_sent: bool


class TemplateChoice(Schema):
    id: uuid.UUID
    name: str
    kind: str


def _invite_row(invite):
    from .emails import invite_url

    return {
        "id": invite.pk,
        "email": invite.email,
        "link": invite_url(settings.SITE_URL, invite),
        "starting_template": invite.starting_template.display_name if invite.starting_template else None,
        "created_at": invite.created_at,
        "expires_at": invite.expires_at,
    }


@router.get("/invites", response=list[InviteRow], tags=["Invites"])
def pending_invites(request):
    return [_invite_row(i) for i in invites.pending(coach_of(request))]


@router.get("/invites/templates", response=list[TemplateChoice], tags=["Invites"])
def invite_templates(request):
    """What a new athlete can start on: the gym's templates and saved weeks."""
    coach = coach_of(request)
    return [{"id": t.pk, "name": t.display_name, "kind": t.kind} for t in invites.template_choices(coach.gym)]


@router.post("/invites", response={201: InviteCreated}, tags=["Invites"])
def create_invite(request, data: InviteIn):
    """A new invite. With an email the link is sent; `email_sent` false means it failed and
    can be resent (the invite and its link still work)."""
    coach = coach_of(request)
    limit(request, "invites", 30, 3600, key=coach.pk)
    template = None
    if data.starting_template_id:
        template = invites.template_choices(coach.gym).filter(pk=data.starting_template_id).first()
        if template is None:
            raise errors.Invalid({"starting_template_id": "Pick one of your templates or saved weeks."})
    invite = invites.create(coach, data.email, template, base_url=settings.SITE_URL)
    return Status(201, _invite_row(invite) | {"email_sent": invite.email_sent})


@router.post("/invites/{invite_id}/resend", response={204: None}, tags=["Invites"])
def resend_invite(request, invite_id: uuid.UUID):
    coach = coach_of(request)
    invite = next((i for i in invites.pending(coach) if i.pk == invite_id), None)
    if invite is None:
        raise errors.NotFound()
    limit(request, "invites", 30, 3600, key=coach.pk)
    if not invites.send(invite, settings.SITE_URL):
        raise errors.Conflict("The email didn't go. Copy the link and send it yourself, or try again later.")
    return Status(204, None)


@router.post("/invites/{invite_id}/revoke", response={204: None}, tags=["Invites"])
def revoke_invite(request, invite_id: uuid.UUID):
    invites.revoke(coach_of(request), invite_id)
    return Status(204, None)
