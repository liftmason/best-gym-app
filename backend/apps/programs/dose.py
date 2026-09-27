"""One exercise's dose: validating what a coach entered and applying it to a prescription or
a template slot. The rules live here, not in a form, so the HTML form today and the API
later check exactly the same things.

`validate(raw, unit)` takes plain values (strings, numbers, booleans, lists) as a form or a
JSON body would carry them, with weights in the coach's `unit`, and returns the model fields
(weights in kg) plus the per-set override rows. It raises `InvalidDose` with messages keyed
by field (`None` for the whole dose). `apply(rx, dose)` writes a validated dose.
"""

from decimal import Decimal, InvalidOperation

from django.db import transaction

from apps.accounts import units

from .models import LoadBasis
from .prescriptions import keep_warmups_first, parse_rep_scheme, parse_rir

MAX_SETS = 20
MAX_CUSTOM_FIELDS = 8
MAX_LENGTHS = {"rep_scheme": 60, "note": 500, "section": 40, "section_note": 200}
LOAD_LIMITS = {
    LoadBasis.PERCENT: (Decimal("1"), Decimal("200"), "a percentage between 1 and 200"),
    LoadBasis.RPE: (Decimal("1"), Decimal("10"), "an RPE between 1 and 10"),
    LoadBasis.WEIGHT: (Decimal("0.5"), Decimal("1000"), "a weight"),
}
# The fields `apply` writes; together with the set overrides they are the whole dose.
FIELDS = [
    "sets",
    "rep_scheme",
    "reps",
    "duration_seconds",
    "load_basis",
    "load_value",
    "rir",
    "rir_max",
    "note",
    "custom_fields",
    "warmup",
    "section",
    "section_note",
    "superset",
]


class InvalidDose(Exception):
    def __init__(self, errors):
        super().__init__(errors)
        self.errors = errors  # {field or None: message}


def _squash(text):
    return " ".join(str(text or "").split())


def _decimal(raw):
    if raw is None or isinstance(raw, Decimal):
        return raw
    text = str(raw).strip()
    if not text:
        return None
    try:
        return Decimal(text)
    except InvalidOperation as err:
        raise ValueError("Enter a number.") from err


def checked_load(basis, raw, unit, where="Load"):
    """A load in stored form (kg for a weight; the number for % and RPE), or None for a basis
    without one. ValueError with the message to show when it's missing or out of range."""
    value = _decimal(raw)
    if basis in (LoadBasis.NONE, LoadBasis.BODYWEIGHT):
        return None
    if value is None:
        raise ValueError(f"{where}: enter {LOAD_LIMITS[basis][2]}.")
    low, high, what = LOAD_LIMITS[basis]
    if not low <= value <= high:
        raise ValueError(f"{where}: enter {what}.")
    return units.to_kg(value, unit) if basis == LoadBasis.WEIGHT else value


def validate(raw, unit):
    """The dose to save, or InvalidDose. Keys of `raw`: sets, rep_scheme, load_basis,
    load_value, rir ("2" or "1-2"), note, warmup, section, section_note, superset,
    custom_fields [{key, value}], vary, set_rows [{reps, load}] (one per set when vary)."""
    try:
        sets = int(raw.get("sets"))
    except TypeError, ValueError:
        raise InvalidDose({"sets": "Enter a whole number of sets."}) from None
    if not 1 <= sets <= MAX_SETS:
        raise InvalidDose({"sets": f"Between 1 and {MAX_SETS} sets."})
    basis = raw.get("load_basis") or LoadBasis.NONE
    if basis not in LoadBasis.values:
        raise InvalidDose({"load_basis": "Pick a load basis."})
    for name, limit in MAX_LENGTHS.items():
        if len(str(raw.get(name) or "")) > limit:
            raise InvalidDose({name: f"Keep it to {limit} characters."})
    try:
        rir, rir_max = parse_rir(raw.get("rir"))
    except ValueError:
        raise InvalidDose({"rir": "Enter a number (2) or a range (1-2), up to 10."}) from None

    dose = {
        "sets": sets,
        "load_basis": basis,
        "rir": rir,
        "rir_max": rir_max,
        "note": str(raw.get("note") or "").strip(),
        "warmup": bool(raw.get("warmup")),
        "section": _squash(raw.get("section")),
        "section_note": _squash(raw.get("section_note")),
        "superset": bool(raw.get("superset")),
    }
    vary = bool(raw.get("vary"))
    if dose["warmup"]:
        # A warm-up drill is ticked off once: no sets, load or RIR, and it isn't in a section.
        dose.update(sets=1, load_basis=LoadBasis.NONE, rir=None, rir_max=None)
        dose.update(section="", section_note="", superset=False)
        vary = False

    try:
        dose["load_value"] = checked_load(dose["load_basis"], raw.get("load_value"), unit)
    except ValueError as err:
        raise InvalidDose({"load_value": str(err)}) from None

    dose["rep_scheme"] = _squash(raw.get("rep_scheme"))
    dose["reps"], dose["duration_seconds"] = parse_rep_scheme(dose["rep_scheme"])

    custom = []
    for field in raw.get("custom_fields") or []:
        key, value = _squash(field.get("key"))[:30], _squash(field.get("value"))[:60]
        if key:
            custom.append({"key": key, "value": value})
    if len(custom) > MAX_CUSTOM_FIELDS:
        raise InvalidDose({None: f"Keep it to {MAX_CUSTOM_FIELDS} custom fields."})
    dose["custom_fields"] = custom

    dose["set_rows"] = []
    if vary:
        rows = raw.get("set_rows") or []
        if len(rows) != dose["sets"]:
            raise InvalidDose({None: "Fill in a row for every set."})
        for i, row in enumerate(rows, start=1):
            reps_text = _squash(row.get("reps"))[:30]
            load_raw = str(row.get("load") or "").strip()
            try:
                load = (
                    checked_load(dose["load_basis"], load_raw, unit, where=f"Set {i}") if load_raw else None
                )
            except ValueError as err:
                raise InvalidDose({None: str(err)}) from None
            dose["set_rows"].append(
                {
                    "set_number": i,
                    "rep_scheme": reps_text,
                    "reps": parse_rep_scheme(reps_text or dose["rep_scheme"])[0],
                    "load_value": load,
                }
            )
    return dose


@transaction.atomic
def apply(rx, dose):
    """Write a validated dose to a Prescription or a TemplateSlot, replacing its per-set
    overrides, and keep the session's warm-ups first."""
    for field in FIELDS:
        setattr(rx, field, dose[field])
    rx.save()
    keep_warmups_first(rx.session)
    rx.set_overrides.all().delete()
    model, parent = rx.set_overrides.model, rx.set_overrides.field.name
    model.objects.bulk_create([model(**{parent: rx}, **row) for row in dose["set_rows"]])
    return rx
