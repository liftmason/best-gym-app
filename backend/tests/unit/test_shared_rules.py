"""The rules the phone runs offline (e1RM, plate rounding, suggested loads) against the
cases in shared/rules-cases.json, which the app's tests run too (docs/EXPO_MIGRATION.md,
"Shared rules")."""

import json
import pathlib
import re
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


@pytest.mark.parametrize("case", CASES["clean_answer"])
def test_clean_answer(case):
    from apps.workouts import checkins

    question = SimpleNamespace(**case["question"])
    if "error" in case:
        with pytest.raises(checkins.InvalidAnswer, match=case["error"]):
            checkins.clean_answer(question, case["value"], case["other"])
    else:
        assert list(checkins.clean_answer(question, case["value"], case["other"])) == case["expected"]


@pytest.mark.parametrize("case", CASES["checked_number"])
def test_checked_number(case):
    limit = Decimal(case["limit"]) if isinstance(case["limit"], str) else case["limit"]
    check = lambda: sessions._number(case["value"], "Reps", limit, whole=case["whole"])  # noqa: E731
    if "error" in case:
        with pytest.raises(sessions.InvalidSet, match=case["error"]):
            check()
        return
    result = check()
    if case["whole"]:
        assert result == (int(case["expected"]) if case["expected"] is not None else None)
    else:
        assert _text(result) == case["expected"]


@pytest.mark.parametrize("case", CASES["clean_metric"])
def test_clean_metric(case):
    from apps.accounts import metrics

    spec = case["spec"]
    m = metrics.Metric(spec["key"], spec["label"], spec["kind"], SimpleNamespace() if spec["lift"] else None)
    if "error" in case:
        with pytest.raises(metrics.InvalidMetric, match=re.escape(case["error"])):
            metrics.clean_value(m, case["raw"])
        return
    result = metrics.clean_value(m, case["raw"])
    assert (format(result, "f") if isinstance(result, Decimal) else result) == case["expected"]
