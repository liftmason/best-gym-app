"""The athlete metrics shown at onboarding, on the coach's Metrics tab, in the
athlete header, and in reminder emails.

Three personal metrics are the same for every gym: bodyweight, height and years
training. After them come the gym's tracked lifts (Settings › Tracked lifts), in
the gym's order. Bodyweight and lift maxes are dated history rows; height and
years training are plain fields on the athlete. Weights arrive in someone's unit
and are stored in kg.

A lift metric's key is "lift_<exercise id>", so forms, URLs and saved data all
refer to the gym's own exercises rather than to fixed names.
"""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from django.db import transaction

from apps.core import errors
from apps.exercises.models import Exercise, tracked_exercises

from . import units
from .models import BodyweightEntry, MaxEntry, MeasurementSource, YearsTraining

LIFT_PREFIX = "lift_"
# (lowest, highest, decimal places) a metric accepts, in the unit it's entered in.
LIMITS = {
    "bodyweight": (Decimal("20"), Decimal("600"), 2),
    "height_cm": (Decimal("100"), Decimal("250"), 1),
    "lift": (Decimal("1"), Decimal("1000"), 2),
}


class InvalidMetric(errors.Invalid):
    """With the message to show."""


class MetricUnknown(errors.NotFound):
    """Not one of this gym's metrics (e.g. a lift it doesn't track)."""


@dataclass(frozen=True)
class Metric:
    key: str
    label: str
    kind: str  # "weight", "height" or "years"
    exercise: Exercise | None = None


def lift_key(exercise):
    return f"{LIFT_PREFIX}{exercise.pk}"


def metric_specs(gym):
    lifts = [Metric(lift_key(e), f"{e.name} 1RM", "weight", e) for e in tracked_exercises(gym)]
    return [
        Metric("bodyweight", "Bodyweight", "weight"),
        Metric("height_cm", "Height", "height"),
        *lifts,
        Metric("years_training", "Years training", "years"),
    ]


def spec_for(gym, key):
    return next((m for m in metric_specs(gym) if m.key == key), None)


def current_metrics(athlete, specs=None):
    """{key: {"value", "kg", "date", "source"}} for every metric; value None means not provided."""
    specs = specs or metric_specs(athlete.gym)
    maxes = athlete.current_maxes()  # {exercise_id: MaxEntry}
    result = {}
    for m in specs:
        if m.key == "bodyweight":
            result[m.key] = _entry(athlete.current_bodyweight())
        elif m.key == "height_cm":
            result[m.key] = {"value": athlete.height_cm, "kg": None, "date": None, "source": None}
        elif m.key == "years_training":
            value = athlete.get_years_training_display() if athlete.years_training else None
            result[m.key] = {"value": value, "kg": None, "date": None, "source": None}
        else:
            result[m.key] = _entry(maxes.get(m.exercise.pk))
    return result


def _entry(row):
    if row is None:
        return {"value": None, "kg": None, "date": None, "source": None}
    return {"value": row.kg, "kg": row.kg, "date": row.date, "source": row.get_source_display()}


def missing_metrics(athlete, specs=None):
    specs = specs or metric_specs(athlete.gym)
    current = current_metrics(athlete, specs)
    return [m.key for m in specs if current[m.key]["value"] in (None, "")]


@transaction.atomic
def save_metrics(athlete, data, source, date=None, entry_units=None):
    """Save whichever metrics in `data` are present (not None/blank). Keys are metric
    keys; lift keys must name a tracked lift of the athlete's gym, others are ignored.
    Weights are in `entry_units` (default: the athlete's own unit)."""
    date = date or athlete.today()
    entry_units = entry_units or athlete.units
    if data.get("bodyweight") is not None:
        BodyweightEntry.objects.create(
            athlete=athlete, date=date, kg=units.to_kg(data["bodyweight"], entry_units), source=source
        )
    for m in metric_specs(athlete.gym):
        if m.exercise is not None and data.get(m.key) is not None:
            MaxEntry.objects.create(
                athlete=athlete,
                exercise=m.exercise,
                date=date,
                kg=units.to_kg(data[m.key], entry_units),
                reps=1,
                source=source,
            )
    changed = []
    if data.get("height_cm") is not None:
        athlete.height_cm = data["height_cm"]
        changed.append("height_cm")
    if data.get("years_training"):
        athlete.years_training = data["years_training"]
        changed.append("years_training")
    if changed:
        athlete.save(update_fields=changed)


def limits_for(spec):
    return LIMITS["lift" if spec.exercise is not None else spec.key]


def clean_value(spec, raw):
    """A metric value as entered (a number, or a years-training choice), checked against the
    metric's limits. None for blank (not provided)."""
    if raw is None or str(raw).strip() == "":
        return None
    if spec.kind == "years":
        if raw not in YearsTraining.values:
            raise InvalidMetric("Pick how long they've been training.")
        return raw
    try:
        value = Decimal(str(raw).strip())
    except InvalidOperation:
        raise InvalidMetric("Enter a number.") from None
    low, high, places = limits_for(spec)
    if not low <= value <= high:
        raise InvalidMetric(f"{spec.label}: enter a value between {low} and {high}.")
    if -value.as_tuple().exponent > places:
        raise InvalidMetric(f"{spec.label}: at most {places} decimal place{'s' if places != 1 else ''}.")
    return value


def validate(gym, data):
    """{key: value} checked for every metric of the gym present in `data`; unknown keys are
    ignored. Raises InvalidMetric naming the first bad one."""
    cleaned = {}
    for spec in metric_specs(gym):
        if spec.key in data:
            cleaned[spec.key] = clean_value(spec, data[spec.key])
    return cleaned


def save_coach_metric(athlete, key, raw, date=None, entry_units=None):
    """The coach sets one metric. Weights are dated history (no future dates, default today)
    in `entry_units` (the gym's unit); height and years just replace the value."""
    spec = spec_for(athlete.gym, key)
    if spec is None:
        raise MetricUnknown(key)
    value = clean_value(spec, raw)
    if value is None:
        raise InvalidMetric(f"Enter {spec.label.lower()}.")
    if spec.kind == "weight":
        date = date or athlete.today()
        if date > athlete.today():
            raise InvalidMetric("That date is in the future.")
    else:
        date = None
    save_metrics(athlete, {key: value}, source=MeasurementSource.COACH, date=date, entry_units=entry_units)
    return spec


class RemindedRecently(errors.TooMany):
    """The athlete was already reminded in the last REMIND_WINDOW."""


REMIND_WINDOW = 24 * 60 * 60  # one reminder email per athlete a day (audit M25)


def remind(athlete, base_url):
    """Email the athlete about their missing metrics; returns the missing keys (nothing is
    sent when everything is filled in). RemindedRecently if they had one in the last day."""
    from apps import ratelimit

    from .emails import send_metrics_reminder

    missing = missing_metrics(athlete)
    if missing:
        if not ratelimit.hit("metrics-remind", athlete.pk, 1, REMIND_WINDOW):
            raise RemindedRecently()
        send_metrics_reminder(base_url, athlete, missing)
    return missing


def save_missing(athlete, data, source=MeasurementSource.ATHLETE):
    """The athlete fills in only what's still missing (where the coach's reminder points).
    Values for metrics they already have are ignored. Returns the keys filled in."""
    missing = missing_metrics(athlete)
    cleaned = validate(athlete.gym, {k: v for k, v in data.items() if k in missing})
    filled = [k for k, v in cleaned.items() if v not in (None, "")]
    save_metrics(athlete, cleaned, source=source)
    return filled


def recent_history(athlete, limit=10):
    """[(what, entry)]: the latest bodyweight and max entries together, newest first."""
    rows = [("Bodyweight", e) for e in athlete.bodyweights.all()[:limit]] + [
        (e.exercise.name, e) for e in athlete.maxes.select_related("exercise")[:limit]
    ]
    return sorted(rows, key=lambda pair: (pair[1].date, pair[1].created_at), reverse=True)[:limit]
