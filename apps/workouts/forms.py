
from django import forms

from apps.accounts.forms import InputClassMixin

from .models import IssueKind, IssueReport

RIR_CHOICES = [("", "—"), ("0", "0"), ("1", "1"), ("2", "2"), ("3", "3"), ("4", "4"), ("5", "5+")]


class FinishForm(forms.Form):
    rpe = forms.IntegerField(min_value=1, max_value=10, error_messages={"required": "Pick how hard it was."})
    comment = forms.CharField(required=False, max_length=2000, widget=forms.Textarea)


class IssueForm(InputClassMixin, forms.ModelForm):
    class Meta:
        model = IssueReport
        fields = ["kind", "text"]
        labels = {"kind": "What kind of issue?", "text": "Where / what?"}
        widgets = {
            "text": forms.Textarea(
                attrs={"rows": 3, "placeholder": "e.g. sharp pinch in left wrist at jerk lockout, ~120kg"}
            )
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["kind"].choices = IssueKind.choices
