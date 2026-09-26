"""The "Report a bug" button in both headers. Reports go to the Django admin for now
(dashboard.BugReport); the page, browser and screen size come along automatically."""

from django import forms
from django.contrib.auth.decorators import login_required
from django.http import HttpResponse
from django.template.response import TemplateResponse

from apps import hx
from apps.ratelimit import by_user, rate_limit

from . import bugs


class BugForm(forms.Form):
    description = forms.CharField(
        max_length=4000,
        label="What went wrong?",
        widget=forms.Textarea(
            attrs={"rows": 5, "placeholder": "What you did, what you expected, and what happened instead."}
        ),
        error_messages={"required": "Describe the problem first."},
    )
    page = forms.CharField(max_length=500, required=False, widget=forms.HiddenInput)
    screen = forms.CharField(max_length=40, required=False, widget=forms.HiddenInput)


@login_required
@rate_limit("bug", 20, 60 * 60, key=by_user)
def bug_report(request):
    side = bugs.side_for(request.user, request.GET.get("side") or request.POST.get("side"))
    if request.method == "POST":
        form = BugForm(request.POST)
        if form.is_valid():
            data = form.cleaned_data
            bugs.report(
                request.user,
                description=data["description"],
                side=side,
                page=data["page"],
                screen=data["screen"],
                user_agent=request.headers.get("User-Agent", ""),
            )
            response = hx.toast(HttpResponse(""), "Thanks — your bug report was sent", "good")
            return hx.trigger_after_swap(response, closeModal=True)
    else:
        # HTMX sends the page the button was pressed on; a plain request has the Referer.
        page = (request.htmx.current_url if request.htmx else "") or request.headers.get("Referer", "")
        form = BugForm(initial={"page": page[:500]})
    return TemplateResponse(request, "partials/bug_modal.html", {"form": form, "side": side})
