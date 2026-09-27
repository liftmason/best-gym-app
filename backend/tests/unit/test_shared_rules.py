"""The rules the phone runs offline (e1RM, plate rounding, suggested loads) against the
cases in shared/rules-cases.json, which the app's tests run too (docs/EXPO_MIGRATION.md,
"Shared rules")."""

import json
import pathlib
from decimal import Decimal
from types import SimpleNamespace

import pytest

from apps.workouts import history, sessions

CASES = json.loads((pathlib.Path(__file__).resolve().parents[3] / "shared" / "rules-cases.json").read_text())


def _text(value):
    return None if value is None else format(value, "f")


@pytest.mark.parametrize("case", CASES["e1rm"])
def test_e1rm(case):
    assert _text(history.e1rm(Decimal(case["load_kg"]), case["reps"])) == case["expected"]


@pytest.mark.parametrize("case", CASES["plate_round"])
def test_plate_round(case):
    assert _text(sessions.plate_round(Decimal(case["kg"]), case["unit"])) == case["expected"]


@pytest.mark.parametrize("case", CASES["suggested_load"])
def test_suggested_load(case):
    p = SimpleNamespace(load_basis=case["basis"], max_kg=Decimal(case["max_kg"]) if case["max_kg"] else None)
    assert _text(sessions.suggested_load(p, Decimal(case["value"]), case["unit"])) == case["expected"]
