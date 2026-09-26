"""Programming › Exercises › Categories & tags: the gym's own categories (ordered)
and tags (alphabetical, at most TAG_MAX_LENGTH characters)."""

from django.db.models import Count
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.views.decorators.http import require_POST

from apps import hx
from apps.accounts.access import coach_required

from . import services
from .forms import CATEGORY_NAME_LENGTH, TAG_NAME_LENGTH, NameForm, save_pending_names
from .models import Category, Tag


def _categories(gym):
    return Category.objects.filter(gym=gym).annotate(n=Count("exercises"))


def _tags(gym):
    return Tag.objects.filter(gym=gym).annotate(n=Count("exercises"))


def _card(request, which, message=None, kind="", errors=None):
    gym = request.coach.gym
    template = "exercises/_categories_card.html" if which == "categories" else "exercises/_tags_card.html"
    context = {
        "categories": _categories(gym),
        "tags": _tags(gym),
        "errors": errors or {},
        "tag_max": TAG_NAME_LENGTH,
        "category_max": CATEGORY_NAME_LENGTH,
    }
    response = TemplateResponse(request, template, context)
    return hx.toast(response, message, kind) if message else response


@coach_required
def page(request):
    gym = request.coach.gym
    return TemplateResponse(
        request,
        "exercises/organise.html",
        {
            "panel": "programming",
            "ptab": "exercises",
            "title": "Programming",
            "categories": _categories(gym),
            "tags": _tags(gym),
            "errors": {},
            "tag_max": TAG_NAME_LENGTH,
            "category_max": CATEGORY_NAME_LENGTH,
        },
    )


def _name_form(request, model, instance=None):
    what, max_length = ("category", CATEGORY_NAME_LENGTH) if model is Category else ("tag", TAG_NAME_LENGTH)
    data = {"name": request.POST.get(f"name_{instance.pk}" if instance else "name", "")}
    return NameForm(
        data, model=model, gym=request.coach.gym, max_length=max_length, what=what, instance=instance
    )


def _save_pending(request, model):
    max_length = CATEGORY_NAME_LENGTH if model is Category else TAG_NAME_LENGTH
    save_pending_names(model, request.coach.gym, request.POST, max_length)


# ---------------------------------------------------------------- categories


@coach_required
@require_POST
def category_add(request):
    _save_pending(request, Category)
    form = _name_form(request, Category)
    if not form.is_valid():
        return _card(
            request, "categories", form.errors["name"][0], "bad", errors={"new": form.errors["name"][0]}
        )
    services.add_category(request.coach.gym, form.cleaned_data["name"])
    return _card(request, "categories", f"Category “{form.cleaned_data['name']}” added", "good")


@coach_required
@require_POST
def category_rename(request, pk):
    category = get_object_or_404(Category, pk=pk, gym=request.coach.gym)
    form = _name_form(request, Category, instance=category)
    if not form.is_valid():
        # Redraw so the old name comes back.
        return hx.retarget(
            _card(request, "categories", form.errors["name"][0], "bad"), "#categoriesCard", "outerHTML"
        )
    services.rename_category(category, form.cleaned_data["name"])
    return hx.toast(HttpResponse(""), "Category renamed")  # the new name is already on screen


@coach_required
@require_POST
def category_move(request, pk, direction):
    _save_pending(request, Category)
    try:
        services.move_category(request.coach.gym, pk, direction)
    except ValueError as err:
        raise Http404 from err
    return _card(request, "categories")


@coach_required
def category_delete(request, pk):
    """GET: a modal that asks where this category's exercises should go. POST: move them, delete."""
    gym = request.coach.gym
    category = get_object_or_404(Category, pk=pk, gym=gym)
    count = category.exercises.count()  # archived exercises too: they still need a category
    others = Category.objects.filter(gym=gym).exclude(pk=category.pk)
    if request.method == "POST":
        target = others.filter(pk=request.POST.get("move_to")).first() if count else None
        name = category.name
        try:
            services.delete_category(category, target)
        except services.NeedsTarget:
            return TemplateResponse(
                request,
                "exercises/_category_delete_modal.html",
                {
                    "category": category,
                    "count": count,
                    "others": others,
                    "error": "Pick where its exercises should go." if others else None,
                },
            )
        if count:
            plural = "s" if count != 1 else ""
            message = f"Moved {count} exercise{plural} to {target.name} and deleted {name}"
        else:
            message = f"Deleted {name}"
        response = hx.trigger(_card(request, "categories"), toast={"message": message}, exercisesChanged=True)
        response = hx.retarget(response, "#categoriesCard", "outerHTML")
        return hx.trigger_after_swap(response, closeModal=True)
    return TemplateResponse(
        request,
        "exercises/_category_delete_modal.html",
        {"category": category, "count": count, "others": others},
    )


# ---------------------------------------------------------------- tags


@coach_required
@require_POST
def tag_add(request):
    _save_pending(request, Tag)
    form = _name_form(request, Tag)
    if not form.is_valid():
        return _card(request, "tags", form.errors["name"][0], "bad", errors={"new": form.errors["name"][0]})
    services.add_tag(request.coach.gym, form.cleaned_data["name"])
    return _card(request, "tags", f"Tag “{form.cleaned_data['name']}” added", "good")


@coach_required
@require_POST
def tag_rename(request, pk):
    tag = get_object_or_404(Tag, pk=pk, gym=request.coach.gym)
    form = _name_form(request, Tag, instance=tag)
    if not form.is_valid():
        return hx.retarget(_card(request, "tags", form.errors["name"][0], "bad"), "#tagsCard", "outerHTML")
    services.rename_tag(tag, form.cleaned_data["name"])
    return hx.toast(HttpResponse(""), "Tag renamed")


@coach_required
@require_POST
def tag_delete(request, pk):
    _save_pending(request, Tag)
    tag = get_object_or_404(Tag, pk=pk, gym=request.coach.gym)
    name = tag.name
    count = services.delete_tag(tag)  # the exercises themselves stay
    message = f"Deleted “{name}”" + (
        f" and removed it from {count} exercise{'s' if count != 1 else ''}" if count else ""
    )
    return _card(request, "tags", message)
