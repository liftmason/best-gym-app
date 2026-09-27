"""Unit tests run on a frozen clock, so no test depends on the weekday or the date it runs
(audit T1). "Now" is Thursday 24 September 2026 at noon in New York; time still ticks
forward from there, so ordering by creation time keeps working. `still_clock` and
`fixed_ids` make a run exactly repeatable (the parity files in shared/)."""

import datetime
import itertools
import uuid

import pytest
import time_machine
from django.apps import apps as django_apps
from django.utils import timezone

from apps.core.models import Model as BaseModel

FROZEN_NOW = datetime.datetime(2026, 9, 24, 16, 0, tzinfo=datetime.UTC)  # Thu 12:00 in New York


@pytest.fixture(autouse=True)
def frozen_clock():
    with time_machine.travel(FROZEN_NOW, tick=True) as traveller:
        yield traveller


@pytest.fixture
def still_clock(frozen_clock):
    """The frozen time, not ticking: every timestamp the same on every run."""
    with time_machine.travel(timezone.now().replace(microsecond=0), tick=False) as traveller:
        yield traveller


@pytest.fixture
def fixed_ids(monkeypatch):
    """Ids 00000000-0000-7000-8000-000000000001, …: the same on every run."""
    counter = itertools.count(1)

    def next_id():
        return uuid.UUID(f"00000000-0000-7000-8000-{next(counter):012d}")

    monkeypatch.setattr(uuid, "uuid7", next_id)
    for model in django_apps.get_models():
        if issubclass(model, BaseModel):
            field = model._meta.pk
            monkeypatch.setattr(field, "default", next_id)
            field.__dict__.pop("_get_default", None)
