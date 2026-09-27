"""The signed-in person's own account (/api/v1/me/...): name and time zone, and for an
athlete their units, whether a new coach sees earlier history, and filling in the numbers
their coach asked for. Training data itself reaches the phone through sync (S3)."""

from ninja import Router, Schema, Status

from apps.api.main import athlete_of

from . import metrics, services, units

router = Router(tags=["My account"])


class UnitsIn(Schema):
    units: str  # kg, lb


@router.put("/me/units", response={204: None})
def set_units(request, data: UnitsIn):
    services.set_units(athlete_of(request), data.units)
    return Status(204, None)


class HistoryIn(Schema):
    hide: bool


@router.put("/me/history-visibility", response={204: None})
def history_visibility(request, data: HistoryIn):
    """Hide training from before a coach's link from that coach (a new coach sees it all
    by default)."""
    services.set_hide_history(athlete_of(request), data.hide)
    return Status(204, None)


class MyMetric(Schema):
    key: str
    label: str
    kind: str  # weight, height, years
    value: str | None  # weights in the athlete's unit
    missing: bool


class MetricsIn(Schema):
    values: dict[str, str]  # key -> value (weights in the athlete's unit)


class Filled(Schema):
    filled: list[str]


def _mine(athlete):
    specs = metrics.metric_specs(athlete.gym)
    current = metrics.current_metrics(athlete, specs)
    rows = []
    for m in specs:
        c = current[m.key]
        value = c["value"]
        if value is not None and m.kind == "weight":
            value = units.display(c["kg"], athlete.units)
        rows.append(
            {
                "key": m.key,
                "label": m.label,
                "kind": m.kind,
                "value": None if value is None else str(value),
                "missing": value in (None, ""),
            }
        )
    return rows


@router.get("/me/metrics", response=list[MyMetric])
def my_metrics(request):
    return _mine(athlete_of(request))


@router.post("/me/metrics", response=Filled)
def fill_metrics(request, data: MetricsIn):
    """Fill in numbers that are still missing (ones already there are left alone)."""
    # save_missing takes weights in the athlete's own unit and converts them itself.
    return {"filled": metrics.save_missing(athlete_of(request), dict(data.values))}
