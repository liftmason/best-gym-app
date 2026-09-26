"""Unit tests run on a frozen clock, so no test depends on the weekday or the date it runs
(audit T1). "Now" is Thursday 24 September 2026 at noon in New York; time still ticks
forward from there, so ordering by creation time keeps working."""

import datetime

import pytest
import time_machine

FROZEN_NOW = datetime.datetime(2026, 9, 24, 16, 0, tzinfo=datetime.UTC)  # Thu 12:00 in New York


@pytest.fixture(autouse=True)
def frozen_clock():
    with time_machine.travel(FROZEN_NOW, tick=True) as traveller:
        yield traveller
