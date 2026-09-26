from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth import views as auth_views
from django.contrib.auth.decorators import login_required
from django.http import Http404
from django.shortcuts import redirect
from django.template.response import TemplateResponse
from django.views.decorators.http import require_POST

from apps import hx, ratelimit
from apps.exercises.models import MAX_TRACKED_LIFTS, TrackedLift
from apps.exercises.services import trackable
from apps.programs.views import card_context as week_type_card_context
from apps.ratelimit import by_ip, by_user, client_ip, rate_limit, too_many

from . import invites, metrics, services
from .access import athlete_required, coach_required, home_url_for
from .emails import invite_url
from .forms import (
    CoachSignupForm,
    GymSettingsForm,
    InviteForm,
    JoinForm,
    MetricsForm,
)
from .metrics import missing_metrics, save_metrics
from .models import (
    Invite,
    MeasurementSource,
)
from .services import AccountExists


def login_allowed(request):
    """The sign-in limits (apps/ratelimit.login_allowed) for this request."""
    return ratelimit.login_allowed(client_ip(request), request.POST.get("username", ""))


def admin_login(request, extra_context=None):
    """Django admin's sign-in page, under the same limits as the site's."""
    from django.contrib import admin

    if request.method == "POST" and not login_allowed(request):
        return too_many(request, "Too many sign-in attempts. Wait 15 minutes.")
    return admin.site.login(request, extra_context)


class RateLimitedLoginView(auth_views.LoginView):
    """Sign-in, limited by login_allowed()."""

    def post(self, request, *args, **kwargs):
        if not login_allowed(request):
            form = self.get_form()
            form.is_valid()  # bind it so the page shows what was typed
            form.errors.clear()
            form.add_error(None, "Too many sign-in attempts. Wait 15 minutes, or reset your password.")
            return self.render_to_response(self.get_context_data(form=form), status=429)
        return super().post(request, *args, **kwargs)


def _base_url(request):
    """This site's address as the browser sees it, for links in emails."""
    return request.build_absolute_uri("/").rstrip("/")


def index(request):
    if request.user.is_authenticated:
        return redirect(home_url_for(request.user))
    return redirect("accounts:login")


@login_required
def no_profile(request):
    if request.user.coach_profile or request.user.athlete_profile:
        return redirect(home_url_for(request.user))
    return TemplateResponse(request, "accounts/no_profile.html")


# ---------------------------------------------------------------- coach sign-up


@rate_limit("signup", 10, 60 * 60, key=by_ip)
def signup(request):
    if request.user.is_authenticated:
        return redirect(home_url_for(request.user))
    form = CoachSignupForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        data = form.cleaned_data
        try:
            coach = services.sign_up_coach(
                name=data["name"],
                email=data["email"],
                password=data["password"],
                gym_name=data["gym_name"],
                units=data["units"],
                starter=data["starter"],
                timezone=data["browser_timezone"],
            )
        except services.AccountExists:  # taken since the form checked
            form.add_error("email", "An account with this email already exists. Log in instead.")
            return TemplateResponse(request, "accounts/signup.html", {"form": form})
        except services.InvalidAccount as err:
            form.add_error(None, str(err))
            return TemplateResponse(request, "accounts/signup.html", {"form": form})
        user = coach.user
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        messages.success(request, f"Welcome to Platform, {user.get_short_name()}")
        return redirect("coach:dashboard")
    return TemplateResponse(request, "accounts/signup.html", {"form": form})


# ---------------------------------------------------------------- invites (coach side)


@coach_required
def invite_new(request):
    return TemplateResponse(
        request, "partials/invite_modal.html", {"form": InviteForm(gym=request.coach.gym)}
    )


@coach_required
@require_POST
@rate_limit("invite", 30, 60 * 60, key=by_user)
def invite_create(request):
    form = InviteForm(request.POST, gym=request.coach.gym)
    if not form.is_valid():
        return TemplateResponse(request, "partials/invite_modal.html", {"form": form})
    email = form.cleaned_data["email"]
    invite = invites.create(request.coach, email, form.cleaned_data["starting_template"], _base_url(request))
    join_url = invite_url(_base_url(request), invite)
    if email:
        toast = f"Invite sent to {email}"
    else:
        toast = "Invite link created — share it with your athlete"
    response = TemplateResponse(
        request, "partials/invite_modal.html", {"invite": invite, "join_url": join_url, "sent": bool(email)}
    )
    return hx.trigger(response, toast={"message": toast, "kind": "good"}, invitesChanged=True)


@coach_required
def invite_list(request):
    return TemplateResponse(request, "partials/invite_list.html", _invite_list_context(request))


def _invite_list_context(request):
    base = _base_url(request)
    return {"pending_invites": [(i, invite_url(base, i)) for i in invites.pending(request.coach)]}


@coach_required
@require_POST
def invite_revoke(request, pk):
    try:
        invites.revoke(request.coach, pk)
    except Invite.DoesNotExist as err:
        raise Http404 from err
    response = TemplateResponse(request, "partials/invite_list.html", _invite_list_context(request))
    return hx.toast(response, "Invite revoked")


# ---------------------------------------------------------------- joining (athlete side)


@rate_limit("join", 10, 60 * 60, key=by_ip)
def join(request, token):
    invite = Invite.objects.select_related("coach__user", "coach__gym").filter(token=token).first()
    if invite is None or not invite.is_usable:
        return TemplateResponse(request, "accounts/join_invalid.html", {"invite": invite}, status=410)

    user = request.user if request.user.is_authenticated else None
    if user:
        try:
            invites.check_can_join(user)
        except invites.AlreadyAthlete:
            messages.warning(request, "You already have an athlete account.")
            return redirect("app:home")
        except invites.ArchivedAthlete:
            messages.error(
                request,
                "This account's athlete profile was archived by a coach. Ask them to restore it, "
                "or sign out and join with a different email.",
            )
            return redirect("accounts:no_profile")

    form = None if user else JoinForm(request.POST or None, invite_email=invite.email)
    if request.method == "POST" and (user or form.is_valid()):
        data = form.cleaned_data if form else {}
        try:
            athlete = invites.accept(
                invite.pk,
                user=user,
                name=data.get("name", ""),
                email=data.get("email", ""),
                password=data.get("password"),
                timezone_name=data.get("browser_timezone", ""),
            )
        except invites.InviteUnusable:
            invite.refresh_from_db()
            return TemplateResponse(request, "accounts/join_invalid.html", {"invite": invite}, status=410)
        except AccountExists:  # taken since the form checked
            form.add_error("email", "An account with this email already exists. Log in instead.")
            return TemplateResponse(
                request, "accounts/join.html", {"invite": invite, "form": form, "step": 1}
            )
        except services.InvalidAccount as err:
            form.add_error(None, str(err))
            return TemplateResponse(
                request, "accounts/join.html", {"invite": invite, "form": form, "step": 1}
            )
        if not request.user.is_authenticated:
            login(request, athlete.user, backend="django.contrib.auth.backends.ModelBackend")
        return redirect("app:welcome_metrics")

    return TemplateResponse(request, "accounts/join.html", {"invite": invite, "form": form, "step": 1})


@athlete_required
def welcome_metrics(request):
    athlete = request.athlete
    form = MetricsForm(request.POST or None, gym=athlete.gym, units=athlete.units)
    request.session["onboarding_total"] = len(form.fields)
    if request.method == "POST" and "skip_all" in request.POST:
        request.session["onboarding_skipped"] = len(form.fields)
        return redirect("app:welcome_done")
    if request.method == "POST" and form.is_valid():
        save_metrics(athlete, form.cleaned_data, source=MeasurementSource.ONBOARDING)
        request.session["onboarding_skipped"] = form.skipped_count()
        return redirect("app:welcome_done")
    return TemplateResponse(request, "accounts/welcome_metrics.html", {"form": form, "step": 2})


@athlete_required
def welcome_done(request):
    skipped = request.session.pop("onboarding_skipped", 0)
    total = request.session.pop("onboarding_total", 0)
    return TemplateResponse(
        request,
        "accounts/welcome_done.html",
        {"skipped": skipped, "all_skipped": bool(total) and skipped >= total, "step": 3},
    )


# ---------------------------------------------------------------- gym settings


@coach_required
def settings_page(request):
    gym = request.coach.gym
    initial = {
        "gym_name": gym.name,
        "coach_title": request.coach.title,
        "digest": request.coach.digest,
        "timezone": gym.timezone,
        "units": gym.units,
        "week_start": gym.week_start,
    }
    form = GymSettingsForm(request.POST or None, initial=initial)
    if request.method == "POST" and form.is_valid():
        data = form.cleaned_data
        try:
            services.update_gym_settings(
                request.coach,
                gym_name=data["gym_name"],
                coach_title=data["coach_title"],
                digest=data["digest"],
                timezone=data["timezone"],
                units=data["units"],
                week_start=data["week_start"],
            )
        except services.InvalidSettings as err:
            form.add_error(None, str(err))
        else:
            messages.success(request, "Settings saved")
            return redirect("coach:settings")
    return TemplateResponse(
        request,
        "coach/settings.html",
        {
            "panel": "settings",
            "title": "Settings",
            "form": form,
            **week_type_card_context(gym),
            "tracked": TrackedLift.objects.filter(gym=gym).select_related("exercise__category"),
            "trackable": trackable(gym),
            "max_tracked": MAX_TRACKED_LIFTS,
        },
    )


@athlete_required
def update_numbers(request):
    """Where the coach's reminder email points: fill in only the missing metrics."""
    athlete = request.athlete
    missing = missing_metrics(athlete)
    if not missing:
        messages.success(request, "All your numbers are in — nothing to add")
        return redirect("app:profile")
    form = MetricsForm(request.POST or None, gym=athlete.gym, units=athlete.units, only=missing)
    if request.method == "POST" and form.is_valid():
        filled = metrics.save_missing(athlete, form.cleaned_data)
        coach = athlete.coach.user.get_short_name()
        if filled:
            messages.success(request, f"Thanks — {coach} can see your numbers")
        return redirect("app:profile")
    return TemplateResponse(
        request, "accounts/update_numbers.html", {"form": form, "tab": "profile", "title": "Your numbers"}
    )
