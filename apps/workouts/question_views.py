"""The check-in question builder. One set of endpoints serves two owners:
the gym's defaults (/coach/questions/…) and one athlete's own copy
(/coach/athletes/<pk>/questions/…). Every endpoint re-renders the builder."""

from django.http import Http404, HttpResponse
from django.template.response import TemplateResponse
from django.urls import reverse
from django.views.decorators.http import require_POST

from apps import hx
from apps.accounts.access import coach_required
from apps.accounts.coach_views import coach_athlete
from apps.accounts.services import coach_athletes

from . import questions
from .models import CheckinQuestion, QuestionType


class Scope:
    def __init__(self, request, athlete_pk=None):
        self.request = request
        if athlete_pk is None:
            self.athlete = None
            self.gym = request.coach.gym
            self.owner = self.gym
            self.questions = questions.owned(self.gym)
            self.prefix = reverse("coach:questions")
            self.builder_id = "defQBuilder"
            self.saved_message = (
                "Defaults updated — new athletes get these; push them to update existing athletes"
            )
        else:
            self.athlete = coach_athlete(request, athlete_pk)
            self.gym = self.athlete.gym
            self.owner = self.athlete
            self.questions = questions.owned(self.athlete)
            self.prefix = reverse("coach:athlete_questions", args=[self.athlete.pk])
            first = self.athlete.user.get_short_name()
            self.saved_message = f"Updated — live from {first}'s next session"
            self.builder_id = "qBuilder"

    def question(self, qid):
        try:
            return questions.get(self.owner, qid)
        except CheckinQuestion.DoesNotExist as err:
            raise Http404 from err

    def save_pending_edits(self, post):
        """Every builder request carries the wording currently on screen (text_<id>,
        low_label_<id>, high_label_<id>, detail_label_<id>). Save it before acting, so a quick
        edit-then-click can't lose the edit whatever order the requests arrive in."""
        questions.save_pending_edits(self.owner, post)

    def render(self, message=None, kind=""):
        response = TemplateResponse(
            self.request,
            "workouts/_question_builder.html",
            {
                "questions": self.questions.active(),
                "builder_prefix": self.prefix,
                "builder_id": self.builder_id,
                "athlete": self.athlete,
            },
        )
        return hx.toast(response, message, kind) if message else response


def _scope(view):
    @coach_required
    def wrapped(request, *args, athlete_pk=None, **kwargs):
        scope = Scope(request, athlete_pk)
        if request.method == "POST" and view.__name__ != "update":
            scope.save_pending_edits(request.POST)
        return view(request, scope, *args, **kwargs)

    wrapped.__name__ = view.__name__
    return wrapped


@_scope
def builder(request, scope):
    return scope.render()


@require_POST
@_scope
def add(request, scope, qtype):
    try:
        questions.add(scope.owner, qtype)
    except questions.InvalidQuestion as err:
        raise Http404 from err
    return scope.render("Question added — edit its wording below")


@require_POST
@_scope
def update(request, scope, qid):
    q = scope.question(qid)
    post = request.POST
    try:
        questions.update(
            q,
            text=post.get(f"text_{q.pk}", q.text),
            low_label=post.get(f"low_label_{q.pk}"),
            high_label=post.get(f"high_label_{q.pk}"),
            detail_label=post.get(f"detail_label_{q.pk}"),
        )
    except questions.InvalidQuestion as err:
        # Put the old wording back on screen.
        return hx.retarget(scope.render(str(err), "bad"), f"#{scope.builder_id}", "outerHTML")
    # The edited text is already on screen, so nothing is redrawn. Redrawing here would
    # drop any click (move, delete) queued behind this save.
    return hx.toast(HttpResponse(""), scope.saved_message)


@require_POST
@_scope
def archive(request, scope, qid):
    questions.archive(scope.question(qid))
    return scope.render("Question removed")


@require_POST
@_scope
def move(request, scope, qid, direction):
    try:
        questions.move(scope.owner, int(qid), direction)
    except ValueError as err:
        raise Http404 from err
    return scope.render()


@require_POST
@_scope
def add_option(request, scope, qid):
    q = scope.question(qid)
    try:
        questions.add_option(q, request.POST.get(f"option_{q.pk}", ""))
    except questions.InvalidQuestion as err:
        duplicate = str(err) == "That option is already there"
        return scope.render(str(err), "" if duplicate or q.type != QuestionType.CHOICE else "bad")
    return scope.render(scope.saved_message)


@require_POST
@_scope
def remove_option(request, scope, qid, index):
    q = scope.question(qid)
    if q.type != QuestionType.CHOICE or not 0 <= index < len(q.options):
        raise Http404
    try:
        questions.remove_option(q, index)
    except questions.InvalidQuestion as err:
        return scope.render(str(err), "bad")
    return scope.render(scope.saved_message)


@require_POST
@_scope
def reset_to_defaults(request, scope):
    if scope.athlete is None:
        raise Http404
    questions.reset_to_defaults(scope.athlete)
    return scope.render("Reset to the default questions", "good")


@require_POST
@_scope
def push_defaults(request, scope):
    if scope.athlete is not None:
        raise Http404
    count = questions.push_defaults(request.coach)
    return scope.render(
        f"Default questions pushed to your {count} athlete{'s' if count != 1 else ''}", "good"
    )


@coach_required
def defaults_page(request):
    scope = Scope(request)
    return TemplateResponse(
        request,
        "workouts/questions_page.html",
        {
            "panel": "programming",
            "ptab": "questions",
            "title": "Programming",
            "questions": questions.active(scope.owner),
            "builder_prefix": scope.prefix,
            "builder_id": scope.builder_id,
            "athlete_count": coach_athletes(request.coach).count(),
        },
    )
