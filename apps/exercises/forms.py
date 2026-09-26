from django import forms

from apps.accounts.forms import InputClassMixin

from . import services
from .models import Category, Exercise


class ExerciseForm(InputClassMixin, forms.ModelForm):
    youtube_url = forms.URLField(
        required=False,
        assume_scheme="https",
        label="YouTube demo link",
        widget=forms.URLInput(attrs={"placeholder": "https://youtube.com/…"}),
    )

    class Meta:
        model = Exercise
        fields = ["name", "category", "measure", "percent_of", "tags", "youtube_url", "cue", "warmup"]
        labels = {
            "percent_of": "Percentages worked from",
            "cue": "Coaching cue shown to athlete",
            "measure": "Measured in",
            "warmup": "Warm-up drill",
        }
        widgets = {
            "name": forms.TextInput(attrs={"placeholder": "e.g. Snatch Pull + Snatch complex"}),
            "cue": forms.Textarea(
                attrs={"rows": 2, "placeholder": "e.g. Push the floor away, bar stays close"}
            ),
            "tags": forms.CheckboxSelectMultiple,
        }

    def __init__(self, *args, gym, **kwargs):
        super().__init__(*args, **kwargs)
        self.gym = gym
        self.fields["category"].queryset = Category.objects.filter(gym=gym)
        self.fields["category"].empty_label = None
        self.fields["tags"].queryset = services.tags_for(gym)
        self.fields[
            "tags"
        ].help_text = "Used for filtering when you program, and for tag-based slots in templates."
        # A percentage is worked from a lift's own max, so only "base" lifts are offered.
        self.fields["percent_of"].queryset = services.percent_of_choices(gym, self.instance)
        self.fields["percent_of"].empty_label = "Its own max (or none)"
        self.fields["percent_of"].help_text = "e.g. Front Squat percentages come from the Back Squat max."

    def clean_name(self):
        try:
            return services.check_exercise_name(self.gym, self.cleaned_data["name"], self.instance)
        except services.InvalidExercise as err:
            raise forms.ValidationError(str(err)) from err

    def clean_percent_of(self):
        try:
            return services.check_percent_of(self.gym, self.instance, self.cleaned_data.get("percent_of"))
        except services.InvalidExercise as err:
            raise forms.ValidationError(str(err)) from err

    def save(self, commit=True):
        data = self.cleaned_data
        return services.save_exercise(
            self.gym,
            exercise=self.instance if self.instance.pk else None,
            name=data["name"],
            category=data["category"],
            measure=data["measure"],
            percent_of=data.get("percent_of"),
            tags=data.get("tags") or [],
            youtube_url=data.get("youtube_url") or "",
            cue=data.get("cue") or "",
            warmup=data.get("warmup", False),
        )


def clean_label(value, max_length, what):
    """Shared rules for category, tag and week type names (exercises/services.clean_label)."""
    try:
        return services.clean_label(value, max_length, what)
    except services.InvalidName as err:
        raise forms.ValidationError(str(err)) from err


class NameForm(forms.Form):
    """Validates one name for a gym-owned, case-insensitively unique model."""

    name = forms.CharField(required=False)

    def __init__(self, *args, model, gym, max_length, what, instance=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.model, self.gym, self.max_length, self.what, self.instance = (
            model,
            gym,
            max_length,
            what,
            instance,
        )

    def clean_name(self):
        try:
            return services.check_name(
                self.model, self.gym, self.cleaned_data.get("name"), self.max_length, self.what, self.instance
            )
        except services.InvalidName as err:
            raise forms.ValidationError(str(err)) from err


save_pending_names = services.save_pending_names
TAG_NAME_LENGTH = services.TAG_NAME_LENGTH
CATEGORY_NAME_LENGTH = services.CATEGORY_NAME_LENGTH
