import datetime
from decimal import Decimal

from django import forms

from apps.accounts import units
from apps.accounts.forms import InputClassMixin

from . import dose
from .dose import MAX_SETS
from .models import LoadBasis, WeekType
from .prescriptions import parse_rir, rir_text


class StartProgramForm(InputClassMixin, forms.Form):
    name = forms.CharField(
        max_length=80,
        label="Block name",
        widget=forms.TextInput(attrs={"placeholder": "e.g. Accumulation Block"}),
    )
    first_day = forms.DateField(label="Starts the week of", widget=forms.DateInput(attrs={"type": "date"}))
    weeks = forms.IntegerField(min_value=1, max_value=52, initial=4, label="Weeks")
    week_type = forms.ModelChoiceField(queryset=WeekType.objects.none(), empty_label=None, label="Week type")

    def __init__(self, *args, gym, today, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["week_type"].queryset = WeekType.objects.active().filter(gym=gym)
        self.fields["first_day"].initial = gym.week_start_for(today)
        start = gym.get_week_start_display()
        end = (datetime.date(2024, 1, 1) + datetime.timedelta(days=gym.week_start + 6)).strftime("%A")
        self.fields["first_day"].help_text = f"Weeks run {start}–{end}; any day in the first week works."


class PrescriptionForm(InputClassMixin, forms.Form):
    """Sets, rep scheme, load, RIR, note, custom fields and optional per-set overrides,
    plus where the item sits in its session (warm-up, section heading, superset).
    Weights are entered in `unit` and stored in kg."""

    sets = forms.IntegerField(min_value=1, max_value=MAX_SETS)
    rep_scheme = forms.CharField(
        max_length=60, required=False, label="Reps", help_text="e.g. 5, 10-12, 1+1, 8/leg, 10 min, AMRAP"
    )
    load_basis = forms.ChoiceField(choices=LoadBasis.choices, label="Load basis")
    load_value = forms.CharField(required=False, label="Load")
    rir = forms.CharField(required=False, max_length=10, label="RIR target")
    warmup = forms.BooleanField(required=False, label="Warm-up drill")
    section = forms.CharField(required=False, max_length=40, label="Section heading above this")
    section_note = forms.CharField(required=False, max_length=200, label="Section note")
    superset = forms.BooleanField(required=False, label="Superset with the exercise above")
    note = forms.CharField(
        required=False,
        max_length=500,
        label="Note to athlete",
        widget=forms.Textarea(attrs={"rows": 2, "placeholder": "e.g. pause 2s in the catch"}),
    )
    vary = forms.BooleanField(required=False, label="Vary by set")

    def __init__(self, *args, unit, **kwargs):
        super().__init__(*args, **kwargs)
        self.unit = unit

    @classmethod
    def initial_for(cls, rx, unit):
        value = rx.load_value
        if value is not None and rx.load_basis == LoadBasis.WEIGHT:
            value = units.from_kg(value, unit)
        return {
            "sets": rx.sets,
            "rep_scheme": rx.rep_scheme,
            "load_basis": rx.load_basis,
            "load_value": format(Decimal(value).normalize(), "f") if value is not None else "",
            "rir": rir_text(rx.rir, rx.rir_max),
            "note": rx.note,
            "vary": rx.set_overrides.exists(),
            "warmup": rx.warmup,
            "section": rx.section,
            "section_note": rx.section_note,
            "superset": rx.superset,
        }

    def clean_rir(self):
        try:
            parse_rir(self.cleaned_data.get("rir"))
        except ValueError as err:
            raise forms.ValidationError("Enter a number (2) or a range (1-2), up to 10.") from err
        return self.cleaned_data.get("rir")

    def clean(self):
        """The field checks above give per-field messages on the page; the dose rules
        themselves are in apps/programs/dose.py, shared with the API."""
        data = super().clean()
        if self.errors:
            return data
        raw = {
            **data,
            "custom_fields": [
                {"key": k, "value": v}
                for k, v in zip(self.data.getlist("cf_key"), self.data.getlist("cf_value"), strict=False)
            ],
            "set_rows": [
                {"reps": r, "load": v}
                for r, v in zip(self.data.getlist("set_reps"), self.data.getlist("set_load"), strict=False)
            ],
        }
        if data.get("vary") and (len(self.data.getlist("set_reps")) != len(self.data.getlist("set_load"))):
            raw["set_rows"] = []  # a mismatched pair of lists is never a full set of rows
        try:
            self.dose = dose.validate(raw, self.unit)
        except dose.InvalidDose as err:
            for field, message in err.errors.items():
                self.add_error(field, message)
        return data

    def save(self, rx):
        return dose.apply(rx, self.dose)


def set_rows_initial(rx, unit):
    """Rows for the 'vary by set' editor: saved overrides, else one per set from the parent."""
    rows = []
    overrides = {s.set_number: s for s in rx.set_overrides.all()}
    # Saved overrides count as edited, so they aren't overwritten by the parent fields.
    for n in range(1, rx.sets + 1):
        s = overrides.get(n)
        value = s.load_value if s and s.load_value is not None else rx.load_value
        if value is not None and rx.load_basis == LoadBasis.WEIGHT:
            value = units.from_kg(value, unit)
        rows.append(
            {
                "reps": (s.rep_scheme if s else "") or rx.rep_scheme,
                "load": format(Decimal(value).normalize(), "f") if value is not None else "",
                "edited": s is not None,
            }
        )
    return rows
