"""Small shapes several endpoints share."""

import uuid

from ninja import Schema


class AthleteRef(Schema):
    id: uuid.UUID
    name: str


class WeekTypeRef(Schema):
    id: uuid.UUID
    name: str
    colour: str


def athlete_ref(athlete):
    return {"id": athlete.pk, "name": athlete.user.name or athlete.user.email}


def week_type_ref(week_type):
    return {"id": week_type.pk, "name": week_type.name, "colour": week_type.colour} if week_type else None
